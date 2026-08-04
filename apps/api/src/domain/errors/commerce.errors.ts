import { createAppError, type AppError } from "./app-error";

export function createIdempotencyKeyRequiredError(): AppError {
  return createAppError({
    code: "IDEMPOTENCY_KEY_REQUIRED",
    details: {},
    message: "O header Idempotency-Key é obrigatório.",
    statusCode: 400
  });
}

export function createProductNotFoundError(
  productIds: string[] = []
): AppError {
  return createAppError({
    code: "PRODUCT_NOT_FOUND",
    details: productIds.length === 0 ? {} : { productIds },
    message:
      productIds.length === 0
        ? "Produto não encontrado."
        : "Um ou mais produtos não foram encontrados ou estão inativos.",
    statusCode: 404
  });
}

export function createOrderNotFoundError(): AppError {
  return createAppError({
    code: "ORDER_NOT_FOUND",
    details: {},
    message: "Pedido não encontrado.",
    statusCode: 404
  });
}

interface InsufficientStockItem {
  availableQuantity: number;
  productId: string;
  requestedQuantity: number;
}

export function createInsufficientStockError(
  items: InsufficientStockItem[] = []
): AppError {
  return createAppError({
    code: "INSUFFICIENT_STOCK",
    details: items.length === 0 ? {} : { items },
    message: "Não há estoque suficiente para um ou mais produtos.",
    statusCode: 409
  });
}

export function createIdempotencyConflictError(): AppError {
  return createAppError({
    code: "IDEMPOTENCY_CONFLICT",
    details: {},
    message: "A chave de idempotência já foi usada com outros dados.",
    statusCode: 409
  });
}

interface ErpTemporarilyUnavailableErrorInput {
  cause?: unknown;
  orderId: string;
  statusUrl: string;
}

export function createErpTemporarilyUnavailableError(
  input: ErpTemporarilyUnavailableErrorInput
): AppError {
  return createAppError({
    ...(input.cause === undefined ? {} : { cause: input.cause }),
    code: "ERP_TEMPORARILY_UNAVAILABLE",
    details: {
      orderId: input.orderId,
      statusUrl: input.statusUrl
    },
    message: "O ERP está temporariamente indisponível.",
    retryable: true,
    statusCode: 503
  });
}

export function createErpProcessingFailedError(
  orderId: string,
  statusUrl: string
): AppError {
  return createAppError({
    code: "ERP_PROCESSING_FAILED",
    details: {
      orderId,
      statusUrl
    },
    message: "O pedido falhou após atingir o limite de tentativas no ERP.",
    retryable: false,
    statusCode: 502
  });
}
