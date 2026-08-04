/* eslint-disable @typescript-eslint/unbound-method */

import type {
  ErpGateway,
  ErpProcessingResult
} from "../src/gateways/erp.gateway";
import type { OrderRepository } from "../src/repositories/order.repository";
import { createOrderProcessor } from "../src/services/order-processor.service";
import type { Logger } from "../src/utils/logger";
import { createOrderRecord } from "./helpers/order-fixture";

const timestamp = new Date("2026-08-03T12:00:00.000Z");

function createOrder(
  overrides: Parameters<typeof createOrderRecord>[0] = {}
) {
  return createOrderRecord({
    status: "PROCESSING",
    processingAttempts: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  });
}

describe("order processor", () => {
  let repository: jest.Mocked<OrderRepository>;
  let erpGateway: jest.Mocked<ErpGateway>;
  let logger: jest.Mocked<Logger>;

  beforeEach(() => {
    repository = {
      createAttempt: jest.fn(),
      failAndReleaseStock: jest.fn(),
      findById: jest.fn(),
      findByIdempotencyKey: jest.fn(),
      findProcessable: jest.fn(),
      markConfirmed: jest.fn(),
      markTemporaryFailure: jest.fn(),
      startProcessingAttempt: jest.fn()
    };
    erpGateway = { processOrder: jest.fn() };
    logger = { error: jest.fn(), info: jest.fn() };
  });

  function createProcessor(maxAttempts = 3) {
    return createOrderProcessor({
      erpGateway,
      logger,
      maxAttempts,
      now: () => timestamp,
      orderRepository: repository,
      processingLeaseMs: 1_000,
      processingTokenFactory: () => "claim-1"
    });
  }

  it("finaliza pedido esgotado após reinício sem chamar o ERP", async () => {
    const exhaustedOrder = createOrder({ processingAttempts: 3 });
    const failedOrder = createOrder({
      status: "FAILED",
      processingAttempts: 3,
      stockReleasedAt: timestamp
    });
    repository.startProcessingAttempt.mockResolvedValue({
      kind: "EXHAUSTED",
      order: exhaustedOrder,
      token: "claim-1"
    });
    repository.failAndReleaseStock.mockResolvedValue({
      kind: "APPLIED",
      order: failedOrder
    });

    const outcome = await createProcessor().processOrder("order-1");

    expect(erpGateway.processOrder).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: "FAILED", order: failedOrder });
  });

  it("compartilha a mesma execução para chamadas simultâneas", async () => {
    const processingOrder = createOrder();
    const confirmedOrder = createOrder({ status: "CONFIRMED" });
    let resolveErp: (result: ErpProcessingResult) => void = () => undefined;
    const pendingErp = new Promise<ErpProcessingResult>((resolve) => {
      resolveErp = resolve;
    });
    repository.startProcessingAttempt.mockResolvedValue({
      kind: "CLAIMED",
      order: processingOrder,
      token: "claim-1"
    });
    repository.markConfirmed.mockResolvedValue({
      kind: "APPLIED",
      order: confirmedOrder
    });
    erpGateway.processOrder.mockReturnValue(pendingErp);
    const processor = createProcessor();

    const first = processor.processOrder("order-1");
    const second = processor.processOrder("order-1");

    expect(second).toBe(first);
    resolveErp({
      outcome: "SUCCESS",
      durationMs: 10,
      simulatedDelayMs: 10
    });
    await expect(first).resolves.toEqual({
      kind: "CONFIRMED",
      order: confirmedOrder
    });
    expect(erpGateway.processOrder).toHaveBeenCalledTimes(1);
    await expect(processor.waitForIdle()).resolves.toBeUndefined();
  });

  it("registra falha inesperada com contexto seguro e agenda retry", async () => {
    const processingOrder = createOrder({ processingAttempts: 2 });
    const retryOrder = createOrder({
      processingAttempts: 2,
      errorCode: "ERP_TEMPORARY_FAILURE"
    });
    repository.startProcessingAttempt.mockResolvedValue({
      kind: "CLAIMED",
      order: processingOrder,
      token: "claim-1"
    });
    repository.markTemporaryFailure.mockResolvedValue({
      kind: "APPLIED",
      order: retryOrder
    });
    erpGateway.processOrder.mockRejectedValue(
      new Error("token=secret /internal/database.db")
    );

    const outcome = await createProcessor().processOrder("order-1", {
      requestId: "request-2"
    });

    expect(outcome).toEqual({
      kind: "RETRY_SCHEDULED",
      order: retryOrder
    });
    expect(logger.error).toHaveBeenCalledWith(
      "erp.order.processing-failed",
      expect.objectContaining({
        requestId: "request-2",
        orderId: "order-1",
        itemCount: 1,
        status: "PROCESSING",
        processingAttempt: 2,
        errorCode: "ERP_PROCESSING_EXCEPTION",
        error: { name: "Error" }
      })
    );
    expect(typeof logger.error.mock.calls[0]?.[1]?.durationMs).toBe(
      "number"
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("secret");
  });
});
