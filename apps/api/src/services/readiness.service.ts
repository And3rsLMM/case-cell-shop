import { createAppError } from "../domain/errors/app-error";
import type { ReadinessCheck } from "../gateways/readiness.gateway";

export interface ReadinessResult {
  service: "api";
  status: "ready";
  timestamp: string;
}

export interface ReadinessService {
  check(): Promise<ReadinessResult>;
}

interface ReadinessServiceDependencies {
  now: () => Date;
  readinessCheck: ReadinessCheck;
}

export function createReadinessService(
  dependencies: ReadinessServiceDependencies
): ReadinessService {
  return {
    check: async () => {
      try {
        await dependencies.readinessCheck();
      } catch (cause: unknown) {
        throw createAppError({
          cause,
          code: "SERVICE_NOT_READY",
          message: "A API ainda não está pronta para receber tráfego.",
          retryable: true,
          statusCode: 503
        });
      }

      return {
        service: "api",
        status: "ready",
        timestamp: dependencies.now().toISOString()
      };
    }
  };
}
