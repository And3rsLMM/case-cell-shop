import type { Product as ProductRecord } from "@prisma/client";
import type { Product } from "@case-cell-shop/contracts";

export function toProductContract(product: ProductRecord): Product {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    priceInCents: product.priceInCents,
    availableQuantity: product.stock
  };
}
