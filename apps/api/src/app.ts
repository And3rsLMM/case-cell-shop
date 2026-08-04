import cors from "cors";
import express, { type Express } from "express";

import { environment } from "./config/environment";
import type { ReadinessCheck } from "./gateways/readiness.gateway";
import {
  createSimulatedErpGateway,
  type ErpGateway
} from "./gateways/erp.gateway";
import { prisma } from "./infrastructure/database/prisma";
import { createErrorHandler } from "./middlewares/error-handler.middleware";
import { createNotFoundHandler } from "./middlewares/not-found.middleware";
import { createRequestIdMiddleware } from "./middlewares/request-id.middleware";
import { createRequestLoggerMiddleware } from "./middlewares/request-logger.middleware";
import {
  createPrismaOrderRepository,
  type OrderRepository
} from "./repositories/order.repository";
import {
  createPrismaProductRepository,
  type ProductRepository
} from "./repositories/product.repository";
import { createProductRouter } from "./routes/product.routes";
import { createOrderRouter } from "./routes/order.routes";
import { createSystemRouter } from "./routes/system.routes";
import { createDocumentationRouter } from "./routes/documentation.routes";
import {
  createOrderProcessor,
  type OrderProcessor
} from "./services/order-processor.service";
import { createProductService } from "./services/product.service";
import { createOrderService } from "./services/order.service";
import { createReadinessService } from "./services/readiness.service";
import {
  createConsoleLogger,
  type Logger
} from "./utils/logger";

export interface AppDependencies {
  corsOrigin?: string;
  erpGateway?: ErpGateway;
  erpProcessingLeaseMs?: number;
  erpSyncTimeoutMs?: number;
  jsonBodyLimit?: string;
  logger?: Logger;
  now?: () => Date;
  orderProcessor?: OrderProcessor;
  orderRepository?: OrderRepository;
  productRepository?: ProductRepository;
  readinessCheck?: ReadinessCheck;
  requestIdFactory?: () => string;
  timeoutWait?: (delayMs: number) => Promise<void>;
}

export function createApp(dependencies: AppDependencies = {}): Express {
  const app = express();
  const logger = dependencies.logger ?? createConsoleLogger("case-cell-shop-api");
  const now = dependencies.now ?? (() => new Date());
  const readinessCheck =
    dependencies.readinessCheck ?? (() => Promise.resolve());
  const readinessService = createReadinessService({
    readinessCheck,
    now
  });
  const productRepository =
    dependencies.productRepository ?? createPrismaProductRepository(prisma);
  const productService = createProductService({ productRepository });
  const orderRepository =
    dependencies.orderRepository ?? createPrismaOrderRepository(prisma, now);
  const erpGateway =
    dependencies.erpGateway ??
    createSimulatedErpGateway({
      failureRate: environment.erp.failureRate,
      logger,
      maxDelayMs: environment.erp.maxDelayMs,
      minDelayMs: environment.erp.minDelayMs,
      syncTimeoutMs: environment.erp.syncTimeoutMs
    });
  const orderProcessor =
    dependencies.orderProcessor ??
    createOrderProcessor({
      erpGateway,
      logger,
      maxAttempts: environment.erp.maxAttempts,
      now,
      orderRepository,
      processingLeaseMs:
        dependencies.erpProcessingLeaseMs ??
        environment.erp.processingLeaseMs,
      ...(environment.erp.simulationMode === undefined
        ? {}
        : { simulationMode: environment.erp.simulationMode })
    });
  const orderService = createOrderService({
    orderProcessor,
    orderRepository,
    syncTimeoutMs:
      dependencies.erpSyncTimeoutMs ?? environment.erp.syncTimeoutMs,
    ...(dependencies.timeoutWait === undefined
      ? {}
      : { timeoutWait: dependencies.timeoutWait })
  });

  app.disable("x-powered-by");
  app.use(createRequestIdMiddleware(dependencies.requestIdFactory));
  app.use(createRequestLoggerMiddleware(logger));
  app.use(
    cors({
      origin: dependencies.corsOrigin ?? environment.webOrigin,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Idempotency-Key", "X-Request-Id"],
      exposedHeaders: ["Idempotency-Replayed", "X-Request-Id"]
    })
  );
  app.use(
    express.json({
      limit: dependencies.jsonBodyLimit ?? environment.jsonBodyLimit
    })
  );

  app.use(createSystemRouter({ readinessService, now }));
  app.use(createDocumentationRouter());
  app.use("/api/products", createProductRouter({ productService }));
  app.use("/api/orders", createOrderRouter({ orderService }));
  app.use(createNotFoundHandler());
  app.use(createErrorHandler(logger));

  return app;
}
