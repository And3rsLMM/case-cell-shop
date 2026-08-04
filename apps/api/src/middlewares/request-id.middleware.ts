import { randomUUID } from "node:crypto";

import type { RequestHandler } from "express";

import { isValidRequestId } from "../utils/request-id";

export function createRequestIdMiddleware(
  generateRequestId: () => string = randomUUID
): RequestHandler {
  return (request, response, next) => {
    const receivedRequestId = request.get("X-Request-Id");
    const requestId = isValidRequestId(receivedRequestId)
      ? receivedRequestId
      : generateRequestId();

    request.requestId = requestId;
    response.setHeader("X-Request-Id", requestId);
    next();
  };
}
