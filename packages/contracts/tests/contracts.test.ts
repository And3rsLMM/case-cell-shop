import {
  ORDER_STATUSES,
  type ApiError,
  type CreateOrderRequest,
  type Order,
  type OrderAcceptedResponse,
  type OrderResponse,
  type OrderStatusResponse,
  type Product,
  type ProductListResponse,
  type ValidationErrorDetails
} from "../src";

const productFixture = {
  id: "product-1",
  name: "Capinha transparente",
  description: "Capinha transparente para celular.",
  priceInCents: 2_990,
  availableQuantity: 12
} satisfies Product;

const productListFixture = {
  items: [productFixture],
  nextCursor: null
} satisfies ProductListResponse;

const createOrderFixture = {
  items: [
    {
      productId: productFixture.id,
      quantity: 2
    }
  ]
} satisfies CreateOrderRequest;

const orderFixture = {
  id: "order-1",
  items: [
    {
      productId: productFixture.id,
      name: productFixture.name,
      quantity: 2,
      unitPriceInCents: productFixture.priceInCents,
      subtotalInCents: 5_980
    }
  ],
  totalPriceInCents: 5_980,
  status: "PENDING",
  createdAt: "2026-08-02T12:00:00.000Z",
  updatedAt: "2026-08-02T12:00:00.000Z"
} satisfies Order;

const orderResponseFixture = {
  order: orderFixture
} satisfies OrderResponse;

const orderAcceptedFixture = {
  orderId: orderFixture.id,
  status: "PROCESSING",
  statusUrl: `/api/orders/${orderFixture.id}`
} satisfies OrderAcceptedResponse;

const orderStatusFixture = {
  orderId: orderFixture.id,
  status: "PROCESSING",
  totalPriceInCents: orderFixture.totalPriceInCents,
  items: orderFixture.items,
  createdAt: orderFixture.createdAt,
  updatedAt: "2026-08-02T12:00:01.000Z"
} satisfies OrderStatusResponse;

const validationDetailsFixture = {
  fields: [
    {
      field: "quantity",
      message: "A quantidade deve ser um inteiro maior que zero."
    }
  ]
} satisfies ValidationErrorDetails;

const apiErrorFixture = {
  error: {
    code: "VALIDATION_ERROR",
    message: "Os dados enviados são inválidos.",
    details: validationDetailsFixture,
    retryable: false,
    requestId: "request-1"
  }
} satisfies ApiError;

describe("contratos públicos", () => {
  it("mantém o conjunto mínimo de estados de pedido", () => {
    expect(ORDER_STATUSES).toEqual([
      "PENDING",
      "PROCESSING",
      "CONFIRMED",
      "FAILED",
      "STOCK_REJECTED"
    ]);
  });

  it("representa respostas públicas sem entidades de persistência", () => {
    expect(productListFixture.items).toEqual([productFixture]);
    expect(createOrderFixture.items).toEqual([
      { productId: productFixture.id, quantity: 2 }
    ]);
    expect(orderResponseFixture.order).toEqual(orderFixture);
    expect(orderAcceptedFixture.status).toBe("PROCESSING");
    expect(orderStatusFixture.status).toBe("PROCESSING");
    expect(apiErrorFixture.error.details).toEqual(validationDetailsFixture);
  });
});
