import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { CheckoutState } from "@/hooks/useCheckout";
import { CheckoutStatus } from "./CheckoutStatus";

function renderStatus(state: CheckoutState) {
  const actions = {
    onReset: jest.fn(),
    onResumePolling: jest.fn(),
    onRetry: jest.fn(),
    onRetryAsNewIntent: jest.fn()
  };

  render(<CheckoutStatus state={state} {...actions} />);
  return actions;
}

describe("CheckoutStatus", () => {
  test("anuncia falha temporária assertivamente e oferece retry", async () => {
    const user = userEvent.setup();
    const actions = renderStatus({
      phase: "TEMPORARY_FAILURE",
      items: [{ productId: "product-1", quantity: 2 }],
      requestId: "request-test-1",
      message: "O ERP está instável."
    });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(alert).toHaveTextContent("Falha temporária no ERP");

    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(actions.onRetry).toHaveBeenCalledTimes(1);
  });

});
