/* eslint-disable @typescript-eslint/unbound-method */
import {
  createSimulatedErpGateway,
  type OrderToProcess
} from "../src/gateways/erp.gateway";
import type { Logger } from "../src/utils/logger";

const order: OrderToProcess = {
  orderId: "order-1",
  items: [
    {
      productId: "product-1",
      quantity: 1,
      subtotalInCents: 3_990,
      unitPriceInCents: 3_990
    }
  ],
  totalPriceInCents: 3_990
};

describe("simulated ERP gateway", () => {
  let elapsedMs: number;
  let logger: jest.Mocked<Logger>;
  let wait: jest.MockedFunction<(delayMs: number) => Promise<void>>;

  beforeEach(() => {
    elapsedMs = 0;
    logger = { error: jest.fn(), info: jest.fn() };
    wait = jest.fn((delayMs: number) => {
      elapsedMs += delayMs;
      return Promise.resolve();
    });
  });

  function createGateway(random: () => number = () => 0.5) {
    return createSimulatedErpGateway({
      clock: () => elapsedMs,
      failureRate: 0.5,
      logger,
      maxDelayMs: 20,
      minDelayMs: 10,
      random,
      syncTimeoutMs: 50,
      wait
    });
  }

  it("simula sucesso com atraso e registra a duração", async () => {
    const result = await createGateway().processOrder(order, {
      attempt: 1,
      mode: "success",
      requestId: "request-1"
    });

    expect(result).toEqual({
      outcome: "SUCCESS",
      durationMs: 15,
      simulatedDelayMs: 15
    });
    expect(wait).toHaveBeenCalledWith(15);
    expect(logger.info).toHaveBeenCalledWith(
      "erp.order.processed",
      expect.objectContaining({
        orderId: "order-1",
        requestId: "request-1",
        itemCount: 1,
        status: "CONFIRMED",
        processingAttempt: 1,
        durationMs: 15,
        outcome: "SUCCESS"
      })
    );
  });

  it("faz slow ultrapassar a janela síncrona configurada", async () => {
    const result = await createGateway().processOrder(order, {
      attempt: 1,
      mode: "slow"
    });

    expect(wait).toHaveBeenCalledWith(51);
    expect(result).toMatchObject({
      outcome: "SUCCESS",
      durationMs: 51,
      simulatedDelayMs: 51
    });
  });

  it("simula falha temporária determinística", async () => {
    const result = await createGateway().processOrder(order, {
      attempt: 2,
      mode: "temporary-failure"
    });

    expect(result).toMatchObject({
      outcome: "TEMPORARY_FAILURE",
      errorCode: "ERP_TEMPORARY_FAILURE"
    });
    expect(logger.info).toHaveBeenCalledWith(
      "erp.order.processed",
      expect.objectContaining({
        orderId: "order-1",
        itemCount: 1,
        status: "PROCESSING",
        processingAttempt: 2,
        errorCode: "ERP_TEMPORARY_FAILURE"
      })
    );
  });

  it("usa aleatoriedade injetada no modo automático", async () => {
    const random = jest
      .fn<ReturnType<() => number>, []>()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.25);

    const result = await createGateway(random).processOrder(order, {
      attempt: 1
    });

    expect(random).toHaveBeenCalledTimes(2);
    expect(result.outcome).toBe("TEMPORARY_FAILURE");
    expect(wait).toHaveBeenCalledWith(10);
  });
});
