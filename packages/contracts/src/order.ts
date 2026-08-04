export const ORDER_STATUSES = [
  "PENDING",
  "PROCESSING",
  "CONFIRMED",
  "FAILED",
  "STOCK_REJECTED"
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface CreateOrderItemRequest {
  productId: string;
  quantity: number;
}

export interface CreateOrderRequest {
  items: CreateOrderItemRequest[];
}

export interface OrderItem {
  productId: string;
  name: string;
  unitPriceInCents: number;
  quantity: number;
  subtotalInCents: number;
}

export interface Order {
  id: string;
  totalPriceInCents: number;
  items: OrderItem[];
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
}

export interface OrderResponse {
  order: Order;
}

export interface OrderAcceptedResponse {
  orderId: string;
  status: "PROCESSING";
  statusUrl: string;
}

export interface OrderStatusResponse {
  orderId: string;
  status: OrderStatus;
  totalPriceInCents: number;
  items: OrderItem[];
  createdAt: string;
  updatedAt: string;
}
