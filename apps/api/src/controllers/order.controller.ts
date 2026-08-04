import type { CreateOrderRequest } from "@case-cell-shop/contracts";
import type { RequestHandler } from "express";

import type { OrderService } from "../services/order.service";
import { mergeHttpLogContext } from "../utils/http-log-context";

export function createOrderController(
  orderService: OrderService
): RequestHandler {
  return async (request, response) => {
    const idempotencyKey = request.get("Idempotency-Key") as string;
    const orderRequest = request.body as CreateOrderRequest;
    mergeHttpLogContext(response, {
      itemCount: orderRequest.items.length
    });
    const result = await orderService.create({
      idempotencyKey,
      request: orderRequest,
      requestId: request.requestId
    });

    if (result.kind === "ACCEPTED") {
      mergeHttpLogContext(response, {
        orderId: result.body.orderId,
        status: result.body.status
      });
    } else {
      mergeHttpLogContext(response, {
        idempotencyReplayed: result.kind === "REPLAYED",
        itemCount: result.body.order.items.length,
        orderId: result.body.order.id,
        status: result.body.order.status
      });
    }

    switch (result.kind) {
      case "CREATED":
        response.status(201).json(result.body);
        return;
      case "ACCEPTED":
        response.status(202).json(result.body);
        return;
      case "REPLAYED":
        response.setHeader("Idempotency-Replayed", "true");
        response.status(200).json(result.body);
    }
  };
}

export function createGetOrderStatusController(
  orderService: OrderService
): RequestHandler {
  return async (request, response) => {
    const id = request.params.id as string;
    mergeHttpLogContext(response, { orderId: id });
    const body = await orderService.getStatus(id);

    mergeHttpLogContext(response, {
      itemCount: body.items.length,
      orderId: body.orderId,
      status: body.status
    });

    response.status(200).json(body);
  };
}
