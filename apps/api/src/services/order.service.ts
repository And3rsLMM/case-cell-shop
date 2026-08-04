import type {
  CreateOrderRequest,
  OrderAcceptedResponse,
  OrderResponse,
  OrderStatusResponse
} from "@case-cell-shop/contracts";

import {
  createErpProcessingFailedError,
  createErpTemporarilyUnavailableError,
  createIdempotencyConflictError,
  createInsufficientStockError,
  createOrderNotFoundError,
  createProductNotFoundError
} from "../domain/errors/commerce.errors";
import {
  toOrderAcceptedResponse,
  toOrderResponse,
  toOrderStatusResponse
} from "../infrastructure/database/mappers/order.mapper";
import type {
  CreateOrderAttemptResult,
  OrderRepository,
  OrderWithItems
} from "../repositories/order.repository";
import {
  createOrderRequestHash,
  normalizeOrderItems
} from "../utils/order-request-hash";
import type {
  OrderProcessingOutcome,
  OrderProcessor
} from "./order-processor.service";

export interface CreateOrderInput {
  idempotencyKey: string;
  request: CreateOrderRequest;
  requestId?: string;
}

export type CreateOrderResult =
  | { body: OrderResponse; kind: "CREATED" }
  | { body: OrderAcceptedResponse; kind: "ACCEPTED" }
  | { body: OrderResponse; kind: "REPLAYED" };

export interface OrderService {
  create(input: CreateOrderInput): Promise<CreateOrderResult>;
  getStatus(id: string): Promise<OrderStatusResponse>;
}

interface OrderServiceDependencies {
  orderProcessor: OrderProcessor;
  orderRepository: OrderRepository;
  syncTimeoutMs: number;
  timeoutWait?: (delayMs: number) => Promise<void>;
}

type ProcessingWindowResult =
  | { kind: "COMPLETED"; outcome: OrderProcessingOutcome }
  | { kind: "TIMED_OUT" };

function defaultTimeoutWait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function waitWithinSynchronousWindow(
  processing: Promise<OrderProcessingOutcome>,
  timeoutMs: number,
  wait: (delayMs: number) => Promise<void>
): Promise<ProcessingWindowResult> {
  return Promise.race([
    processing.then(
      (outcome): ProcessingWindowResult => ({
        kind: "COMPLETED",
        outcome
      })
    ),
    wait(timeoutMs).then(
      (): ProcessingWindowResult => ({ kind: "TIMED_OUT" })
    )
  ]);
}

function createStatusUrl(orderId: string): string {
  return `/api/orders/${encodeURIComponent(orderId)}`;
}

function replayOrThrowConflict(
  order: OrderWithItems,
  requestHash: string
): CreateOrderResult {
  if (order.requestHash !== requestHash) {
    throw createIdempotencyConflictError();
  }

  return {
    body: toOrderResponse(order),
    kind: "REPLAYED"
  };
}

function handleAttemptWithoutProcessing(
  attempt: Exclude<CreateOrderAttemptResult, { kind: "CREATED" }>,
  requestHash: string
): CreateOrderResult {
  switch (attempt.kind) {
    case "EXISTING":
      return replayOrThrowConflict(attempt.order, requestHash);
    case "INSUFFICIENT_STOCK":
      throw createInsufficientStockError(attempt.items);
    case "PRODUCT_NOT_FOUND":
      throw createProductNotFoundError(attempt.productIds);
  }
}

function handleCompletedProcessing(
  outcome: OrderProcessingOutcome,
  fallbackOrder: OrderWithItems,
  statusUrl: string
): CreateOrderResult {
  switch (outcome.kind) {
    case "CONFIRMED":
      return {
        body: toOrderResponse(outcome.order),
        kind: "CREATED"
      };
    case "RETRY_SCHEDULED":
      throw createErpTemporarilyUnavailableError({
        orderId: outcome.order.id,
        statusUrl
      });
    case "FAILED":
      throw createErpProcessingFailedError(outcome.order.id, statusUrl);
    case "NOT_PROCESSABLE": {
      if (outcome.order?.status === "CONFIRMED") {
        return {
          body: toOrderResponse(outcome.order),
          kind: "CREATED"
        };
      }

      if (outcome.order?.status === "FAILED") {
        throw createErpProcessingFailedError(
          outcome.order.id,
          statusUrl
        );
      }

      return {
        body: toOrderAcceptedResponse(
          outcome.order ?? fallbackOrder,
          statusUrl
        ),
        kind: "ACCEPTED"
      };
    }
  }
}

export function createOrderService(
  dependencies: OrderServiceDependencies
): OrderService {
  return {
    create: async ({ idempotencyKey, request, requestId }) => {
      const normalizedRequest = {
        items: normalizeOrderItems(request.items)
      } satisfies CreateOrderRequest;
      const requestHash = createOrderRequestHash(normalizedRequest);
      const existingOrder =
        await dependencies.orderRepository.findByIdempotencyKey(
          idempotencyKey
        );

      if (existingOrder !== null) {
        return replayOrThrowConflict(existingOrder, requestHash);
      }

      const attempt = await dependencies.orderRepository.createAttempt({
        idempotencyKey,
        items: normalizedRequest.items,
        requestHash
      });

      if (attempt.kind !== "CREATED") {
        return handleAttemptWithoutProcessing(attempt, requestHash);
      }

      const statusUrl = createStatusUrl(attempt.order.id);
      const processing =
        requestId === undefined
          ? dependencies.orderProcessor.processOrder(attempt.order.id)
          : dependencies.orderProcessor.processOrder(attempt.order.id, {
              requestId
            });
      const windowResult = await waitWithinSynchronousWindow(
        processing,
        dependencies.syncTimeoutMs,
        dependencies.timeoutWait ?? defaultTimeoutWait
      );

      if (windowResult.kind === "TIMED_OUT") {
        return {
          body: toOrderAcceptedResponse(attempt.order, statusUrl),
          kind: "ACCEPTED"
        };
      }

      return handleCompletedProcessing(
        windowResult.outcome,
        attempt.order,
        statusUrl
      );
    },
    getStatus: async (id) => {
      const order = await dependencies.orderRepository.findById(id);

      if (order === null) {
        throw createOrderNotFoundError();
      }

      return toOrderStatusResponse(order);
    }
  };
}
