"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  CreateOrderItemRequest,
  CreateOrderRequest,
  Order,
  OrderStatusResponse
} from "@case-cell-shop/contracts";

import {
  ApiClientError,
  apiClient as defaultApiClient,
  getOrderReference,
  type ApiClient,
  type CreateOrderApiResult
} from "@/lib/api-client";
import { useOrderPolling } from "./useOrderPolling";

interface CheckoutIntent {
  fingerprint: string;
  idempotencyKey: string;
  request: CreateOrderRequest;
}

interface CheckoutItemsState {
  items: CreateOrderItemRequest[];
}

export type CheckoutState =
  | { phase: "IDLE" }
  | ({ phase: "SUBMITTING" } & CheckoutItemsState)
  | ({ orderId: string; phase: "PROCESSING" } & CheckoutItemsState)
  | ({
      order: Order;
      orderId: string;
      phase: "CONFIRMED";
      replayed: boolean;
    } & CheckoutItemsState)
  | ({
      message: string;
      orderId?: string;
      phase: "TEMPORARY_FAILURE";
      requestId: string;
    } & CheckoutItemsState)
  | ({
      affectedProductIds: string[];
      message: string;
      phase: "STOCK_REJECTED";
    } & CheckoutItemsState)
  | ({
      affectedProductIds: string[];
      message: string;
      phase: "PRODUCT_UNAVAILABLE";
    } & CheckoutItemsState)
  | ({ message: string; phase: "IDEMPOTENCY_CONFLICT" } & CheckoutItemsState)
  | ({
      message: string;
      orderId?: string;
      phase: "FAILED";
    } & CheckoutItemsState)
  | ({
      message: string;
      phase: "UNEXPECTED_ERROR";
      retryable: boolean;
    } & CheckoutItemsState)
  | ({ orderId: string; phase: "POLLING_TIMEOUT" } & CheckoutItemsState);

interface UseCheckoutOptions {
  client?: Pick<ApiClient, "createOrder" | "getOrderStatus">;
  createIdempotencyKey?: () => string;
  onConfirmed?: (order: Order) => void;
  onStockRejected?: (productIds: string[]) => void;
  pollingIntervalMs?: number;
  pollingTimeoutMs?: number;
}

export interface UseCheckoutResult {
  checkout(items: CreateOrderItemRequest[]): Promise<void>;
  invalidateIntent(): void;
  isLocked: boolean;
  reset(): void;
  resumePolling(): void;
  retry(): Promise<void>;
  retryAsNewIntent(): Promise<void>;
  state: CheckoutState;
}

function compareProductIds(
  first: CreateOrderItemRequest,
  second: CreateOrderItemRequest
): number {
  if (first.productId < second.productId) {
    return -1;
  }

  if (first.productId > second.productId) {
    return 1;
  }

  return 0;
}

function normalizeItems(
  items: CreateOrderItemRequest[]
): CreateOrderItemRequest[] {
  return items
    .map((item) => ({
      productId: item.productId.normalize("NFC"),
      quantity: item.quantity
    }))
    .sort(compareProductIds);
}

function createBrowserIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto;

  if (typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hexadecimal = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");

  return [
    hexadecimal.slice(0, 8),
    hexadecimal.slice(8, 12),
    hexadecimal.slice(12, 16),
    hexadecimal.slice(16, 20),
    hexadecimal.slice(20)
  ].join("-");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function toClientError(error: unknown): ApiClientError {
  if (error instanceof ApiClientError) {
    return error;
  }

  return new ApiClientError({
    code: "UNEXPECTED_ERROR",
    message:
      error instanceof Error
        ? error.message
        : "Ocorreu um erro inesperado durante a compra.",
    requestId: "unavailable",
    retryable: true,
    status: 0
  });
}

function getAffectedProductIds(
  details: Record<string, unknown>,
  fallbackItems: CreateOrderItemRequest[]
): string[] {
  if (Array.isArray(details.productIds)) {
    const productIds = details.productIds.filter(
      (value): value is string => typeof value === "string"
    );

    if (productIds.length > 0) {
      return productIds;
    }
  }

  if (Array.isArray(details.items)) {
    const productIds = details.items.flatMap((value) => {
      if (
        typeof value === "object" &&
        value !== null &&
        "productId" in value &&
        typeof value.productId === "string"
      ) {
        return [value.productId];
      }

      return [];
    });

    if (productIds.length > 0) {
      return productIds;
    }
  }

  return fallbackItems.map((item) => item.productId);
}

function toOrder(status: OrderStatusResponse): Order {
  return {
    createdAt: status.createdAt,
    id: status.orderId,
    items: status.items,
    status: status.status,
    totalPriceInCents: status.totalPriceInCents,
    updatedAt: status.updatedAt
  };
}

export function useCheckout(
  options: UseCheckoutOptions = {}
): UseCheckoutResult {
  const client = options.client ?? defaultApiClient;
  const createIdempotencyKey =
    options.createIdempotencyKey ?? createBrowserIdempotencyKey;
  const onConfirmedRef = useRef(options.onConfirmed);
  const onStockRejectedRef = useRef(options.onStockRejected);
  const mountedRef = useRef(true);
  const submittingRef = useRef(false);
  const requestAbortControllerRef = useRef<AbortController | null>(null);
  const intentRef = useRef<CheckoutIntent | null>(null);
  const handledPollingResultRef = useRef<string | null>(null);
  const [state, setState] = useState<CheckoutState>({ phase: "IDLE" });
  const stateRef = useRef<CheckoutState>(state);
  const polling = useOrderPolling({
    client,
    intervalMs: options.pollingIntervalMs,
    timeoutMs: options.pollingTimeoutMs
  });

  onConfirmedRef.current = options.onConfirmed;
  onStockRejectedRef.current = options.onStockRejected;

  const updateState = useCallback((nextState: CheckoutState) => {
    stateRef.current = nextState;

    if (mountedRef.current) {
      setState(nextState);
    }
  }, []);

  const confirmOrder = useCallback(
    (order: Order, replayed: boolean) => {
      const items =
        intentRef.current?.request.items ??
        order.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity
        }));

      updateState({
        items,
        order,
        orderId: order.id,
        phase: "CONFIRMED",
        replayed
      });
      onConfirmedRef.current?.(order);
    },
    [updateState]
  );

  const handleOrderResult = useCallback(
    (result: CreateOrderApiResult, intent: CheckoutIntent): void => {
      if (result.kind === "PROCESSING") {
        handledPollingResultRef.current = null;
        polling.start(result.orderId);
        updateState({
          items: intent.request.items,
          orderId: result.orderId,
          phase: "PROCESSING"
        });
        return;
      }

      switch (result.order.status) {
        case "CONFIRMED":
          confirmOrder(result.order, result.replayed);
          return;
        case "PENDING":
        case "PROCESSING":
          handledPollingResultRef.current = null;
          polling.start(result.order.id, result.order.status);
          updateState({
            items: intent.request.items,
            orderId: result.order.id,
            phase: "PROCESSING"
          });
          return;
        case "STOCK_REJECTED": {
          const affectedProductIds = intent.request.items.map(
            (item) => item.productId
          );
          updateState({
            affectedProductIds,
            items: intent.request.items,
            message: "Um ou mais itens não possuem estoque suficiente.",
            phase: "STOCK_REJECTED"
          });
          onStockRejectedRef.current?.(affectedProductIds);
          return;
        }
        case "FAILED":
          updateState({
            items: intent.request.items,
            message: "O pedido não pôde ser confirmado pelo ERP.",
            orderId: result.order.id,
            phase: "FAILED"
          });
      }
    },
    [confirmOrder, polling, updateState]
  );

  const handleCheckoutError = useCallback(
    (error: unknown, intent: CheckoutIntent): void => {
      const clientError = toClientError(error);
      const baseState = { items: intent.request.items };

      switch (clientError.code) {
        case "INSUFFICIENT_STOCK": {
          const affectedProductIds = getAffectedProductIds(
            clientError.details,
            intent.request.items
          );
          updateState({
            ...baseState,
            affectedProductIds,
            message: "Um ou mais itens não possuem estoque suficiente.",
            phase: "STOCK_REJECTED"
          });
          onStockRejectedRef.current?.(affectedProductIds);
          return;
        }
        case "PRODUCT_NOT_FOUND": {
          const affectedProductIds = getAffectedProductIds(
            clientError.details,
            intent.request.items
          );
          updateState({
            ...baseState,
            affectedProductIds,
            message: "Um ou mais produtos não estão mais disponíveis.",
            phase: "PRODUCT_UNAVAILABLE"
          });
          onStockRejectedRef.current?.(affectedProductIds);
          return;
        }
        case "IDEMPOTENCY_CONFLICT":
          updateState({
            ...baseState,
            message:
              "Esta chave já está associada a outra compra. Inicie uma nova tentativa.",
            phase: "IDEMPOTENCY_CONFLICT"
          });
          return;
        case "ERP_TEMPORARILY_UNAVAILABLE": {
          const orderReference = getOrderReference(clientError);

          if (orderReference !== null) {
            handledPollingResultRef.current = null;
            polling.start(orderReference.orderId);
          }

          updateState({
            ...baseState,
            message: "O ERP está instável. Seu carrinho foi preservado.",
            ...(orderReference === null
              ? {}
              : { orderId: orderReference.orderId }),
            phase: "TEMPORARY_FAILURE",
            requestId: clientError.requestId
          });
          return;
        }
        case "ERP_PROCESSING_FAILED": {
          const orderReference = getOrderReference(clientError);

          updateState({
            ...baseState,
            message: "O ERP não confirmou o pedido após todas as tentativas.",
            ...(orderReference === null
              ? {}
              : { orderId: orderReference.orderId }),
            phase: "FAILED"
          });
          return;
        }
        default:
          updateState({
            ...baseState,
            message:
              clientError.code === "NETWORK_ERROR"
                ? "Não foi possível confirmar se a API recebeu o pedido."
                : "Não foi possível concluir a compra.",
            phase: "UNEXPECTED_ERROR",
            retryable: clientError.retryable
          });
      }
    },
    [polling, updateState]
  );

  const submit = useCallback(
    async (intent: CheckoutIntent): Promise<void> => {
      if (submittingRef.current) {
        return;
      }

      submittingRef.current = true;
      requestAbortControllerRef.current?.abort();
      const abortController = new AbortController();
      requestAbortControllerRef.current = abortController;
      updateState({
        items: intent.request.items,
        phase: "SUBMITTING"
      });

      try {
        const result = await client.createOrder(
          intent.request,
          intent.idempotencyKey,
          abortController.signal
        );

        if (!mountedRef.current || abortController.signal.aborted) {
          return;
        }

        handleOrderResult(result, intent);
      } catch (error: unknown) {
        if (
          !mountedRef.current ||
          abortController.signal.aborted ||
          isAbortError(error)
        ) {
          return;
        }

        handleCheckoutError(error, intent);
      } finally {
        if (requestAbortControllerRef.current === abortController) {
          requestAbortControllerRef.current = null;
        }

        submittingRef.current = false;
      }
    },
    [client, handleCheckoutError, handleOrderResult, updateState]
  );

  const checkout = useCallback(
    async (items: CreateOrderItemRequest[]): Promise<void> => {
      if (
        items.length === 0 ||
        stateRef.current.phase === "SUBMITTING" ||
        stateRef.current.phase === "PROCESSING"
      ) {
        return;
      }

      polling.stop();
      const normalizedItems = normalizeItems(items);
      const fingerprint = JSON.stringify(normalizedItems);
      const previousIntent = intentRef.current;
      const intent = {
        fingerprint,
        idempotencyKey:
          previousIntent?.fingerprint === fingerprint
            ? previousIntent.idempotencyKey
            : createIdempotencyKey(),
        request: { items: normalizedItems }
      } satisfies CheckoutIntent;
      intentRef.current = intent;
      handledPollingResultRef.current = null;
      await submit(intent);
    },
    [createIdempotencyKey, polling, submit]
  );

  const retry = useCallback(async (): Promise<void> => {
    const intent = intentRef.current;

    if (intent === null) {
      return;
    }

    polling.stop();
    handledPollingResultRef.current = null;
    await submit(intent);
  }, [polling, submit]);

  const retryAsNewIntent = useCallback(async (): Promise<void> => {
    const previousIntent = intentRef.current;

    if (previousIntent === null) {
      return;
    }

    const newIntent = {
      fingerprint: previousIntent.fingerprint,
      idempotencyKey: createIdempotencyKey(),
      request: previousIntent.request
    } satisfies CheckoutIntent;
    intentRef.current = newIntent;
    polling.stop();
    handledPollingResultRef.current = null;
    await submit(newIntent);
  }, [createIdempotencyKey, polling, submit]);

  const resumePolling = useCallback(() => {
    const current = stateRef.current;

    if (
      current.phase !== "POLLING_TIMEOUT" &&
      current.phase !== "PROCESSING"
    ) {
      return;
    }

    handledPollingResultRef.current = null;
    polling.start(current.orderId);
    updateState({
      items: current.items,
      orderId: current.orderId,
      phase: "PROCESSING"
    });
  }, [polling, updateState]);

  const reset = useCallback(() => {
    requestAbortControllerRef.current?.abort();
    handledPollingResultRef.current = null;
    polling.stop();
    updateState({ phase: "IDLE" });
  }, [polling, updateState]);

  const invalidateIntent = useCallback(() => {
    intentRef.current = null;
    reset();
  }, [reset]);

  useEffect(() => {
    const pollingState = polling.state;

    if (pollingState.phase === "IDLE" || pollingState.phase === "POLLING") {
      return;
    }

    const resultKey = `${pollingState.orderId}:${pollingState.phase}`;

    if (handledPollingResultRef.current === resultKey) {
      return;
    }

    const current = stateRef.current;

    if (
      current.phase !== "PROCESSING" &&
      current.phase !== "TEMPORARY_FAILURE"
    ) {
      return;
    }

    if (current.orderId !== pollingState.orderId) {
      return;
    }

    handledPollingResultRef.current = resultKey;

    switch (pollingState.phase) {
      case "CONFIRMED":
        confirmOrder(toOrder(pollingState.order), false);
        return;
      case "FAILED":
        if (pollingState.order.status === "STOCK_REJECTED") {
          const affectedProductIds = current.items.map(
            (item) => item.productId
          );
          updateState({
            affectedProductIds,
            items: current.items,
            message: "Um ou mais itens não possuem estoque suficiente.",
            phase: "STOCK_REJECTED"
          });
          onStockRejectedRef.current?.(affectedProductIds);
          return;
        }

        updateState({
          items: current.items,
          message: "O ERP não conseguiu confirmar este pedido.",
          orderId: pollingState.orderId,
          phase: "FAILED"
        });
        return;
      case "TIMED_OUT":
        updateState({
          items: current.items,
          orderId: pollingState.orderId,
          phase: "POLLING_TIMEOUT"
        });
        return;
      case "ERROR":
        updateState({
          items: current.items,
          message: "Não foi possível consultar a situação do pedido.",
          phase: "UNEXPECTED_ERROR",
          retryable: pollingState.error.retryable
        });
        return;
    }
  }, [confirmOrder, polling.state, updateState]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      requestAbortControllerRef.current?.abort();
    };
  }, []);

  const isLocked =
    state.phase === "SUBMITTING" ||
    state.phase === "PROCESSING" ||
    state.phase === "TEMPORARY_FAILURE" ||
    state.phase === "IDEMPOTENCY_CONFLICT" ||
    state.phase === "POLLING_TIMEOUT" ||
    (state.phase === "UNEXPECTED_ERROR" && state.retryable);

  return {
    checkout,
    invalidateIntent,
    isLocked,
    reset,
    resumePolling,
    retry,
    retryAsNewIntent,
    state
  };
}
