import type {
  OrderAcceptedResponse,
  Order as OrderContract,
  OrderItem as OrderItemContract,
  OrderResponse,
  OrderStatus as PublicOrderStatus,
  OrderStatusResponse
} from "@case-cell-shop/contracts";
import type {
  OrderStatus as PersistenceOrderStatus,
  Prisma
} from "@prisma/client";

export type PersistenceOrderWithItems = Prisma.OrderGetPayload<{
  include: { items: true };
}>;

function toPublicOrderStatus(
  status: PersistenceOrderStatus
): PublicOrderStatus {
  switch (status) {
    case "PENDING":
    case "PROCESSING":
    case "CONFIRMED":
    case "FAILED":
    case "STOCK_REJECTED":
      return status;
  }
}

function toOrderItemContract(
  item: PersistenceOrderWithItems["items"][number]
): OrderItemContract {
  return {
    productId: item.productId,
    name: item.productNameSnapshot,
    unitPriceInCents: item.unitPriceInCents,
    quantity: item.quantity,
    subtotalInCents: item.subtotalInCents
  };
}

export function toOrderContract(
  order: PersistenceOrderWithItems
): OrderContract {
  return {
    id: order.id,
    totalPriceInCents: order.totalPriceInCents,
    items: order.items.map(toOrderItemContract),
    status: toPublicOrderStatus(order.status),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString()
  };
}

export function toOrderResponse(
  order: PersistenceOrderWithItems
): OrderResponse {
  return {
    order: toOrderContract(order)
  };
}

export function toOrderStatusResponse(
  order: PersistenceOrderWithItems
): OrderStatusResponse {
  return {
    orderId: order.id,
    status: toPublicOrderStatus(order.status),
    totalPriceInCents: order.totalPriceInCents,
    items: order.items.map(toOrderItemContract),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString()
  };
}

export function toOrderAcceptedResponse(
  order: PersistenceOrderWithItems,
  statusUrl: string
): OrderAcceptedResponse {
  return {
    orderId: order.id,
    status: "PROCESSING",
    statusUrl
  };
}
