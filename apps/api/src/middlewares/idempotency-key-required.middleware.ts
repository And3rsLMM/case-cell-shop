import type { RequestHandler } from "express";

import { createIdempotencyKeyRequiredError } from "../domain/errors/commerce.errors";

export const handleRequiredIdempotencyKey: RequestHandler = (
  request,
  _response,
  next
) => {
  if (request.get("Idempotency-Key") === undefined) {
    next(createIdempotencyKeyRequiredError());
    return;
  }

  next();
};
