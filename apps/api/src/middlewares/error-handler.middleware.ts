import type {
  ApiError,
  OrderStatus
} from "@case-cell-shop/contracts";
import type { ErrorRequestHandler } from "express";

import {
  createAppError,
  isAppError,
  type AppError
} from "../domain/errors/app-error";
import {
  getHttpLogContext,
  mergeHttpLogContext
} from "../utils/http-log-context";
import { serializeError, type Logger } from "../utils/logger";

function orderStatusForError(code: string): OrderStatus | undefined {
  switch (code) {
    case "INSUFFICIENT_STOCK":
      return "STOCK_REJECTED";
    case "ERP_TEMPORARILY_UNAVAILABLE":
      return "PROCESSING";
    case "ERP_PROCESSING_FAILED":
      return "FAILED";
    default:
      return undefined;
  }
}

function hasErrorType(error: unknown, type: string): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const candidate = error as Error & { type?: unknown };
  return candidate.type === type;
}

function normalizeError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (hasErrorType(error, "entity.parse.failed")) {
    return createAppError({
      cause: error,
      code: "INVALID_JSON",
      message: "O corpo da requisição contém JSON inválido.",
      statusCode: 400
    });
  }

  if (hasErrorType(error, "entity.too.large")) {
    return createAppError({
      cause: error,
      code: "PAYLOAD_TOO_LARGE",
      message: "O corpo da requisição excede o limite permitido.",
      statusCode: 413
    });
  }

  return createAppError({
    cause: error,
    code: "INTERNAL_ERROR",
    message: "Ocorreu um erro interno inesperado.",
    retryable: true,
    statusCode: 500
  });
}

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    const normalizedError = normalizeError(error);
    const errorBody = {
      code: normalizedError.code,
      details: normalizedError.details ?? {},
      message: normalizedError.message,
      retryable: normalizedError.retryable,
      requestId: request.requestId
    };
    const body = {
      error: errorBody
    } satisfies ApiError;
    const errorOrderId = normalizedError.details?.orderId;
    const orderStatus = orderStatusForError(normalizedError.code);

    mergeHttpLogContext(response, {
      errorCode: normalizedError.code,
      ...(typeof errorOrderId === "string"
        ? { orderId: errorOrderId }
        : {}),
      ...(orderStatus === undefined ? {} : { status: orderStatus })
    });

    logger.error("http.request.failed", {
      requestId: request.requestId,
      method: request.method,
      path: request.path,
      statusCode: normalizedError.statusCode,
      ...getHttpLogContext(response),
      error: serializeError(normalizedError.cause ?? error)
    });

    response.status(normalizedError.statusCode).json(body);
  };
}
