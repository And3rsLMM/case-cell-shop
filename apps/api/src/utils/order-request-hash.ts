import { createHash } from "node:crypto";

import type {
  CreateOrderItemRequest,
  CreateOrderRequest
} from "@case-cell-shop/contracts";

export function normalizeOrderItems(
  items: CreateOrderItemRequest[]
): CreateOrderItemRequest[] {
  return items
    .map(({ productId, quantity }) => ({
      productId: productId.normalize("NFC"),
      quantity
    }))
    .sort((first, second) => {
      if (first.productId < second.productId) {
        return -1;
      }

      if (first.productId > second.productId) {
        return 1;
      }

      return 0;
    });
}

function serializeCanonicalOrderRequest(request: CreateOrderRequest): string {
  return JSON.stringify(normalizeOrderItems(request.items));
}

export function createOrderRequestHash(
  request: CreateOrderRequest
): string {
  return createHash("sha256")
    .update(serializeCanonicalOrderRequest(request), "utf8")
    .digest("hex");
}
