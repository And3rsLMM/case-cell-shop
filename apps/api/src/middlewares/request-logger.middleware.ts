import type { RequestHandler } from "express";

import { getHttpLogContext } from "../utils/http-log-context";
import type { Logger } from "../utils/logger";

export function createRequestLoggerMiddleware(logger: Logger): RequestHandler {
  return (request, response, next) => {
    const startedAt = process.hrtime.bigint();

    response.once("finish", () => {
      const elapsedNanoseconds = process.hrtime.bigint() - startedAt;
      const durationMs = Number(elapsedNanoseconds) / 1_000_000;

      logger.info("http.request.completed", {
        requestId: request.requestId,
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        ...getHttpLogContext(response)
      });
    });

    next();
  };
}
