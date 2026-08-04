import type { RequestHandler } from "express";

import { createAppError } from "../domain/errors/app-error";

export function createNotFoundHandler(): RequestHandler {
  return (_request, _response, next) => {
    next(
      createAppError({
        code: "ROUTE_NOT_FOUND",
        message: "Rota não encontrada.",
        statusCode: 404
      })
    );
  };
}
