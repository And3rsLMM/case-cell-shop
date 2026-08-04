import type { Product as ProductRecord } from "@prisma/client";
import type {
  ApiError,
  Product,
  ProductListResponse,
  ValidationErrorDetails
} from "@case-cell-shop/contracts";

import { createApp } from "../src/app";
import type {
  FindActiveProductsPageInput,
  ProductRepository
} from "../src/repositories/product.repository";
import type { Logger } from "../src/utils/logger";
import {
  startHttpTestServer,
  type HttpTestServer
} from "./helpers/http-test-server";

const createdAt = new Date("2026-08-02T12:00:00.000Z");
const updatedAt = new Date("2026-08-02T12:01:00.000Z");

const products: ProductRecord[] = [
  {
    id: "product-gamma",
    name: "Capinha Gamma",
    description: "Descrição Gamma",
    priceInCents: 5_990,
    stock: 7,
    active: true,
    createdAt,
    updatedAt
  },
  {
    id: "product-internal",
    name: "Capinha Interna",
    description: "Produto inativo",
    priceInCents: 9_990,
    stock: 20,
    active: false,
    createdAt,
    updatedAt
  },
  {
    id: "product-alpha",
    name: "Capinha Alpha",
    description: "Descrição Alpha",
    priceInCents: 2_990,
    stock: 4,
    active: true,
    createdAt,
    updatedAt
  },
  {
    id: "product-beta",
    name: "Capinha Beta",
    description: "Descrição Beta",
    priceInCents: 3_990,
    stock: 1,
    active: true,
    createdAt,
    updatedAt
  }
];

function compareProducts(left: ProductRecord, right: ProductRecord): number {
  if (left.name !== right.name) {
    return left.name < right.name ? -1 : 1;
  }

  return left.id < right.id ? -1 : left.id === right.id ? 0 : 1;
}

describe("endpoints HTTP de produtos", () => {
  let server: HttpTestServer;
  let baseUrl: string;
  let logger: jest.Mocked<Logger>;
  let productRepository: jest.Mocked<ProductRepository>;

  beforeAll(async () => {
    logger = {
      error: jest.fn(),
      info: jest.fn()
    };
    productRepository = {
      findActiveById: jest.fn(),
      findActivePage: jest.fn()
    };

    const app = createApp({
      logger,
      productRepository,
      requestIdFactory: () => "products-request-id"
    });

    server = await startHttpTestServer(app);
    baseUrl = server.baseUrl;
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    productRepository.findActivePage.mockImplementation(
      ({ cursor, take }: FindActiveProductsPageInput) => {
        const activeProducts = products
          .filter(({ active }) => active)
          .sort(compareProducts);
        const cursorIndex =
          cursor === undefined
            ? -1
            : activeProducts.findIndex(({ id }) => id === cursor);

        if (cursor !== undefined && cursorIndex === -1) {
          return Promise.resolve([]);
        }

        return Promise.resolve(
          activeProducts.slice(cursorIndex + 1, cursorIndex + 1 + take)
        );
      }
    );
    productRepository.findActiveById.mockImplementation((id) => {
      const product =
        products.find((item) => item.id === id && item.active) ?? null;

      return Promise.resolve(product);
    });
  });

  it("lista somente ativos, ordenados e sem campos internos", async () => {
    const response = await fetch(`${baseUrl}/api/products?limit=2`);
    const body = (await response.json()) as ProductListResponse;

    expect(response.status).toBe(200);
    expect(body).toEqual({
      items: [
        {
          id: "product-alpha",
          name: "Capinha Alpha",
          description: "Descrição Alpha",
          priceInCents: 2_990,
          availableQuantity: 4
        },
        {
          id: "product-beta",
          name: "Capinha Beta",
          description: "Descrição Beta",
          priceInCents: 3_990,
          availableQuantity: 1
        }
      ],
      nextCursor: "product-beta"
    });
    expect(body.items[0]).not.toHaveProperty("active");
    expect(body.items[0]).not.toHaveProperty("stock");
    expect(body.items[0]).not.toHaveProperty("createdAt");
  });

  it("retorna um produto ativo pelo id", async () => {
    const response = await fetch(`${baseUrl}/api/products/product-beta`);
    const body = (await response.json()) as Product;

    expect(response.status).toBe(200);
    expect(body).toEqual({
      id: "product-beta",
      name: "Capinha Beta",
      description: "Descrição Beta",
      priceInCents: 3_990,
      availableQuantity: 1
    });
  });

  it("retorna PRODUCT_NOT_FOUND para produto inexistente", async () => {
    const response = await fetch(`${baseUrl}/api/products/missing-product`);
    const body = (await response.json()) as ApiError;

    expect(response.status).toBe(404);
    expect(body).toEqual({
      error: {
        code: "PRODUCT_NOT_FOUND",
        details: {},
        message: "Produto não encontrado.",
        retryable: false,
        requestId: "products-request-id"
      }
    });
  });

  it("retorna erro padronizado para id inválido", async () => {
    const response = await fetch(`${baseUrl}/api/products/%20%20%20`);
    const body = (await response.json()) as ApiError;

    expect(response.status).toBe(400);
    expect(body.error).toEqual({
      code: "VALIDATION_ERROR",
      message: "Os dados enviados são inválidos.",
      details: {
        fields: [
          {
            field: "id",
            message: "O identificador deve ser uma string não vazia."
          }
        ]
      },
      retryable: false,
      requestId: "products-request-id"
    });
  });

  it("rejeita parâmetros de paginação inválidos ou desconhecidos", async () => {
    const response = await fetch(
      `${baseUrl}/api/products?limit=0&sort=price`
    );
    const body = (await response.json()) as ApiError;

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    const details = body.error.details as
      | ValidationErrorDetails
      | undefined;

    expect(details?.fields).toEqual(
      expect.arrayContaining([
        {
          field: "limit",
          message: "O limite deve ser um inteiro entre 1 e 100."
        },
        {
          field: "sort",
          message: "O parâmetro de consulta não é permitido."
        }
      ])
    );
  });

  it("não expõe detalhes internos quando a persistência falha", async () => {
    productRepository.findActivePage.mockRejectedValueOnce(
      new Error("Prisma SQLITE_BUSY em /caminho/interno/database.db")
    );

    const response = await fetch(`${baseUrl}/api/products`);
    const body = (await response.json()) as ApiError;

    expect(response.status).toBe(503);
    expect(body.error).toEqual({
      code: "PRODUCTS_UNAVAILABLE",
      details: {},
      message: "Não foi possível consultar os produtos no momento.",
      retryable: true,
      requestId: "products-request-id"
    });
    expect(JSON.stringify(body)).not.toContain("Prisma");
    expect(JSON.stringify(body)).not.toContain("database.db");
  });
});
