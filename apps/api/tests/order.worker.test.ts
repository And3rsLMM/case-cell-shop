/* eslint-disable @typescript-eslint/unbound-method */

import type { OrderRepository } from "../src/repositories/order.repository";
import type { OrderProcessor } from "../src/services/order-processor.service";
import type { Logger } from "../src/utils/logger";
import { createOrderWorker } from "../src/workers/order.worker";
import { createOrderRecord } from "./helpers/order-fixture";

const timestamp = new Date("2026-08-03T12:00:00.000Z");
const order = createOrderRecord({
  status: "PROCESSING",
  processingAttempts: 1,
  createdAt: timestamp,
  updatedAt: timestamp
});

describe("local order worker", () => {
  let repository: jest.Mocked<OrderRepository>;
  let processor: jest.Mocked<OrderProcessor>;
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
    processor = {
      processOrder: jest.fn(),
      waitForIdle: jest.fn().mockResolvedValue(undefined)
    };
    logger = { error: jest.fn(), info: jest.fn() };
  });

  it("busca pedidos PROCESSING e delega ao processador", async () => {
    repository.findProcessable.mockResolvedValue([order]);
    processor.processOrder.mockResolvedValue({
      kind: "RETRY_SCHEDULED",
      order
    });
    const worker = createOrderWorker({
      logger,
      now: () => timestamp,
      orderProcessor: processor,
      orderRepository: repository
    });

    await worker.runOnce();

    expect(repository.findProcessable).toHaveBeenCalledWith(10, timestamp);
    expect(processor.processOrder).toHaveBeenCalledWith("order-1");
    expect(logger.info).toHaveBeenCalledWith(
      "order.worker.processed",
      {
        orderId: "order-1",
        itemCount: 1,
        status: "PROCESSING",
        processingAttempt: 1,
        outcome: "RETRY_SCHEDULED"
      }
    );
  });

  it("não sobrepõe ciclos e aguarda o processador no stop", async () => {
    let resolveProcessing: () => void = () => undefined;
    const pendingProcessing = new Promise<void>((resolve) => {
      resolveProcessing = resolve;
    });
    repository.findProcessable.mockResolvedValue([order]);
    processor.processOrder.mockImplementation(async () => {
      await pendingProcessing;
      return { kind: "CONFIRMED", order };
    });
    const worker = createOrderWorker({
      logger,
      now: () => timestamp,
      orderProcessor: processor,
      orderRepository: repository
    });

    const firstCycle = worker.runOnce();
    const secondCycle = worker.runOnce();

    expect(secondCycle).toBe(firstCycle);
    resolveProcessing();
    await firstCycle;
    await worker.stop();
    expect(processor.processOrder).toHaveBeenCalledTimes(1);
    expect(processor.waitForIdle).toHaveBeenCalledTimes(1);
  });
});
