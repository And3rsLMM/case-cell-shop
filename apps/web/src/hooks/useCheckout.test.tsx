import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CheckoutStatus } from "@/components/CheckoutStatus";
import {
  apiError,
  getRequestHeader,
  installFetchMock,
  respond
} from "../../tests/mocks/fetch";
import { orderResponseFixture, productFixture } from "../../tests/fixtures";
import { useCheckout } from "./useCheckout";

function CheckoutHarness() {
  const checkout = useCheckout({
    pollingIntervalMs: 2,
    pollingTimeoutMs: 100
  });

  return (
    <section aria-label="Checkout de teste">
      <button
        type="button"
        disabled={checkout.isLocked}
        onClick={() => {
          void checkout.checkout([
            { productId: productFixture.id, quantity: 1 }
          ]);
        }}
      >
        Comprar capinha de teste
      </button>
      <button
        type="button"
        disabled={checkout.isLocked}
        onClick={() => {
          void checkout.checkout([
            { productId: productFixture.id, quantity: 2 }
          ]);
        }}
      >
        Enviar carrinho alterado
      </button>

      <CheckoutStatus
        state={checkout.state}
        onReset={checkout.reset}
        onResumePolling={checkout.resumePolling}
        onRetry={() => {
          void checkout.retry();
        }}
        onRetryAsNewIntent={() => {
          void checkout.retryAsNewIntent();
        }}
      />
    </section>
  );
}

describe("useCheckout pela interface renderizada", () => {
  test("mantém a chave sem alteração e gera outra após mudar a intenção", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetchMock(
      apiError(
        "INSUFFICIENT_STOCK",
        "Estoque insuficiente.",
        409,
        false
      ),
      apiError(
        "INSUFFICIENT_STOCK",
        "Estoque insuficiente.",
        409,
        false
      ),
      respond(
        orderResponseFixture({
          items: [
            {
              ...orderResponseFixture().order.items[0]!,
              quantity: 2,
              subtotalInCents: 9_980
            }
          ],
          totalPriceInCents: 9_980
        }),
        201
      )
    );

    render(<CheckoutHarness />);
    await user.click(
      screen.getByRole("button", { name: "Comprar capinha de teste" })
    );
    await screen.findByRole("heading", { name: "Estoque insuficiente" });
    const firstKey = getRequestHeader(fetchMock, 0, "Idempotency-Key");

    await user.click(
      screen.getByRole("button", { name: "Ajustar carrinho" })
    );

    await user.click(
      screen.getByRole("button", { name: "Comprar capinha de teste" })
    );
    await screen.findByRole("heading", { name: "Estoque insuficiente" });
    expect(getRequestHeader(fetchMock, 1, "Idempotency-Key")).toBe(firstKey);

    await user.click(
      screen.getByRole("button", { name: "Enviar carrinho alterado" })
    );
    await screen.findByRole("heading", { name: "Pedido confirmado!" });
    expect(getRequestHeader(fetchMock, 2, "Idempotency-Key")).not.toBe(
      firstKey
    );
  });
});
