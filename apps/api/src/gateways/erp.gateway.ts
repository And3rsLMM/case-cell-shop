import type { Logger } from "../utils/logger";

export type ErpSimulationMode =
  | "success"
  | "slow"
  | "temporary-failure";

export interface OrderToProcess {
  orderId: string;
  totalPriceInCents: number;
  items: Array<{
    productId: string;
    quantity: number;
    unitPriceInCents: number;
    subtotalInCents: number;
  }>;
}

export interface ProcessingContext {
  attempt: number;
  mode?: ErpSimulationMode;
  requestId?: string;
}

export type ErpProcessingResult =
  | {
      outcome: "SUCCESS";
      durationMs: number;
      simulatedDelayMs: number;
    }
  | {
      outcome: "TEMPORARY_FAILURE";
      durationMs: number;
      simulatedDelayMs: number;
      errorCode: "ERP_TEMPORARY_FAILURE";
      errorMessage: string;
    };

export interface ErpGateway {
  processOrder(
    order: OrderToProcess,
    context: ProcessingContext
  ): Promise<ErpProcessingResult>;
}

export type RandomFunction = () => number;
export type WaitFunction = (delayMs: number) => Promise<void>;
export type ClockFunction = () => number;

export interface SimulatedErpGatewayOptions {
  failureRate: number;
  logger: Logger;
  maxDelayMs: number;
  minDelayMs: number;
  syncTimeoutMs: number;
  clock?: ClockFunction;
  random?: RandomFunction;
  wait?: WaitFunction;
}

function defaultWait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function clampRandom(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(Math.max(value, 0), 0.999_999_999);
}

function sampleDelay(
  minDelayMs: number,
  maxDelayMs: number,
  random: RandomFunction
): number {
  const range = maxDelayMs - minDelayMs + 1;
  return minDelayMs + Math.floor(clampRandom(random()) * range);
}

export function createSimulatedErpGateway(
  options: SimulatedErpGatewayOptions
): ErpGateway {
  const clock = options.clock ?? Date.now;
  const random = options.random ?? Math.random;
  const wait = options.wait ?? defaultWait;

  return {
    processOrder: async (order, context) => {
      const startedAt = clock();
      const simulatedDelayMs =
        context.mode === "slow"
          ? Math.max(options.maxDelayMs, options.syncTimeoutMs + 1)
          : sampleDelay(
              options.minDelayMs,
              options.maxDelayMs,
              random
            );
      const isTemporaryFailure =
        context.mode === "temporary-failure" ||
        (context.mode === undefined && random() < options.failureRate);

      await wait(simulatedDelayMs);

      const durationMs = Math.max(0, clock() - startedAt);
      const outcome = isTemporaryFailure
        ? "TEMPORARY_FAILURE"
        : "SUCCESS";

      options.logger.info("erp.order.processed", {
        ...(context.requestId === undefined
          ? {}
          : { requestId: context.requestId }),
        orderId: order.orderId,
        itemCount: order.items.length,
        status: isTemporaryFailure ? "PROCESSING" : "CONFIRMED",
        processingAttempt: context.attempt,
        mode: context.mode ?? "automatic",
        outcome,
        simulatedDelayMs,
        durationMs,
        ...(isTemporaryFailure
          ? { errorCode: "ERP_TEMPORARY_FAILURE" }
          : {})
      });

      if (isTemporaryFailure) {
        return {
          outcome: "TEMPORARY_FAILURE",
          durationMs,
          simulatedDelayMs,
          errorCode: "ERP_TEMPORARY_FAILURE",
          errorMessage: "O ERP apresentou uma falha temporária."
        };
      }

      return {
        outcome: "SUCCESS",
        durationMs,
        simulatedDelayMs
      };
    }
  };
}
