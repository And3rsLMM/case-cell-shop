import type { ApiError } from "@case-cell-shop/contracts";
import type { PrismaClient } from "@prisma/client";

import { createApp } from "../src/app";
import type {
  ErpGateway,
  ErpProcessingResult
} from "../src/gateways/erp.gateway";
import { createPrismaOrderRepository } from "../src/repositories/order.repository";
import { createPrismaProductRepository } from "../src/repositories/product.repository";
import { createOrderProcessor } from "../src/services/order-processor.service";
import type { Logger } from "../src/utils/logger";
import { createOrderWorker } from "../src/workers/order.worker";
import {
  startHttpTestServer,
  type HttpTestServer
} from "./helpers/http-test-server";
import {
  createTestDatabase,
  type TestDatabase
} from "./helpers/test-database";

const PRODUCT_ID = "processing-product";

describe("processamento persistente de pedidos", () => {
  let database: TestDatabase;
  let prisma: PrismaClient;
  let server: HttpTestServer;
  let processOrder: jest.MockedFunction<ErpGateway["processOrder"]>;
  const logger: jest.Mocked<Logger> = {
    error: jest.fn(),
    info: jest.fn()
  };

  beforeAll(async () => {
    database = await createTestDatabase("case-cell-shop-processing-");
    prisma = database.prisma;
    processOrder = jest.fn();
    const orderRepository = createPrismaOrderRepository(prisma);
    const orderProcessor = createOrderProcessor({
      erpGateway: { processOrder },
      logger,
      maxAttempts: 2,
      orderRepository,
      processingLeaseMs: 5_000
    });
    const app = createApp({
      erpSyncTimeoutMs: 100,
      logger,
      orderProcessor,
      orderRepository,
      productRepository: createPrismaProductRepository(prisma),
      requestIdFactory: () => "processing-request-id"
    });

    server = await startHttpTestServer(app);
  });

  beforeEach(async () => {
    await database.reset();
    await prisma.product.create({
      data: {
        active: true,
        description: "Produto para testar processamento persistente.",
        id: PRODUCT_ID,
        name: "Capinha Processamento",
        priceInCents: 4_990,
        stock: 1
      }
    });
    processOrder.mockReset();
    logger.error.mockClear();
    logger.info.mockClear();
  });

  afterAll(async () => {
    await server.close();
    await database.close();
  });

  function buy(idempotencyKey: string): Promise<Response> {
    return fetch(`${server.baseUrl}/api/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify({
        items: [{ productId: PRODUCT_ID, quantity: 1 }]
      })
    });
  }

  it("devolve o estoque uma única vez após o limite real de tentativas", async () => {
    processOrder.mockResolvedValue({
      outcome: "TEMPORARY_FAILURE",
      durationMs: 0,
      simulatedDelayMs: 0,
      errorCode: "ERP_TEMPORARY_FAILURE",
      errorMessage: "Falha temporária."
    });

    const firstResponse = await buy("release-once-key");
    const firstBody = (await firstResponse.json()) as ApiError;
    const repository = createPrismaOrderRepository(prisma);
    const processor = createOrderProcessor({
      erpGateway: { processOrder },
      logger,
      maxAttempts: 2,
      orderRepository: repository,
      processingLeaseMs: 5_000
    });
    const worker = createOrderWorker({
      logger,
      orderProcessor: processor,
      orderRepository: repository
    });

    expect(firstResponse.status).toBe(503);
    expect(firstBody.error.code).toBe("ERP_TEMPORARILY_UNAVAILABLE");
    await expect(
      prisma.product.findUniqueOrThrow({ where: { id: PRODUCT_ID } })
    ).resolves.toMatchObject({ stock: 0 });

    await worker.runOnce();

    const failedOrder = await prisma.order.findFirstOrThrow({
      where: { idempotencyKey: "release-once-key" }
    });
    expect(failedOrder).toMatchObject({
      processingAttempts: 2,
      status: "FAILED"
    });
    expect(failedOrder.stockReleasedAt).not.toBeNull();
    await expect(
      prisma.product.findUniqueOrThrow({ where: { id: PRODUCT_ID } })
    ).resolves.toMatchObject({ stock: 1 });

    await worker.runOnce();
    const repeatedOutcome = await processor.processOrder(failedOrder.id);
    expect(repeatedOutcome.kind).toBe("FAILED");
    expect(repeatedOutcome.order?.id).toBe(failedOrder.id);

    await expect(
      prisma.product.findUniqueOrThrow({ where: { id: PRODUCT_ID } })
    ).resolves.toMatchObject({ stock: 1 });
    expect(processOrder).toHaveBeenCalledTimes(2);
    await expect(prisma.orderProcessingClaim.count()).resolves.toBe(0);
  });

  it("permite somente um processador com claim vigente no banco", async () => {
    const repository = createPrismaOrderRepository(prisma);
    const attempt = await repository.createAttempt({
      idempotencyKey: "distributed-claim-key",
      items: [{ productId: PRODUCT_ID, quantity: 1 }],
      requestHash: "canonical-request-hash"
    });

    if (attempt.kind !== "CREATED") {
      throw new Error("O pedido de preparação deveria ter sido criado.");
    }

    let resolveFirstErp: (result: ErpProcessingResult) => void =
      () => undefined;
    const firstErpResult = new Promise<ErpProcessingResult>((resolve) => {
      resolveFirstErp = resolve;
    });
    const firstProcessOrder = jest.fn(() => firstErpResult);
    const secondProcessOrder = jest.fn().mockResolvedValue({
        outcome: "SUCCESS",
        durationMs: 0,
        simulatedDelayMs: 0
      });
    const firstGateway: ErpGateway = {
      processOrder: firstProcessOrder
    };
    const secondGateway: ErpGateway = {
      processOrder: secondProcessOrder
    };
    const firstProcessor = createOrderProcessor({
      erpGateway: firstGateway,
      logger,
      maxAttempts: 3,
      orderRepository: repository,
      processingLeaseMs: 5_000,
      processingTokenFactory: () => "processor-a"
    });
    const secondProcessor = createOrderProcessor({
      erpGateway: secondGateway,
      logger,
      maxAttempts: 3,
      orderRepository: repository,
      processingLeaseMs: 5_000,
      processingTokenFactory: () => "processor-b"
    });

    const firstProcessing = firstProcessor.processOrder(attempt.order.id);

    for (let attemptNumber = 0; attemptNumber < 20; attemptNumber += 1) {
      if (firstProcessOrder.mock.calls.length > 0) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    const secondOutcome = await secondProcessor.processOrder(
      attempt.order.id
    );

    expect(secondOutcome.kind).toBe("NOT_PROCESSABLE");
    expect(secondProcessOrder).not.toHaveBeenCalled();
    await expect(prisma.orderProcessingClaim.count()).resolves.toBe(1);

    resolveFirstErp({
      outcome: "SUCCESS",
      durationMs: 0,
      simulatedDelayMs: 0
    });
    const firstOutcome = await firstProcessing;
    expect(firstOutcome.kind).toBe("CONFIRMED");
    expect(firstOutcome.order?.status).toBe("CONFIRMED");
    await expect(prisma.orderProcessingClaim.count()).resolves.toBe(0);
    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: attempt.order.id } })
    ).resolves.toMatchObject({
      processingAttempts: 1,
      status: "CONFIRMED"
    });
  });

  it("impede um processador atrasado de sobrescrever o estado após perder o lease", async () => {
    const repository = createPrismaOrderRepository(prisma);
    const attempt = await repository.createAttempt({
      idempotencyKey: "expired-claim-key",
      items: [{ productId: PRODUCT_ID, quantity: 1 }],
      requestHash: "canonical-request-hash"
    });

    if (attempt.kind !== "CREATED") {
      throw new Error("O pedido de preparação deveria ter sido criado.");
    }

    const firstTime = new Date("2026-08-03T12:00:00.000Z");
    const secondTime = new Date("2026-08-03T12:00:00.020Z");
    let resolveDelayedErp: (result: ErpProcessingResult) => void =
      () => undefined;
    const delayedErpResult = new Promise<ErpProcessingResult>((resolve) => {
      resolveDelayedErp = resolve;
    });
    const firstProcessor = createOrderProcessor({
      erpGateway: { processOrder: jest.fn(() => delayedErpResult) },
      logger,
      maxAttempts: 3,
      now: () => firstTime,
      orderRepository: repository,
      processingLeaseMs: 10,
      processingTokenFactory: () => "expired-token"
    });
    const secondProcessor = createOrderProcessor({
      erpGateway: {
        processOrder: jest.fn().mockResolvedValue({
          outcome: "SUCCESS",
          durationMs: 0,
          simulatedDelayMs: 0
        })
      },
      logger,
      maxAttempts: 3,
      now: () => secondTime,
      orderRepository: repository,
      processingLeaseMs: 10,
      processingTokenFactory: () => "current-token"
    });

    const delayedProcessing = firstProcessor.processOrder(attempt.order.id);

    for (let attemptNumber = 0; attemptNumber < 20; attemptNumber += 1) {
      if (await prisma.orderProcessingClaim.findUnique({
        where: { orderId: attempt.order.id }
      })) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    const secondOutcome = await secondProcessor.processOrder(
      attempt.order.id
    );
    expect(secondOutcome.kind).toBe("CONFIRMED");
    expect(secondOutcome.order?.status).toBe("CONFIRMED");

    resolveDelayedErp({
      outcome: "TEMPORARY_FAILURE",
      durationMs: 30,
      simulatedDelayMs: 30,
      errorCode: "ERP_TEMPORARY_FAILURE",
      errorMessage: "Resposta atrasada."
    });
    const delayedOutcome = await delayedProcessing;
    expect(delayedOutcome.kind).toBe("CONFIRMED");
    expect(delayedOutcome.order?.status).toBe("CONFIRMED");

    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: attempt.order.id } })
    ).resolves.toMatchObject({
      errorCode: null,
      processingAttempts: 2,
      status: "CONFIRMED",
      stockReleasedAt: null
    });
    await expect(
      prisma.product.findUniqueOrThrow({ where: { id: PRODUCT_ID } })
    ).resolves.toMatchObject({ stock: 0 });
    await expect(prisma.orderProcessingClaim.count()).resolves.toBe(0);
  });
});
