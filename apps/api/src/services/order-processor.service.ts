import { randomUUID } from "node:crypto";

import type {
  ErpGateway,
  ErpSimulationMode
} from "../gateways/erp.gateway";
import type {
  ClaimedOrderTransitionResult,
  OrderRepository,
  OrderWithItems
} from "../repositories/order.repository";
import { serializeError, type Logger } from "../utils/logger";

export type OrderProcessingOutcome =
  | { kind: "CONFIRMED"; order: OrderWithItems }
  | { kind: "RETRY_SCHEDULED"; order: OrderWithItems }
  | { kind: "FAILED"; order: OrderWithItems }
  | { kind: "NOT_PROCESSABLE"; order: OrderWithItems | null };

export interface OrderProcessingContext {
  requestId?: string;
}

export interface OrderProcessor {
  processOrder(
    orderId: string,
    context?: OrderProcessingContext
  ): Promise<OrderProcessingOutcome>;
  waitForIdle(): Promise<void>;
}

interface OrderProcessorDependencies {
  erpGateway: ErpGateway;
  logger: Logger;
  maxAttempts: number;
  now?: () => Date;
  orderRepository: OrderRepository;
  processingLeaseMs?: number;
  processingTokenFactory?: () => string;
  simulationMode?: ErpSimulationMode;
}

const DEFAULT_PROCESSING_LEASE_MS = 30_000;
const MAX_ATTEMPTS_ERROR_CODE = "ERP_MAX_ATTEMPTS_EXCEEDED";
const MAX_ATTEMPTS_ERROR_MESSAGE =
  "O pedido falhou após atingir o limite de tentativas no ERP.";

function outcomeFromCurrentOrder(
  order: OrderWithItems | null
): OrderProcessingOutcome {
  if (order?.status === "CONFIRMED") {
    return { kind: "CONFIRMED", order };
  }

  if (order?.status === "FAILED") {
    return { kind: "FAILED", order };
  }

  return { kind: "NOT_PROCESSABLE", order };
}

function transitionOutcome(
  transition: ClaimedOrderTransitionResult,
  appliedKind: "CONFIRMED" | "FAILED" | "RETRY_SCHEDULED"
): OrderProcessingOutcome {
  if (transition.kind === "APPLIED") {
    return { kind: appliedKind, order: transition.order };
  }

  return outcomeFromCurrentOrder(transition.order);
}

async function failPermanently(
  orderId: string,
  claimToken: string,
  dependencies: OrderProcessorDependencies
): Promise<OrderProcessingOutcome> {
  const transition =
    await dependencies.orderRepository.failAndReleaseStock(
      orderId,
      claimToken,
      MAX_ATTEMPTS_ERROR_CODE,
      MAX_ATTEMPTS_ERROR_MESSAGE
    );

  return transitionOutcome(transition, "FAILED");
}

async function handleTemporaryFailure(
  order: OrderWithItems,
  claimToken: string,
  errorCode: string,
  errorMessage: string,
  dependencies: OrderProcessorDependencies
): Promise<OrderProcessingOutcome> {
  if (order.processingAttempts >= dependencies.maxAttempts) {
    return failPermanently(order.id, claimToken, dependencies);
  }

  const transition =
    await dependencies.orderRepository.markTemporaryFailure(
      order.id,
      claimToken,
      errorCode,
      errorMessage
    );

  return transitionOutcome(transition, "RETRY_SCHEDULED");
}

function getOrderForLog(
  outcome: OrderProcessingOutcome,
  fallback: OrderWithItems
): OrderWithItems {
  return outcome.order ?? fallback;
}

async function executeProcessing(
  orderId: string,
  context: OrderProcessingContext,
  dependencies: OrderProcessorDependencies
): Promise<OrderProcessingOutcome> {
  const claimedAt = dependencies.now?.() ?? new Date();
  const leaseMs =
    dependencies.processingLeaseMs ?? DEFAULT_PROCESSING_LEASE_MS;
  const claim =
    await dependencies.orderRepository.startProcessingAttempt(
      orderId,
      dependencies.maxAttempts,
      {
        claimedAt,
        leaseUntil: new Date(claimedAt.getTime() + leaseMs),
        token:
          dependencies.processingTokenFactory?.() ?? randomUUID()
      }
    );

  if (claim === null) {
    const currentOrder = await dependencies.orderRepository.findById(orderId);
    return outcomeFromCurrentOrder(currentOrder);
  }

  if (claim.kind === "EXHAUSTED") {
    return failPermanently(orderId, claim.token, dependencies);
  }

  const order = claim.order;
  const startedAt = Date.now();

  try {
    const result = await dependencies.erpGateway.processOrder(
      {
        orderId: order.id,
        totalPriceInCents: order.totalPriceInCents,
        items: order.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          unitPriceInCents: item.unitPriceInCents,
          subtotalInCents: item.subtotalInCents
        }))
      },
      {
        attempt: order.processingAttempts,
        ...(context.requestId === undefined
          ? {}
          : { requestId: context.requestId }),
        ...(dependencies.simulationMode === undefined
          ? {}
          : { mode: dependencies.simulationMode })
      }
    );

    if (result.outcome === "SUCCESS") {
      const transition =
        await dependencies.orderRepository.markConfirmed(
          order.id,
          claim.token
        );
      const outcome = transitionOutcome(transition, "CONFIRMED");
      const loggedOrder = getOrderForLog(outcome, order);
      dependencies.logger.info("order.processing.completed", {
        ...(context.requestId === undefined
          ? {}
          : { requestId: context.requestId }),
        orderId: loggedOrder.id,
        itemCount: loggedOrder.items.length,
        status: loggedOrder.status,
        durationMs: result.durationMs,
        processingAttempt: order.processingAttempts
      });
      return outcome;
    }

    const outcome = await handleTemporaryFailure(
      order,
      claim.token,
      result.errorCode,
      result.errorMessage,
      dependencies
    );
    const loggedOrder = getOrderForLog(outcome, order);
    dependencies.logger.info("order.processing.completed", {
      ...(context.requestId === undefined
        ? {}
        : { requestId: context.requestId }),
      orderId: loggedOrder.id,
      itemCount: loggedOrder.items.length,
      status: loggedOrder.status,
      durationMs: result.durationMs,
      processingAttempt: order.processingAttempts,
      errorCode: result.errorCode
    });
    return outcome;
  } catch (error: unknown) {
    dependencies.logger.error("erp.order.processing-failed", {
      ...(context.requestId === undefined
        ? {}
        : { requestId: context.requestId }),
      orderId: order.id,
      itemCount: order.items.length,
      status: order.status,
      durationMs: Math.max(0, Date.now() - startedAt),
      processingAttempt: order.processingAttempts,
      errorCode: "ERP_PROCESSING_EXCEPTION",
      error: serializeError(error)
    });

    return handleTemporaryFailure(
      order,
      claim.token,
      "ERP_TEMPORARY_FAILURE",
      "O ERP apresentou uma falha temporária.",
      dependencies
    );
  }
}

export function createOrderProcessor(
  dependencies: OrderProcessorDependencies
): OrderProcessor {
  const activeProcessing = new Map<
    string,
    Promise<OrderProcessingOutcome>
  >();

  return {
    processOrder: (orderId, context = {}) => {
      const currentProcessing = activeProcessing.get(orderId);

      if (currentProcessing !== undefined) {
        return currentProcessing;
      }

      const processing = executeProcessing(
        orderId,
        context,
        dependencies
      ).finally(() => {
        activeProcessing.delete(orderId);
      });
      activeProcessing.set(orderId, processing);
      return processing;
    },
    waitForIdle: async () => {
      while (activeProcessing.size > 0) {
        await Promise.allSettled([...activeProcessing.values()]);
      }
    }
  };
}
