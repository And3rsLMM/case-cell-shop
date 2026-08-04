import type {
  ApiError,
  CreateOrderItemRequest,
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

const PRODUCT_A = "cart-product-a";
const PRODUCT_B = "cart-product-b";

describe("checkout HTTP de carrinho", () => {
  let database: TestDatabase;
  let prisma: PrismaClient;
  let server: HttpTestServer;
  let processOrder: jest.MockedFunction<ErpGateway["processOrder"]>;

  beforeAll(async () => {
    database = await createTestDatabase("case-cell-shop-cart-");
    prisma = database.prisma;
    processOrder = jest.fn().mockResolvedValue({
      outcome: "SUCCESS",
      durationMs: 0,
      simulatedDelayMs: 0
    });
    const logger: jest.Mocked<Logger> = {
      error: jest.fn(),
      info: jest.fn()
    };
    const app = createApp({
      erpGateway: { processOrder },
      erpProcessingLeaseMs: 5_000,
      erpSyncTimeoutMs: 250,
      logger,
      orderRepository: createPrismaOrderRepository(prisma),
      productRepository: createPrismaProductRepository(prisma),
      requestIdFactory: () => "cart-request-id"
    });

    server = await startHttpTestServer(app);
  });

  afterAll(async () => {
    await server.close();
    await database.close();
  });

  beforeEach(async () => {
    await database.reset();
    await prisma.product.createMany({
      data: [
        {
          active: true,
          description: "Primeiro produto do carrinho.",
          id: PRODUCT_A,
          name: "Capinha A",
          priceInCents: 1_000,
          stock: 5
        },
        {
          active: true,
          description: "Segundo produto do carrinho.",
          id: PRODUCT_B,
          name: "Capinha B",
          priceInCents: 2_500,
          stock: 2
        }
      ]
    });
    processOrder.mockClear();
  });

  function checkout(
    idempotencyKey: string,
    items: CreateOrderItemRequest[]
  ): Promise<Response> {
    return fetch(`${server.baseUrl}/api/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify({ items })
    });
  }

  async function getStocks(): Promise<Record<string, number>> {
    const products = await prisma.product.findMany({
      orderBy: { id: "asc" }
    });

    return Object.fromEntries(
      products.map((product) => [product.id, product.stock])
    );
  }

  it("cria pedido multi-item, envia o carrinho completo ao ERP e permite polling", async () => {
    const response = await checkout("multi-cart-key", [
      { productId: PRODUCT_B, quantity: 2 },
      { productId: PRODUCT_A, quantity: 3 }
    ]);
    const body = (await response.json()) as OrderResponse;

    expect(response.status).toBe(201);
    expect(body.order.totalPriceInCents).toBe(8_000);
    expect(body.order.items.map((item) => item.productId)).toEqual([
      PRODUCT_A,
      PRODUCT_B
    ]);
    expect(processOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: body.order.id,
        totalPriceInCents: 8_000,
        items: [
          expect.objectContaining({ productId: PRODUCT_A, quantity: 3 }),
          expect.objectContaining({ productId: PRODUCT_B, quantity: 2 })
        ]
      }),
      expect.objectContaining({ attempt: 1 })
    );

    const statusResponse = await fetch(
      `${server.baseUrl}/api/orders/${body.order.id}`
    );
    const status = (await statusResponse.json()) as OrderStatusResponse;
    expect(statusResponse.status).toBe(200);
    expect(status).toMatchObject({
      orderId: body.order.id,
      status: "CONFIRMED",
      totalPriceInCents: 8_000,
      items: body.order.items
    });
  });

  it("faz rollback total quando um item não possui estoque", async () => {
    const response = await checkout("rollback-stock-key", [
      { productId: PRODUCT_A, quantity: 2 },
      { productId: PRODUCT_B, quantity: 3 }
    ]);
    const body = (await response.json()) as ApiError;

    expect(response.status).toBe(409);
    expect(body.error).toMatchObject({
      code: "INSUFFICIENT_STOCK",
      details: {
        items: [
          {
            availableQuantity: 2,
            productId: PRODUCT_B,
            requestedQuantity: 3
          }
        ]
      },
      retryable: false
    });
    expect(await getStocks()).toMatchObject({
      [PRODUCT_A]: 5,
      [PRODUCT_B]: 2
    });
    await expect(prisma.order.count()).resolves.toBe(0);
    await expect(prisma.orderItem.count()).resolves.toBe(0);
    expect(processOrder).not.toHaveBeenCalled();
  });

  it("reproduz a mesma chave com itens em outra ordem sem nova reserva", async () => {
    const first = await checkout("order-independent-key", [
      { productId: PRODUCT_B, quantity: 1 },
      { productId: PRODUCT_A, quantity: 2 }
    ]);
    const firstBody = (await first.json()) as OrderResponse;
    const replay = await checkout("order-independent-key", [
      { productId: PRODUCT_A, quantity: 2 },
      { productId: PRODUCT_B, quantity: 1 }
    ]);
    const replayBody = (await replay.json()) as OrderResponse;

    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(replayBody.order.id).toBe(firstBody.order.id);
    expect(await getStocks()).toMatchObject({
      [PRODUCT_A]: 3,
      [PRODUCT_B]: 1
    });
    await expect(prisma.order.count()).resolves.toBe(1);
    await expect(prisma.orderItem.count()).resolves.toBe(2);
    expect(processOrder).toHaveBeenCalledTimes(1);
  });

});
