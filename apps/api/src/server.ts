import { createApp } from "./app";
import { environment } from "./config/environment";
import { createSimulatedErpGateway } from "./gateways/erp.gateway";
import { createPrismaReadinessCheck } from "./gateways/readiness.gateway";
import {
  disconnectPrisma,
  prisma
} from "./infrastructure/database/prisma";
import { createPrismaOrderRepository } from "./repositories/order.repository";
import { createOrderProcessor } from "./services/order-processor.service";
import { listenHttpServer } from "./utils/http-server";
import { createConsoleLogger, serializeError } from "./utils/logger";
import { createOrderWorker } from "./workers/order.worker";

const logger = createConsoleLogger("case-cell-shop-api");
const orderRepository = createPrismaOrderRepository(prisma);
const erpGateway = createSimulatedErpGateway({
  failureRate: environment.erp.failureRate,
  logger,
  maxDelayMs: environment.erp.maxDelayMs,
  minDelayMs: environment.erp.minDelayMs,
  syncTimeoutMs: environment.erp.syncTimeoutMs
});
const orderProcessor = createOrderProcessor({
  erpGateway,
  logger,
  maxAttempts: environment.erp.maxAttempts,
  orderRepository,
  processingLeaseMs: environment.erp.processingLeaseMs,
  ...(environment.erp.simulationMode === undefined
    ? {}
    : { simulationMode: environment.erp.simulationMode })
});
const orderWorker = createOrderWorker({
  logger,
  orderProcessor,
  orderRepository
});
const app = createApp({
  logger,
  orderProcessor,
  orderRepository,
  readinessCheck: createPrismaReadinessCheck(prisma)
});

const server = listenHttpServer(app, environment.apiPort, {
  onError: (error) => {
    logger.error("server.start.failed", {
      errorCode: "SERVER_START_FAILED",
      error: serializeError(error)
    });
    process.exitCode = 1;
    void disconnectPrisma().catch((disconnectError: unknown) => {
      logger.error("server.start.database-disconnect-failed", {
        errorCode: "DATABASE_DISCONNECT_FAILED",
        error: serializeError(disconnectError)
      });
    });
  },
  onListening: () => {
    orderWorker.start();
    logger.info("server.started", {
      port: environment.apiPort
    });
  }
});

async function closeHttpServer(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  logger.info("server.shutdown.started", { signal });

  try {
    await closeHttpServer();
  } catch (error: unknown) {
    logger.error("server.shutdown.http-failed", {
      errorCode: "HTTP_SHUTDOWN_FAILED",
      error: serializeError(error),
      signal
    });
    process.exitCode = 1;
  }

  try {
    await orderWorker.stop();
  } catch (error: unknown) {
    logger.error("server.shutdown.worker-failed", {
      errorCode: "WORKER_SHUTDOWN_FAILED",
      error: serializeError(error),
      signal
    });
    process.exitCode = 1;
  }

  try {
    await disconnectPrisma();
  } catch (error: unknown) {
    logger.error("server.shutdown.database-failed", {
      errorCode: "DATABASE_SHUTDOWN_FAILED",
      error: serializeError(error),
      signal
    });
    process.exitCode = 1;
  }

  logger.info("server.shutdown.completed", { signal });
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});
