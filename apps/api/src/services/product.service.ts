import type {
  Product,
  ProductListResponse
} from "@case-cell-shop/contracts";

import { createProductNotFoundError } from "../domain/errors/commerce.errors";
import { createAppError } from "../domain/errors/app-error";
import { toProductContract } from "../infrastructure/database/mappers/product.mapper";
import type { ProductRepository } from "../repositories/product.repository";

export const DEFAULT_PRODUCT_PAGE_SIZE = 20;

export interface ListProductsInput {
  cursor: string | undefined;
  limit: number | undefined;
}

export interface ProductService {
  getById(id: string): Promise<Product>;
  list(input: ListProductsInput): Promise<ProductListResponse>;
}

interface ProductServiceDependencies {
  productRepository: ProductRepository;
}

function createProductsUnavailableError(cause: unknown): Error {
  return createAppError({
    cause,
    code: "PRODUCTS_UNAVAILABLE",
    message: "Não foi possível consultar os produtos no momento.",
    retryable: true,
    statusCode: 503
  });
}

export function createProductService(
  dependencies: ProductServiceDependencies
): ProductService {
  return {
    getById: async (id) => {
      let product;

      try {
        product = await dependencies.productRepository.findActiveById(id);
      } catch (cause: unknown) {
        throw createProductsUnavailableError(cause);
      }

      if (product === null) {
        throw createProductNotFoundError();
      }

      return toProductContract(product);
    },
    list: async ({ cursor, limit }) => {
      const pageSize = limit ?? DEFAULT_PRODUCT_PAGE_SIZE;
      let products;

      try {
        products = await dependencies.productRepository.findActivePage({
          cursor,
          take: pageSize + 1
        });
      } catch (cause: unknown) {
        throw createProductsUnavailableError(cause);
      }

      const hasNextPage = products.length > pageSize;
      const page = products.slice(0, pageSize);
      const lastProduct = page.at(-1);

      return {
        items: page.map(toProductContract),
        nextCursor:
          hasNextPage && lastProduct !== undefined ? lastProduct.id : null
      };
    }
  };
}
