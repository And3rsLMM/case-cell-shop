import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  createDeferred,
  installFetchMock,
  jsonResponse,
  respond,
  respondLater,
} from "../../tests/mocks/fetch";
import { orderStatusFixture } from "../../tests/fixtures";
import { useOrderPolling, type OrderPollingState } from "./useOrderPolling";

function visibleMessage(state: OrderPollingState): string {
  switch (state.phase) {
    case "IDLE":
      return "Acompanhamento parado.";
    case "POLLING":
      return "Consultando o pedido.";
    case "CONFIRMED":
      return "Pedido confirmado pelo acompanhamento.";
    case "FAILED":
      return "Pedido recusado pelo acompanhamento.";
    case "TIMED_OUT":
      return "Limite de consulta atingido.";
    case "ERROR":
      return "Não foi possível consultar o pedido.";
  }
}

function PollingHarness({ timeoutMs = 100 }: { timeoutMs?: number }) {
  const polling = useOrderPolling({ intervalMs: 2, timeoutMs });

  return (
    <section aria-label="Acompanhamento de teste">
      <button type="button" onClick={() => polling.start("order-1")}>Iniciar acompanhamento</button>
      <output aria-live="polite">{visibleMessage(polling.state)}</output>
    </section>
  );
}

describe("useOrderPolling pela interface renderizada", () => {
  test("consulta repetidamente e encerra o polling quando o pedido chega ao estado final", async () => {
    const user = userEvent.setup();
    const confirmedResponse = createDeferred<Response>();
    const fetchMock = installFetchMock(
      respond(orderStatusFixture({ status: "PROCESSING" })),
      respondLater(confirmedResponse.promise),
    );

    render(<PollingHarness />);
    await user.click(screen.getByRole("button", { name: "Iniciar acompanhamento" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Consultando o pedido.")).toBeVisible();
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/api\/orders\/order-1$/);

    await act(async () => {
      confirmedResponse.resolve(jsonResponse(orderStatusFixture()));
      await confirmedResponse.promise;
    });

    expect(await screen.findByText("Pedido confirmado pelo acompanhamento.")).toBeVisible();
    const callCountAtConfirmation = fetchMock.mock.calls.length;

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
    });
    expect(fetchMock).toHaveBeenCalledTimes(callCountAtConfirmation);
  });

  test("aborta uma consulta pendente quando o limite absoluto é atingido", async () => {
    const user = userEvent.setup();
    const pendingResponse = createDeferred<Response>();
    const fetchMock = installFetchMock(
      respondLater(pendingResponse.promise),
    );

    render(<PollingHarness timeoutMs={20} />);
    await user.click(
      screen.getByRole("button", { name: "Iniciar acompanhamento" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText("Limite de consulta atingido."),
    ).toBeVisible();

    const requestSignal = fetchMock.mock.calls[0]?.[1]?.signal;
    expect(requestSignal?.aborted).toBe(true);

    await act(async () => {
      pendingResponse.resolve(
        jsonResponse(orderStatusFixture({ status: "PROCESSING" })),
      );
      await pendingResponse.promise;
    });
    expect(screen.getByText("Limite de consulta atingido.")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
