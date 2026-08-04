import { Router } from "express";

import {
  createGetProductByIdController,
  createListProductsController
} from "../controllers/product.controller";
import { handleValidationErrors } from "../middlewares/validation-error.middleware";
import type { ProductService } from "../services/product.service";
import {
  getProductByIdValidators,
  getProductsValidators
} from "../validators";

interface ProductRouterDependencies {
  productService: ProductService;
}

export function createProductRouter(
  dependencies: ProductRouterDependencies
): Router {
  const router = Router();

  router.get(
    "/",
    ...getProductsValidators,
    handleValidationErrors,
    createListProductsController(dependencies.productService)
  );
  router.get(
    "/:id",
    ...getProductByIdValidators,
    handleValidationErrors,
    createGetProductByIdController(dependencies.productService)
  );

  return router;
}
