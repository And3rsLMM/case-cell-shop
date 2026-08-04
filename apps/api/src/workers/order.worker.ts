import type { OrderRepository } from "../repositories/order.repository";
import type { OrderProcessor } from "../services/order-processor.service";
import { serializeError, type Logger } from "../utils/logger";

export interface OrderWorker {
  runOnce(): Promise<void>;
  start(): void;
  stop(): Promise<void>;
}

interface OrderWorkerDependencies {
  logger: Logger;
  orderProcessor: OrderProcessor;
  orderRepository: OrderRepository;
  batchSize?: number;
  intervalMs?: number;
  now?: () => Date;
  wait?: (delayMs: number) => Promise<void>;
}

function defaultWait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export function createOrderWorker(
  dependencies: OrderWorkerDependencies
): OrderWorker {
  const batchSize = dependencies.batchSize ?? 10;
  const intervalMs = dependencies.intervalMs ?? 250;
  const now = dependencies.now ?? (() => new Date());
  const wait = dependencies.wait ?? defaultWait;
  let stopRequested = false;
  let loopPromise: Promise<void> | null = null;
  let currentCycle: Promise<void> | null = null;

  const runOnce = (): Promise<void> => {
    if (currentCycle !== null) {
      return currentCycle;
    }

    currentCycle = (async () => {
      const orders =
        await dependencies.orderRepository.findProcessable(
          batchSize,
          now()
        );

      await Promise.all(
        orders.map(async (order) => {
          try {
            const outcome =
              await dependencies.orderProcessor.processOrder(order.id);
            const processedOrder = outcome.order ?? order;
            dependencies.logger.info("order.worker.processed", {
              orderId: order.id,
              itemCount: processedOrder.items.length,
              status: processedOrder.status,
              processingAttempt: processedOrder.processingAttempts,
              ...(processedOrder.errorCode === null
                ? {}
                : { errorCode: processedOrder.errorCode }),
              outcome: outcome.kind
            });
          } catch (error: unknown) {
            dependencies.logger.error("order.worker.failed", {
              orderId: order.id,
              itemCount: order.items.length,
              status: order.status,
              processingAttempt: order.processingAttempts,
              errorCode: "ORDER_WORKER_PROCESSING_FAILED",
              error: serializeError(error)
            });
          }
        })
      );
    })().finally(() => {
      currentCycle = null;
    });

    return currentCycle;
  };

  return {
    runOnce,
    start: () => {
      if (loopPromise !== null) {
        return;
      }

      stopRequested = false;
      loopPromise = (async () => {
        while (!stopRequested) {
          try {
            await runOnce();
          } catch (error: unknown) {
            dependencies.logger.error("order.worker.cycle-failed", {
              errorCode: "ORDER_WORKER_CYCLE_FAILED",
              error: serializeError(error)
            });
          }

          if (!stopRequested) {
            await wait(intervalMs);
          }
        }
      })();
    },
    stop: async () => {
      stopRequested = true;

      if (loopPromise !== null) {
        await loopPromise;
        loopPromise = null;
      }

      await dependencies.orderProcessor.waitForIdle();
    }
  };
}
