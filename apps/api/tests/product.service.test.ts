import type { Product as ProductRecord } from "@prisma/client";

import type { ProductRepository } from "../src/repositories/product.repository";
import { createProductService } from "../src/services/product.service";

const createdAt = new Date("2026-08-02T12:00:00.000Z");
const updatedAt = new Date("2026-08-02T12:01:00.000Z");

function createProductRecord(
  id: string,
  name: string,
  stock: number
): ProductRecord {
  return {
    id,
    name,
    description: `Descrição de ${name}`,
    priceInCents: 3_990,
    stock,
    active: true,
    createdAt,
    updatedAt
  };
}

describe("product service", () => {
  let findActiveById: jest.MockedFunction<ProductRepository["findActiveById"]>;
  let findActivePage: jest.MockedFunction<ProductRepository["findActivePage"]>;
  let productRepository: jest.Mocked<ProductRepository>;

  beforeEach(() => {
    findActiveById = jest.fn();
    findActivePage = jest.fn();
    productRepository = {
      findActiveById,
      findActivePage
    };
  });

  it("mapeia uma página e cria cursor quando existe outro produto", async () => {
    const first = createProductRecord("product-a", "Capinha A", 5);
    const second = createProductRecord("product-b", "Capinha B", 3);
    const extra = createProductRecord("product-c", "Capinha C", 8);
    findActivePage.mockResolvedValue([
      first,
      second,
      extra
    ]);
    const service = createProductService({ productRepository });

    const result = await service.list({ cursor: undefined, limit: 2 });

    expect(findActivePage).toHaveBeenCalledWith({
      cursor: undefined,
      take: 3
    });
    expect(result).toEqual({
      items: [
        {
          id: first.id,
          name: first.name,
          description: first.description,
          priceInCents: first.priceInCents,
          availableQuantity: first.stock
        },
        {
          id: second.id,
          name: second.name,
          description: second.description,
          priceInCents: second.priceInCents,
          availableQuantity: second.stock
        }
      ],
      nextCursor: second.id
    });
  });

  it("retorna PRODUCT_NOT_FOUND quando o produto ativo não existe", async () => {
    findActiveById.mockResolvedValue(null);
    const service = createProductService({ productRepository });

    await expect(service.getById("missing-product")).rejects.toMatchObject({
      code: "PRODUCT_NOT_FOUND",
      message: "Produto não encontrado.",
      retryable: false,
      statusCode: 404
    });
  });

});
