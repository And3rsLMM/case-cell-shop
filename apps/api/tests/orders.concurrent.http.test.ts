import type {
  ApiError,
  OrderAcceptedResponse,
  OrderResponse,
  OrderStatusResponse
} from "@case-cell-shop/contracts";
import type { PrismaClient } from "@prisma/client";

import { createApp } from "../src/app";
import type { ErpGateway } from "../src/gateways/erp.gateway";
import { createPrismaOrderRepository } from "../src/repositories/order.repository";
import { createPrismaProductRepository } from "../src/repositories/product.repository";
import type { Logger } from "../src/utils/logger";
import {
  startHttpTestServer,
  type HttpTestServer
} from "./helpers/http-test-server";
import {
  createTestDatabase,
  type TestDatabase
} from "./helpers/test-database";

const PRODUCT_ID = "last-unit-product";


describe("concorrência HTTP na última unidade", () => {
  let database: TestDatabase;
  let prismaClient: PrismaClient;
  let server: HttpTestServer;
  let baseUrl: string;
  let processOrder: jest.MockedFunction<
    ErpGateway["processOrder"]
  >;

  beforeAll(async () => {
    database = await createTestDatabase("case-cell-shop-concurrency-");
    prismaClient = database.prisma;

    processOrder = jest.fn();
    processOrder.mockResolvedValue({ outcome: "SUCCESS", durationMs: 0, simulatedDelayMs: 0 });
    const logger: jest.Mocked<Logger> = {
      error: jest.fn(),
      info: jest.fn()
    };
    const app = createApp({
      erpProcessingLeaseMs: 5_000,
      erpSyncTimeoutMs: 250,
      logger,
      erpGateway: { processOrder },
      orderRepository: createPrismaOrderRepository(prismaClient),
      productRepository: createPrismaProductRepository(prismaClient),
      requestIdFactory: () => "concurrent-request-id"
    });

    server = await startHttpTestServer(app);
    baseUrl = server.baseUrl;
  });

  beforeEach(async () => {
    await database.reset();
    await prismaClient.product.create({
      data: {
        id: PRODUCT_ID,
        name: "Capinha com última unidade",
        description: "Produto usado pelo teste concorrente.",
        priceInCents: 4_990,
        stock: 1,
        active: true
      }
    });
    processOrder.mockReset();
    processOrder.mockResolvedValue({
      outcome: "SUCCESS",
      durationMs: 0,
      simulatedDelayMs: 0
    });
  });

  afterAll(async () => {
    await server.close();
    await database.close();
  });

  function buyLastUnit(
    idempotencyKey: string,
    quantity = 1
  ): Promise<Response> {
    return fetch(`${baseUrl}/api/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify({
        items: [{ productId: PRODUCT_ID, quantity }]
      })
    });
  }

  async function waitForOrderStatus(
    orderId: string,
    expectedStatus: OrderStatusResponse["status"]
  ): Promise<OrderStatusResponse> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/orders/${orderId}`);
      const body = (await response.json()) as OrderStatusResponse;

      if (body.status === expectedStatus) {
        return body;
      }

      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    throw new Error(
      `O pedido ${orderId} não atingiu o status ${expectedStatus}.`
    );
  }

  it("rejeita a mesma chave quando o payload é diferente", async () => {
    const first = await buyLastUnit("same-key-different-payload");
    const conflict = await buyLastUnit("same-key-different-payload", 2);
    const body = (await conflict.json()) as ApiError;

    expect(first.status).toBe(201);
    expect(conflict.status).toBe(409);
    expect(body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    await expect(prismaClient.order.count()).resolves.toBe(1);
  });

  it("cria um único pedido para requisições simultâneas com a mesma chave", async () => {
    processOrder.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ outcome: "SUCCESS", durationMs: 0, simulatedDelayMs: 0 }), 25);
        })
    );
    const responses = await Promise.all([
      buyLastUnit("simultaneous-same-key"),
      buyLastUnit("simultaneous-same-key")
    ]);
    const bodies = (await Promise.all(
      responses.map((response) => response.json())
    )) as OrderResponse[];
    const product = await prismaClient.product.findUniqueOrThrow({
      where: { id: PRODUCT_ID }
    });

    expect(responses.map(({ status }) => status).sort()).toEqual([200, 201]);
    expect(new Set(bodies.map(({ order }) => order.id)).size).toBe(1);
    await expect(prismaClient.order.count()).resolves.toBe(1);
    expect(product.stock).toBe(0);
    expect(processOrder).toHaveBeenCalledTimes(1);
  });

  it("reproduz o pedido em processamento após falha temporária", async () => {
    processOrder.mockResolvedValueOnce({
      outcome: "TEMPORARY_FAILURE",
      durationMs: 0,
      simulatedDelayMs: 0,
      errorCode: "ERP_TEMPORARY_FAILURE",
      errorMessage: "Falha temporária."
    });
    const first = await buyLastUnit("retry-after-timeout");
    const firstBody = (await first.json()) as ApiError;
    const retry = await buyLastUnit("retry-after-timeout");
    const retryBody = (await retry.json()) as OrderResponse;
    const product = await prismaClient.product.findUniqueOrThrow({
      where: { id: PRODUCT_ID }
    });

    expect(first.status).toBe(503);
    expect(firstBody.error.code).toBe("ERP_TEMPORARILY_UNAVAILABLE");
    expect(retry.status).toBe(200);
    expect(retry.headers.get("Idempotency-Replayed")).toBe("true");
    expect(retryBody.order.status).toBe("PROCESSING");
    expect(product.stock).toBe(0);
    expect(processOrder).toHaveBeenCalledTimes(1);
  });

  it("reproduz a mesma intenção após 202 sem reservar nem chamar o ERP novamente", async () => {
    let resolveErp: (
      result: Awaited<ReturnType<ErpGateway["processOrder"]>>
    ) => void = () => undefined;
    const pendingErp = new Promise<
      Awaited<ReturnType<ErpGateway["processOrder"]>>
    >((resolve) => {
      resolveErp = resolve;
    });
    processOrder.mockReturnValueOnce(pendingErp);

    const first = await buyLastUnit("real-timeout-retry-key");
    const firstBody = (await first.json()) as OrderAcceptedResponse;
    const retry = await buyLastUnit("real-timeout-retry-key");
    const retryBody = (await retry.json()) as OrderResponse;

    expect(first.status).toBe(202);
    expect(typeof firstBody.orderId).toBe("string");
    expect(firstBody.status).toBe("PROCESSING");
    expect(firstBody.statusUrl).toMatch(/^\/api\/orders\//);
    expect(retry.status).toBe(200);
    expect(retry.headers.get("Idempotency-Replayed")).toBe("true");
    expect(retryBody.order.id).toBe(firstBody.orderId);
    expect(retryBody.order.status).toBe("PROCESSING");
    expect(processOrder).toHaveBeenCalledTimes(1);
    await expect(prismaClient.order.count()).resolves.toBe(1);

    resolveErp({
      outcome: "SUCCESS",
      durationMs: 75,
      simulatedDelayMs: 75
    });
    const finalStatus = await waitForOrderStatus(
      firstBody.orderId,
      "CONFIRMED"
    );
    const product = await prismaClient.product.findUniqueOrThrow({
      where: { id: PRODUCT_ID }
    });

    expect(finalStatus.status).toBe("CONFIRMED");
    expect(product.stock).toBe(0);
    expect(processOrder).toHaveBeenCalledTimes(1);
  });

  it("aceita uma compra, rejeita a outra e mantém estoque zero", async () => {
    const responses = await Promise.all([
      buyLastUnit("concurrent-order-key-a"),
      buyLastUnit("concurrent-order-key-b")
    ]);
    const acceptedResponse = responses.find(({ status }) => status === 201);
    const rejectedResponse = responses.find(({ status }) => status === 409);

    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(acceptedResponse).toBeDefined();
    expect(rejectedResponse).toBeDefined();

    const acceptedBody =
      (await acceptedResponse?.json()) as OrderResponse | undefined;
    const rejectedBody =
      (await rejectedResponse?.json()) as ApiError | undefined;
    const product = await prismaClient.product.findUniqueOrThrow({
      where: { id: PRODUCT_ID }
    });
    const orders = await prismaClient.order.findMany({
      where: { items: { some: { productId: PRODUCT_ID } } },
      orderBy: { status: "asc" }
    });

    expect(acceptedBody?.order.status).toBe("CONFIRMED");
    expect(rejectedBody?.error.code).toBe("INSUFFICIENT_STOCK");
    expect(product.stock).toBe(0);
    expect(orders.map(({ status }) => status)).toEqual(["CONFIRMED"]);
  });
});
