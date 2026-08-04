import type { HealthResponse } from "@case-cell-shop/contracts";
import type { RequestHandler } from "express";

import type { ReadinessService } from "../services/readiness.service";

export function createHealthController(now: () => Date): RequestHandler {
  return (_request, response) => {
    const body = {
      status: "ok",
      service: "api",
      timestamp: now().toISOString()
    } satisfies HealthResponse;

    response.status(200).json(body);
  };
}

export function createReadyController(
  readinessService: ReadinessService
): RequestHandler {
  return async (_request, response) => {
    const body = await readinessService.check();

    response.status(200).json(body);
  };
}
