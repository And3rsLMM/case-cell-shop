import { Router } from "express";

import {
  createGetOrderStatusController,
  createOrderController
} from "../controllers/order.controller";
import { handleRequiredIdempotencyKey } from "../middlewares/idempotency-key-required.middleware";
import { handleValidationErrors } from "../middlewares/validation-error.middleware";
import type { OrderService } from "../services/order.service";
import {
  createOrderValidators,
  getOrderByIdValidators
} from "../validators";

interface OrderRouterDependencies {
  orderService: OrderService;
}

export function createOrderRouter(
  dependencies: OrderRouterDependencies
): Router {
  const router = Router();

  router.post(
    "/",
    ...createOrderValidators,
    handleRequiredIdempotencyKey,
    handleValidationErrors,
    createOrderController(dependencies.orderService)
  );
  router.get(
    "/:id",
    ...getOrderByIdValidators,
    handleValidationErrors,
    createGetOrderStatusController(dependencies.orderService)
  );

  return router;
}
