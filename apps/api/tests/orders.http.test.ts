/* eslint-disable @typescript-eslint/unbound-method */
import type {
  ApiError,
  OrderAcceptedResponse,
  OrderResponse,
  OrderStatusResponse
} from "@case-cell-shop/contracts";

import { createApp } from "../src/app";
import type {
  CreateOrderAttemptResult,
  OrderRepository
} from "../src/repositories/order.repository";
import type { OrderProcessor } from "../src/services/order-processor.service";
import type { Logger } from "../src/utils/logger";
import {
  startHttpTestServer,
  type HttpTestServer
} from "./helpers/http-test-server";
import {
  createOrderRecord,
  defaultOrderRequest
} from "./helpers/order-fixture";

const updatedAt = new Date("2026-08-02T12:01:00.000Z");

describe("endpoints HTTP de pedidos", () => {
  let server: HttpTestServer;
  let baseUrl: string;
  let orderRepository: jest.Mocked<OrderRepository>;
  let orderProcessor: jest.Mocked<OrderProcessor>;
  let timeoutWait: jest.MockedFunction<
    (delayMs: number) => Promise<void>
  >;
  let logger: jest.Mocked<Logger>;

  beforeAll(async () => {
    orderRepository = {
      createAttempt: jest.fn(),
      failAndReleaseStock: jest.fn(),
      findById: jest.fn(),
      findByIdempotencyKey: jest.fn(),
      findProcessable: jest.fn(),
      markConfirmed: jest.fn(),
      markTemporaryFailure: jest.fn(),
      startProcessingAttempt: jest.fn()
    };
    orderProcessor = {
      processOrder: jest.fn(),
      waitForIdle: jest.fn()
    };
    timeoutWait = jest.fn();
    logger = { error: jest.fn(), info: jest.fn() };

    const app = createApp({
      erpSyncTimeoutMs: 100,
      logger,
      orderProcessor,
      orderRepository,
      requestIdFactory: () => "orders-request-id",
      timeoutWait
    });

    server = await startHttpTestServer(app);
    baseUrl = server.baseUrl;
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    const pendingOrder = createOrderRecord();
    const confirmedOrder = createOrderRecord({
      status: "CONFIRMED",
      processingAttempts: 1
    });
    orderRepository.findByIdempotencyKey.mockResolvedValue(null);
    orderRepository.createAttempt.mockResolvedValue({
      kind: "CREATED",
      order: pendingOrder
    });
    orderRepository.findById.mockResolvedValue(
      createOrderRecord({ status: "PROCESSING" })
    );
    orderProcessor.processOrder.mockResolvedValue({
      kind: "CONFIRMED",
      order: confirmedOrder
    });
    timeoutWait.mockReturnValue(new Promise(() => undefined));
  });

  function postOrder(
    idempotencyKey: string | null = "order-key-123",
    body: unknown = defaultOrderRequest
  ): Promise<Response> {
    return fetch(`${baseUrl}/api/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(idempotencyKey === null
          ? {}
          : { "Idempotency-Key": idempotencyKey })
      },
      body: JSON.stringify(body)
    });
  }

  it("retorna 201 para pedido confirmado", async () => {
    const response = await postOrder();
    const body = (await response.json()) as OrderResponse;

    expect(response.status).toBe(201);
    expect(body.order).toMatchObject({
      id: "order-1",
      status: "CONFIRMED"
    });
    expect(body.order).not.toHaveProperty("requestHash");
    expect(orderProcessor.processOrder).toHaveBeenCalledWith("order-1", {
      requestId: "orders-request-id"
    });
    expect(logger.info).toHaveBeenCalledWith(
      "http.request.completed",
      expect.objectContaining({
        requestId: "orders-request-id",
        orderId: "order-1",
        itemCount: 1,
        status: "CONFIRMED"
      })
    );
    const completedLog = logger.info.mock.calls.find(
      ([message]) => message === "http.request.completed"
    );
    expect(typeof completedLog?.[1]?.durationMs).toBe("number");
  });

  it("retorna 202 quando excede a janela síncrona", async () => {
    orderProcessor.processOrder.mockReturnValueOnce(
      new Promise(() => undefined)
    );
    timeoutWait.mockResolvedValueOnce(undefined);

    const response = await postOrder();
    const body = (await response.json()) as OrderAcceptedResponse;

    expect(response.status).toBe(202);
    expect(body).toEqual({
      orderId: "order-1",
      status: "PROCESSING",
      statusUrl: "/api/orders/order-1"
    });
  });

  it("retorna 200 e header no replay", async () => {
    orderRepository.findByIdempotencyKey.mockResolvedValueOnce(
      createOrderRecord({ status: "CONFIRMED" })
    );

    const response = await postOrder();

    expect(response.status).toBe(200);
    expect(response.headers.get("Idempotency-Replayed")).toBe("true");
    expect(orderProcessor.processOrder).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "http.request.completed",
      expect.objectContaining({
        orderId: "order-1",
        status: "CONFIRMED",
        idempotencyReplayed: true
      })
    );
  });

  it.each<[number, string, CreateOrderAttemptResult]>([
    [
      404,
      "PRODUCT_NOT_FOUND",
      { kind: "PRODUCT_NOT_FOUND", productIds: ["product-1"] }
    ],
    [
      409,
      "INSUFFICIENT_STOCK",
      {
        kind: "INSUFFICIENT_STOCK",
        items: [
          {
            availableQuantity: 0,
            productId: "product-1",
            requestedQuantity: 1
          }
        ]
      }
    ]
  ])("retorna %s para %s", async (status, code, attempt) => {
    orderRepository.createAttempt.mockResolvedValueOnce(attempt);

    const response = await postOrder();
    const body = (await response.json()) as ApiError;

    expect(response.status).toBe(status);
    expect(body.error.code).toBe(code);
  });

  it("retorna 503 para falha temporária rápida", async () => {
    orderProcessor.processOrder.mockResolvedValueOnce({
      kind: "RETRY_SCHEDULED",
      order: createOrderRecord({
        status: "PROCESSING",
        processingAttempts: 1
      })
    });

    const response = await postOrder();
    const body = (await response.json()) as ApiError;

    expect(response.status).toBe(503);
    expect(body.error.code).toBe("ERP_TEMPORARILY_UNAVAILABLE");
    expect(body.error.details).toEqual({
      orderId: "order-1",
      statusUrl: "/api/orders/order-1"
    });
  });

  it("retorna 502 para falha definitiva", async () => {
    orderProcessor.processOrder.mockResolvedValueOnce({
      kind: "FAILED",
      order: createOrderRecord({
        status: "FAILED",
        processingAttempts: 3,
        stockReleasedAt: updatedAt
      })
    });

    const response = await postOrder();
    const body = (await response.json()) as ApiError;

    expect(response.status).toBe(502);
    expect(body.error.code).toBe("ERP_PROCESSING_FAILED");
    expect(body.error.retryable).toBe(false);
  });

  it("normaliza erros internos sem expor detalhes", async () => {
    orderRepository.findByIdempotencyKey.mockRejectedValueOnce(
      new Error("Prisma SQLITE_BUSY /internal/dev.db")
    );

    const response = await postOrder();
    const body = (await response.json()) as ApiError;

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("Prisma");
    expect(JSON.stringify(body)).not.toContain("dev.db");
    expect(logger.error).toHaveBeenCalledWith(
      "http.request.failed",
      expect.objectContaining({
        requestId: "orders-request-id",
        itemCount: 1,
        errorCode: "INTERNAL_ERROR",
        error: { name: "Error" }
      })
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("dev.db");
  });

  it("permite polling e retorna ORDER_NOT_FOUND", async () => {
    const processingResponse = await fetch(`${baseUrl}/api/orders/order-1`);
    const processingBody =
      (await processingResponse.json()) as OrderStatusResponse;

    expect(processingResponse.status).toBe(200);
    expect(processingBody).toEqual({
      createdAt: "2026-08-02T12:00:00.000Z",
      items: [
        {
          name: "Capinha de teste",
          productId: "product-1",
          quantity: 1,
          subtotalInCents: 3_990,
          unitPriceInCents: 3_990
        }
      ],
      orderId: "order-1",
      status: "PROCESSING",
      totalPriceInCents: 3_990,
      updatedAt: updatedAt.toISOString()
    });
    expect(logger.info).toHaveBeenCalledWith(
      "http.request.completed",
      expect.objectContaining({
        orderId: "order-1",
        status: "PROCESSING"
      })
    );

    orderRepository.findById.mockResolvedValueOnce(null);
    const missingResponse = await fetch(`${baseUrl}/api/orders/missing`);
    const missingBody = (await missingResponse.json()) as ApiError;

    expect(missingResponse.status).toBe(404);
    expect(missingBody.error.code).toBe("ORDER_NOT_FOUND");
  });
});
