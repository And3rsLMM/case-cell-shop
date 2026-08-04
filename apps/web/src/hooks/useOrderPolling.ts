"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  OrderStatus,
  OrderStatusResponse
} from "@case-cell-shop/contracts";

import {
  ApiClientError,
  apiClient as defaultApiClient,
  type ApiClient
} from "@/lib/api-client";

const DEFAULT_POLLING_INTERVAL_MS = 1_500;
const DEFAULT_POLLING_TIMEOUT_MS = 30_000;

interface PollingTarget {
  orderId: string;
  runId: number;
}

export type OrderPollingState =
  | { phase: "IDLE" }
  | {
      lastError: string | null;
      lastStatus: "PENDING" | "PROCESSING";
      orderId: string;
      phase: "POLLING";
    }
  | {
      order: OrderStatusResponse;
      orderId: string;
      phase: "CONFIRMED";
    }
  | {
      order: OrderStatusResponse;
      orderId: string;
      phase: "FAILED";
    }
  | {
      orderId: string;
      phase: "TIMED_OUT";
    }
  | {
      error: ApiClientError;
      orderId: string;
      phase: "ERROR";
    };

interface UseOrderPollingOptions {
  client?: Pick<ApiClient, "getOrderStatus">;
  intervalMs?: number | undefined;
  timeoutMs?: number | undefined;
}

export interface UseOrderPollingResult {
  start(orderId: string, initialStatus?: "PENDING" | "PROCESSING"): void;
  state: OrderPollingState;
  stop(): void;
}

function isPendingStatus(
  status: OrderStatus
): status is "PENDING" | "PROCESSING" {
  return status === "PENDING" || status === "PROCESSING";
}

function normalizePollingError(error: unknown): ApiClientError {
  if (error instanceof ApiClientError) {
    return error;
  }

  return new ApiClientError({
    code: "POLLING_ERROR",
    message:
      error instanceof Error
        ? error.message
        : "Não foi possível consultar o pedido.",
    requestId: "unavailable",
    retryable: true,
    status: 0
  });
}

export function useOrderPolling(
  options: UseOrderPollingOptions = {}
): UseOrderPollingResult {
  const client = options.client ?? defaultApiClient;
  const intervalMs = options.intervalMs ?? DEFAULT_POLLING_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_POLLING_TIMEOUT_MS;
  const runSequence = useRef(0);
  const [target, setTarget] = useState<PollingTarget | null>(null);
  const [state, setState] = useState<OrderPollingState>({ phase: "IDLE" });

  const start = useCallback(
    (
      orderId: string,
      initialStatus: "PENDING" | "PROCESSING" = "PROCESSING"
    ) => {
      runSequence.current += 1;
      setState({
        lastError: null,
        lastStatus: initialStatus,
        orderId,
        phase: "POLLING"
      });
      setTarget({ orderId, runId: runSequence.current });
    },
    []
  );

  const stop = useCallback(() => {
    runSequence.current += 1;
    setTarget(null);
    setState({ phase: "IDLE" });
  }, []);

  useEffect(() => {
    if (target === null) {
      return;
    }

    const deadline = Date.now() + timeoutMs;
    let active = true;
    let abortController: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null;

    const clearTimers = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }

      if (deadlineTimer !== null) {
        clearTimeout(deadlineTimer);
        deadlineTimer = null;
      }
    };

    const finish = (nextState: OrderPollingState): void => {
      if (!active) {
        return;
      }

      active = false;
      clearTimers();
      abortController?.abort();
      abortController = null;
      setState(nextState);
    };

    const scheduleNextPoll = (): void => {
      timer = setTimeout(() => {
        void poll();
      }, intervalMs);
    };

    const poll = async (): Promise<void> => {
      if (!active) {
        return;
      }

      if (Date.now() >= deadline) {
        finish({ orderId: target.orderId, phase: "TIMED_OUT" });
        return;
      }

      const currentController = new AbortController();
      abortController = currentController;

      try {
        const order = await client.getOrderStatus(
          target.orderId,
          currentController.signal
        );

        if (abortController === currentController) {
          abortController = null;
        }

        if (!active) {
          return;
        }

        if (isPendingStatus(order.status)) {
          setState({
            lastError: null,
            lastStatus: order.status,
            orderId: target.orderId,
            phase: "POLLING"
          });
          scheduleNextPoll();
          return;
        }

        if (order.status === "CONFIRMED") {
          finish({
            order,
            orderId: target.orderId,
            phase: "CONFIRMED"
          });
          return;
        }

        finish({ order, orderId: target.orderId, phase: "FAILED" });
      } catch (error: unknown) {
        if (abortController === currentController) {
          abortController = null;
        }

        if (
          !active ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          return;
        }

        const pollingError = normalizePollingError(error);

        if (pollingError.retryable && Date.now() < deadline) {
          setState((current) => ({
            lastError: pollingError.message,
            lastStatus:
              current.phase === "POLLING"
                ? current.lastStatus
                : "PROCESSING",
            orderId: target.orderId,
            phase: "POLLING"
          }));
          scheduleNextPoll();
          return;
        }

        finish({
          error: pollingError,
          orderId: target.orderId,
          phase: "ERROR"
        });
      }
    };

    deadlineTimer = setTimeout(() => {
      finish({ orderId: target.orderId, phase: "TIMED_OUT" });
    }, timeoutMs);
    scheduleNextPoll();

    return () => {
      active = false;
      clearTimers();
      abortController?.abort();
      abortController = null;
    };
  }, [client, intervalMs, target, timeoutMs]);

  return { start, state, stop };
}
