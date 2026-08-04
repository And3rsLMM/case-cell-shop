import type {
  ApiError,
  CreateOrderRequest,
  Order,
  OrderAcceptedResponse,
  OrderItem,
  OrderResponse,
  OrderStatus,
  OrderStatusResponse,
  Product,
  ProductListResponse
} from "@case-cell-shop/contracts";

const DEFAULT_API_BASE_URL = "http://localhost:3333";
const ORDER_STATUSES: readonly OrderStatus[] = [
  "PENDING",
  "PROCESSING",
  "CONFIRMED",
  "FAILED",
  "STOCK_REJECTED"
];

type FetchImplementation = typeof fetch;

interface ApiClientOptions {
  baseUrl?: string;
  fetchImplementation?: FetchImplementation;
}

type RequestOptions = RequestInit;

export type CreateOrderApiResult =
  | {
      kind: "ORDER";
      order: Order;
      replayed: boolean;
    }
  | {
      kind: "PROCESSING";
      orderId: string;
      statusUrl: string;
      replayed: false;
    };

interface ApiClientErrorInput {
  code: string;
  details?: Record<string, unknown> | undefined;
  message: string;
  requestId: string;
  retryable: boolean;
  status: number;
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly requestId: string;
  readonly retryable: boolean;
  readonly status: number;

  constructor(input: ApiClientErrorInput) {
    super(input.message);
    this.name = "ApiClientError";
    this.code = input.code;
    this.details = input.details ?? {};
    this.requestId = input.requestId;
    this.retryable = input.retryable;
    this.status = input.status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isOrderStatus(value: unknown): value is OrderStatus {
  return (
    typeof value === "string" &&
    ORDER_STATUSES.includes(value as OrderStatus)
  );
}

function isProduct(value: unknown): value is Product {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    isNonNegativeInteger(value.priceInCents) &&
    isNonNegativeInteger(value.availableQuantity)
  );
}

function isProductListResponse(value: unknown): value is ProductListResponse {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return false;
  }

  return (
    value.items.every(isProduct) &&
    (value.nextCursor === null || typeof value.nextCursor === "string")
  );
}

function isOrder(value: unknown): value is Order {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    isNonNegativeInteger(value.totalPriceInCents) &&
    Array.isArray(value.items) &&
    value.items.every(isOrderItem) &&
    isOrderStatus(value.status) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isOrderItem(value: unknown): value is OrderItem {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.productId === "string" &&
    typeof value.name === "string" &&
    isNonNegativeInteger(value.unitPriceInCents) &&
    isPositiveInteger(value.quantity) &&
    isNonNegativeInteger(value.subtotalInCents)
  );
}

function isOrderResponse(value: unknown): value is OrderResponse {
  return isRecord(value) && isOrder(value.order);
}

function isOrderAcceptedResponse(
  value: unknown
): value is OrderAcceptedResponse {
  return (
    isRecord(value) &&
    typeof value.orderId === "string" &&
    value.status === "PROCESSING" &&
    typeof value.statusUrl === "string"
  );
}

function isOrderStatusResponse(
  value: unknown
): value is OrderStatusResponse {
  return (
    isRecord(value) &&
    typeof value.orderId === "string" &&
    isOrderStatus(value.status) &&
    isNonNegativeInteger(value.totalPriceInCents) &&
    Array.isArray(value.items) &&
    value.items.every(isOrderItem) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isApiError(value: unknown): value is ApiError {
  if (!isRecord(value) || !isRecord(value.error)) {
    return false;
  }

  const error = value.error;

  return (
    typeof error.code === "string" &&
    typeof error.message === "string" &&
    typeof error.retryable === "boolean" &&
    typeof error.requestId === "string" &&
    (error.details === undefined || isRecord(error.details))
  );
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function invalidResponseError(response: Response): ApiClientError {
  return new ApiClientError({
    code: "INVALID_API_RESPONSE",
    message: "A API retornou uma resposta inesperada.",
    requestId: response.headers.get("X-Request-Id") ?? "unknown",
    retryable: true,
    status: response.status
  });
}

function networkError(cause: unknown): ApiClientError {
  const message =
    cause instanceof Error && cause.message.length > 0
      ? cause.message
      : "Não foi possível conectar à API.";

  return new ApiClientError({
    code: "NETWORK_ERROR",
    message,
    requestId: "unavailable",
    retryable: true,
    status: 0
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function getOrderReference(
  error: ApiClientError
): { orderId: string; statusUrl: string } | null {
  const { orderId, statusUrl } = error.details;

  if (typeof orderId !== "string" || typeof statusUrl !== "string") {
    return null;
  }

  return { orderId, statusUrl };
}

export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = normalizeBaseUrl(
    options.baseUrl ??
      process.env.NEXT_PUBLIC_API_BASE_URL ??
      DEFAULT_API_BASE_URL
  );
  const fetchImplementation: FetchImplementation =
    options.fetchImplementation ??
    ((input, init) => globalThis.fetch(input, init));

  async function request(
    path: string,
    requestOptions: RequestOptions = {}
  ): Promise<{ body: unknown; response: Response }> {
    let response: Response;

    try {
      response = await fetchImplementation(`${baseUrl}${path}`, {
        ...requestOptions,
        headers: {
          Accept: "application/json",
          ...requestOptions.headers
        }
      });
    } catch (error: unknown) {
      if (isAbortError(error)) {
        throw error;
      }

      throw networkError(error);
    }

    const body = await readJson(response);

    if (!response.ok) {
      if (isApiError(body)) {
        throw new ApiClientError({
          code: body.error.code,
          details: body.error.details,
          message: body.error.message,
          requestId: body.error.requestId,
          retryable: body.error.retryable,
          status: response.status
        });
      }

      throw invalidResponseError(response);
    }

    return { body, response };
  }

  return {
    async createOrder(
      orderRequest: CreateOrderRequest,
      idempotencyKey: string,
      signal?: AbortSignal
    ): Promise<CreateOrderApiResult> {
      const { body, response } = await request("/api/orders", {
        body: JSON.stringify(orderRequest),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey
        },
        method: "POST",
        ...(signal === undefined ? {} : { signal })
      });

      if (response.status === 202 && isOrderAcceptedResponse(body)) {
        return {
          kind: "PROCESSING",
          orderId: body.orderId,
          replayed: false,
          statusUrl: body.statusUrl
        };
      }

      if ((response.status === 200 || response.status === 201) && isOrderResponse(body)) {
        return {
          kind: "ORDER",
          order: body.order,
          replayed:
            response.headers.get("Idempotency-Replayed")?.toLowerCase() ===
            "true"
        };
      }

      throw invalidResponseError(response);
    },

    async getOrderStatus(
      orderId: string,
      signal?: AbortSignal
    ): Promise<OrderStatusResponse> {
      const { body, response } = await request(
        `/api/orders/${encodeURIComponent(orderId)}`,
        signal === undefined ? {} : { signal }
      );

      if (!isOrderStatusResponse(body)) {
        throw invalidResponseError(response);
      }

      return body;
    },

    async getProducts(signal?: AbortSignal): Promise<ProductListResponse> {
      const { body, response } = await request(
        "/api/products",
        signal === undefined ? {} : { signal }
      );

      if (!isProductListResponse(body)) {
        throw invalidResponseError(response);
      }

      return body;
    }
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

export const apiClient = createApiClient();
