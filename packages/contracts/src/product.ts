export interface Product {
  id: string;
  name: string;
  description: string;
  priceInCents: number;
  availableQuantity: number;
}

export interface ProductListResponse {
  items: Product[];
  nextCursor: string | null;
}
