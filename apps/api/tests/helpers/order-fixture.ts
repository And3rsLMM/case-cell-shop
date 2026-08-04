import type { CreateOrderRequest } from "@case-cell-shop/contracts";

import type { OrderWithItems } from "../../src/repositories/order.repository";
import { createOrderRequestHash } from "../../src/utils/order-request-hash";

const defaultCreatedAt = new Date("2026-08-02T12:00:00.000Z");
const defaultUpdatedAt = new Date("2026-08-02T12:01:00.000Z");

export const defaultOrderRequest = {
  items: [{ productId: "product-1", quantity: 1 }]
} satisfies CreateOrderRequest;

type OrderOverrides = Partial<Omit<OrderWithItems, "items">> & {
  items?: OrderWithItems["items"];
};

export function createOrderRecord(
  overrides: OrderOverrides = {}
): OrderWithItems {
  const orderId = overrides.id ?? "order-1";
  const items = overrides.items ?? [
    {
      createdAt: defaultCreatedAt,
      id: "order-item-1",
      orderId,
      productId: "product-1",
      productNameSnapshot: "Capinha de teste",
      quantity: 1,
      subtotalInCents: 3_990,
      unitPriceInCents: 3_990
    }
  ];

  return {
    id: orderId,
    idempotencyKey: "order-key-123",
    requestHash: createOrderRequestHash({
      items: items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity
      }))
    }),
    totalPriceInCents: items.reduce(
      (total, item) => total + item.subtotalInCents,
      0
    ),
    status: "PENDING",
    errorCode: null,
    errorMessage: null,
    processingAttempts: 0,
    stockReleasedAt: null,
    createdAt: defaultCreatedAt,
    updatedAt: defaultUpdatedAt,
    ...overrides,
    items
  };
}
