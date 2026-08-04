import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Home from "./page";
import {
  apiError,
  createDeferred,
  getRequestBody,
  getRequestHeader,
  installFetchMock,
  jsonResponse,
  rejectWith,
  respond,
  respondLater
} from "../../tests/mocks/fetch";
import {
  orderAcceptedFixture,
  orderResponseFixture,
  productFixture,
  productListFixture
} from "../../tests/fixtures";

async function addFirstProduct(
  user: ReturnType<typeof userEvent.setup>,
  quantity?: number
): Promise<void> {
  const addButton = await screen.findByRole("button", {
    name: "Adicionar ao carrinho"
  });

  if (quantity !== undefined) {
    const card = screen
      .getByRole("heading", { name: productFixture.name })
      .closest("article");
    const input = within(card as HTMLElement).getByLabelText("Quantidade");
    await user.clear(input);
    await user.type(input, String(quantity));
  }

  await user.click(addButton);
}

describe("vitrine CaseCellShop", () => {
  test("exibe loading e depois os produtos carregados", async () => {
    const pendingProducts = createDeferred<Response>();
    installFetchMock(respondLater(pendingProducts.promise));

    render(<Home />);

    const loading = screen.getByText("Carregando produtos").closest("div");
    expect(loading).toHaveAttribute("aria-busy", "true");
    expect(loading).toHaveAttribute("aria-live", "polite");

    await act(async () => {
      pendingProducts.resolve(jsonResponse(productListFixture()));
      await pendingProducts.promise;
    });

    const card = (await screen.findByRole("heading", {
      name: productFixture.name
    })).closest("article");
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText(/R\$\s*49,90/u)).toBeVisible();
    expect(within(card as HTMLElement).getByText("3 em estoque")).toBeVisible();
    expect(
      within(card as HTMLElement).getByRole("button", {
        name: "Adicionar ao carrinho"
      })
    ).toBeEnabled();
  });

  test("exibe erro de carregamento e permite tentar novamente", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetchMock(
      rejectWith(new Error("conexão indisponível")),
      respond(productListFixture())
    );

    render(<Home />);

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByRole("heading", {
        name: "Não foi possível carregar os produtos"
      })
    ).toBeVisible();
    await user.click(
      within(alert).getByRole("button", { name: "Tentar novamente" })
    );

    expect(await screen.findByText(productFixture.name)).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("bloqueia quantidade inválida antes de adicionar ao carrinho", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetchMock(respond(productListFixture()));

    render(<Home />);

    const quantity = await screen.findByLabelText("Quantidade");
    await user.clear(quantity);
    await user.type(quantity, "0");
    await user.click(
      screen.getByRole("button", { name: "Adicionar ao carrinho" })
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Informe uma quantidade inteira maior que zero."
    );
    expect(quantity).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Seu carrinho está vazio.")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("adiciona itens sem comprar, combina quantidades e calcula totais", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetchMock(respond(productListFixture()));

    render(<Home />);
    await addFirstProduct(user, 2);
    await addFirstProduct(user, 1);

    const cart = screen.getByRole("region", { name: "Carrinho" });
    expect(within(cart).getByLabelText("Quantidade")).toHaveValue(3);
    expect(within(cart).getAllByText(/R\$\s*149,70/u)).toHaveLength(2);
    expect(
      within(cart).getByRole("button", { name: "Finalizar compra" })
    ).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("altera quantidade, remove item e limpa o carrinho", async () => {
    const user = userEvent.setup();
    const secondProduct = {
      ...productFixture,
      id: "product-2",
      name: "Capinha Verde",
      priceInCents: 2_000
    };
    installFetchMock(respond(productListFixture([productFixture, secondProduct])));

    render(<Home />);
    const addButtons = await screen.findAllByRole("button", {
      name: "Adicionar ao carrinho"
    });
    await user.click(addButtons[0]!);
    await user.click(addButtons[1]!);

    const cart = screen.getByRole("region", { name: "Carrinho" });
    const cartQuantities = within(cart).getAllByLabelText("Quantidade");
    expect(
      within(cart).getByRole("button", {
        name: "Diminuir quantidade de Capinha Azul"
      })
    ).toBeDisabled();
    await user.click(
      within(cart).getByRole("button", {
        name: "Aumentar quantidade de Capinha Azul"
      })
    );
    expect(cartQuantities[0]).toHaveValue(2);
    expect(within(cart).getByText(/R\$\s*119,80/u)).toBeVisible();

    await user.clear(cartQuantities[0]!);
    await user.type(cartQuantities[0]!, "0");
    expect(
      within(cart).getByRole("button", { name: "Finalizar compra" })
    ).toBeDisabled();
    await user.clear(cartQuantities[0]!);
    await user.type(cartQuantities[0]!, "2");
    expect(
      within(cart).getByRole("button", { name: "Finalizar compra" })
    ).toBeEnabled();

    await user.click(
      within(cart).getByRole("button", { name: "Remover Capinha Verde" })
    );
    expect(within(cart).queryByText("Capinha Verde")).not.toBeInTheDocument();
    await user.click(
      within(cart).getByRole("button", { name: "Limpar carrinho" })
    );
    expect(within(cart).getByText("Seu carrinho está vazio.")).toBeVisible();
  });

  test("envia todos os itens em uma única requisição canônica", async () => {
    const user = userEvent.setup();
    const secondProduct = {
      ...productFixture,
      id: "a-product",
      name: "Capinha Amarela",
      priceInCents: 2_000
    };
    const firstProduct = { ...productFixture, id: "z-product" };
    const orderItems = [
      {
        name: secondProduct.name,
        productId: secondProduct.id,
        quantity: 1,
        subtotalInCents: 2_000,
        unitPriceInCents: 2_000
      },
      {
        name: firstProduct.name,
        productId: firstProduct.id,
        quantity: 1,
        subtotalInCents: 4_990,
        unitPriceInCents: 4_990
      }
    ];
    const fetchMock = installFetchMock(
      respond(productListFixture([firstProduct, secondProduct])),
      respond(
        orderResponseFixture({
          items: orderItems,
          totalPriceInCents: 6_990
        }),
        201
      ),
      respond(productListFixture([firstProduct, secondProduct]))
    );

    render(<Home />);
    const addButtons = await screen.findAllByRole("button", {
      name: "Adicionar ao carrinho"
    });
    await user.click(addButtons[0]!);
    await user.click(addButtons[1]!);
    await user.click(screen.getByRole("button", { name: "Finalizar compra" }));

    expect(await screen.findByText("1× Capinha Amarela — R$ 20,00")).toBeVisible();
    expect(getRequestBody(fetchMock, 1)).toEqual({
      items: [
        { productId: "a-product", quantity: 1 },
        { productId: "z-product", quantity: 1 }
      ]
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("desabilita o checkout, evita envio duplicado e limpa após confirmação", async () => {
    const user = userEvent.setup();
    const pendingOrder = createDeferred<Response>();
    const fetchMock = installFetchMock(
      respond(productListFixture()),
      respondLater(pendingOrder.promise),
      respond(productListFixture([{ ...productFixture, availableQuantity: 2 }]))
    );

    render(<Home />);
    await addFirstProduct(user);
    await user.click(screen.getByRole("button", { name: "Finalizar compra" }));

    const sendingButton = screen.getByRole("button", { name: "Finalizando…" });
    expect(sendingButton).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Enviando seu pedido");
    await user.click(sendingButton);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      pendingOrder.resolve(jsonResponse(orderResponseFixture(), 201));
      await pendingOrder.promise;
    });

    expect(
      await screen.findByRole("heading", { name: "Pedido confirmado!" })
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 produto, total de R$ 49,90"
    );
    expect(screen.getByText("Seu carrinho está vazio.")).toBeVisible();
    expect(await screen.findByText("2 em estoque")).toBeVisible();
  });

  test("preserva e destaca o item com estoque insuficiente", async () => {
    const user = userEvent.setup();
    installFetchMock(
      respond(productListFixture()),
      apiError(
        "INSUFFICIENT_STOCK",
        "Não há estoque suficiente para um ou mais produtos.",
        409,
        false,
        {
          items: [
            {
              availableQuantity: 0,
              productId: productFixture.id,
              requestedQuantity: 2
            }
          ]
        }
      ),
      respond(productListFixture([{ ...productFixture, availableQuantity: 0 }]))
    );

    render(<Home />);
    await addFirstProduct(user, 2);
    await user.click(screen.getByRole("button", { name: "Finalizar compra" }));

    const alert = (
      await screen.findByRole("heading", { name: "Estoque insuficiente" })
    ).closest("aside");
    expect(alert).not.toBeNull();
    expect(alert as HTMLElement).toHaveTextContent(
      "itens afetados estão destacados"
    );
    const cart = screen.getByRole("region", { name: "Carrinho" });
    expect(within(cart).getByLabelText("Quantidade")).toHaveValue(2);
    expect(within(cart).getByText(/Revise este item/u)).toBeVisible();
  });

  test("preserva o carrinho e reutiliza a chave após falha temporária", async () => {
    const user = userEvent.setup();
    const twoItems = orderResponseFixture({
      items: [
        {
          ...orderResponseFixture().order.items[0]!,
          quantity: 2,
          subtotalInCents: 9_980
        }
      ],
      totalPriceInCents: 9_980
    });
    const fetchMock = installFetchMock(
      respond(productListFixture()),
      apiError(
        "ERP_TEMPORARILY_UNAVAILABLE",
        "ERP temporariamente indisponível.",
        503,
        true
      ),
      respond(twoItems, 200),
      respond(productListFixture([{ ...productFixture, availableQuantity: 1 }]))
    );

    render(<Home />);
    await addFirstProduct(user, 2);
    await user.click(screen.getByRole("button", { name: "Finalizar compra" }));

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByRole("heading", { name: "Falha temporária no ERP" })
    ).toBeVisible();
    const cart = screen.getByRole("region", { name: "Carrinho" });
    expect(within(cart).getByLabelText("Quantidade")).toHaveValue(2);
    const firstKey = getRequestHeader(fetchMock, 1, "Idempotency-Key");

    await user.click(within(alert).getByRole("button", { name: "Tentar novamente" }));

    expect(
      await screen.findByRole("heading", { name: "Pedido confirmado!" })
    ).toBeVisible();
    expect(getRequestHeader(fetchMock, 2, "Idempotency-Key")).toBe(firstKey);
  });

  test("gera nova chave para uma nova intenção", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetchMock(
      respond(productListFixture()),
      respond(orderResponseFixture(), 201),
      respond(productListFixture()),
      respond(orderResponseFixture({ id: "order-2" }), 201),
      respond(productListFixture([{ ...productFixture, availableQuantity: 2 }]))
    );

    render(<Home />);
    await addFirstProduct(user);
    await user.click(screen.getByRole("button", { name: "Finalizar compra" }));
    await screen.findByRole("heading", { name: "Pedido confirmado!" });
    const firstKey = getRequestHeader(fetchMock, 1, "Idempotency-Key");
    await user.click(screen.getByRole("button", { name: "Continuar comprando" }));

    await addFirstProduct(user);
    await user.click(screen.getByRole("button", { name: "Finalizar compra" }));
    await screen.findByRole("heading", { name: "Pedido confirmado!" });
    const secondKey = getRequestHeader(fetchMock, 3, "Idempotency-Key");

    expect(firstKey).toEqual(expect.any(String));
    expect(secondKey).toEqual(expect.any(String));
    expect(secondKey).not.toBe(firstKey);
  });

  test("exibe pedido em processamento e bloqueia o carrinho", async () => {
    const user = userEvent.setup();
    installFetchMock(
      respond(productListFixture()),
      respond(orderAcceptedFixture(), 202)
    );

    render(<Home />);
    await addFirstProduct(user);
    await user.click(screen.getByRole("button", { name: "Finalizar compra" }));

    const status = await screen.findByRole("status");
    expect(
      within(status).getByRole("heading", { name: "Pedido em processamento" })
    ).toBeVisible();
    const cart = screen.getByRole("region", { name: "Carrinho" });
    expect(within(cart).getByLabelText("Quantidade")).toBeDisabled();
    expect(
      within(cart).getByRole("button", { name: "Finalizar compra" })
    ).toBeDisabled();
  });

  test("mantém landmarks e rótulos acessíveis", async () => {
    installFetchMock(
      respond(
        productListFixture([
          productFixture,
          {
            ...productFixture,
            id: "product-2",
            name: "Capinha Esgotada",
            availableQuantity: 0
          }
        ])
      )
    );

    render(<Home />);

    expect(await screen.findByText(productFixture.name)).toBeVisible();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Escolha as suas próximas capas" })
    ).toBeVisible();
    const cart = screen.getByRole("region", { name: "Carrinho" });
    expect(cart).toBeVisible();
    expect(
      within(cart).getByRole("button", { name: "Finalizar compra" })
    ).toBeDisabled();
    const quantityInputs = screen.getAllByLabelText("Quantidade");
    expect(quantityInputs[0]).toHaveAccessibleDescription(
      "Estoque disponível: 3."
    );
    expect(screen.getByRole("button", { name: "Indisponível" })).toBeDisabled();
  });
});
