import type { OrderStatus } from "@case-cell-shop/contracts";
import type { Response } from "express";

export interface HttpLogContext {
  errorCode?: string;
  idempotencyReplayed?: boolean;
  itemCount?: number;
  orderId?: string;
  productId?: string;
  status?: OrderStatus;
}

const responseContexts = new WeakMap<Response, HttpLogContext>();

export function mergeHttpLogContext(
  response: Response,
  context: HttpLogContext
): void {
  responseContexts.set(response, {
    ...responseContexts.get(response),
    ...context
  });
}

export function getHttpLogContext(response: Response): HttpLogContext {
  return responseContexts.get(response) ?? {};
}
