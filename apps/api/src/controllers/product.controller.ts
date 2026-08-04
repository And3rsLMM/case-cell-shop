import type {
  Product,
  ProductListResponse
} from "@case-cell-shop/contracts";
import type { RequestHandler } from "express";

import type { ProductService } from "../services/product.service";
import { mergeHttpLogContext } from "../utils/http-log-context";

interface ProductListQuery {
  cursor?: string;
  limit?: string;
}

export function createListProductsController(
  productService: ProductService
): RequestHandler<
  Record<string, never>,
  ProductListResponse,
  never,
  ProductListQuery
> {
  return async (request, response) => {
    const body = await productService.list({
      cursor: request.query.cursor,
      limit:
        request.query.limit === undefined
          ? undefined
          : Number(request.query.limit)
    });

    response.status(200).json(body);
  };
}

export function createGetProductByIdController(
  productService: ProductService
): RequestHandler {
  return async (request, response) => {
    const id = request.params.id as string;
    mergeHttpLogContext(response, { productId: id });
    const body: Product = await productService.getById(id);

    response.status(200).json(body);
  };
}
