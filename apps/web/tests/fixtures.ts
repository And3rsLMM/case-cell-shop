import type {
  Order,
  OrderAcceptedResponse,
  OrderResponse,
  OrderStatusResponse,
  Product,
  ProductListResponse
} from "@case-cell-shop/contracts";

export const productFixture: Product = {
  id: "product-1",
  name: "Capinha Azul",
  description: "Proteção resistente em silicone.",
  priceInCents: 4990,
  availableQuantity: 3
};

export function productListFixture(
  products: Product[] = [productFixture]
): ProductListResponse {
  return {
    items: products,
    nextCursor: null
  };
}

export function orderFixture(
  overrides: Partial<Order> = {}
): Order {
  return {
    id: "order-1",
    items: [
      {
        name: productFixture.name,
        productId: productFixture.id,
        quantity: 1,
        subtotalInCents: productFixture.priceInCents,
        unitPriceInCents: productFixture.priceInCents
      }
    ],
    totalPriceInCents: productFixture.priceInCents,
    status: "CONFIRMED",
    createdAt: "2026-08-03T10:00:00.000Z",
    updatedAt: "2026-08-03T10:00:01.000Z",
    ...overrides
  };
}

export function orderResponseFixture(
  overrides: Partial<Order> = {}
): OrderResponse {
  const order = orderFixture(overrides);
  return {
    order
  };
}

export function orderStatusFixture(
  overrides: Partial<OrderStatusResponse> = {}
): OrderStatusResponse {
  return {
    orderId: "order-1",
    status: "CONFIRMED",
    totalPriceInCents: productFixture.priceInCents,
    items: orderFixture().items,
    createdAt: "2026-08-03T10:00:00.000Z",
    updatedAt: "2026-08-03T10:00:01.000Z",
    ...overrides
  };
}

export function orderAcceptedFixture(
  orderId = "order-1"
): OrderAcceptedResponse {
  return {
    orderId,
    status: "PROCESSING",
    statusUrl: `/api/orders/${orderId}`
  };
}
