"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from "react";

import type { Product } from "@case-cell-shop/contracts";

export interface CartItem {
  availableStock: number;
  name: string;
  priceInCents: number;
  productId: string;
  quantity: number;
}

export type CartOperationResult =
  | { ok: true }
  | { message: string; ok: false };

export interface UseCartResult {
  addItem(product: Product, quantity: number): CartOperationResult;
  clearCart(): void;
  getItemQuantity(productId: string): number;
  items: CartItem[];
  removeItem(productId: string): void;
  syncProducts(products: Product[]): void;
  totalItems: number;
  totalPriceInCents: number;
  updateItemQuantity(
    productId: string,
    quantity: number
  ): CartOperationResult;
}

const CartContext = createContext<UseCartResult | null>(null);

function validateQuantity(
  quantity: number,
  availableStock: number
): CartOperationResult {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    return {
      message: "A quantidade deve ser um inteiro maior que zero.",
      ok: false
    };
  }

  if (quantity > availableStock) {
    return {
      message: "A quantidade desejada ultrapassa o estoque conhecido.",
      ok: false
    };
  }

  return { ok: true };
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);

  const addItem = useCallback(
    (product: Product, quantity: number): CartOperationResult => {
      const existingItem = items.find(
        (item) => item.productId === product.id
      );
      const nextQuantity = (existingItem?.quantity ?? 0) + quantity;
      const validation = validateQuantity(
        nextQuantity,
        product.availableQuantity
      );

      if (!validation.ok) {
        return validation;
      }

      setItems((current) => {
        const currentItem = current.find(
          (item) => item.productId === product.id
        );

        if (currentItem === undefined) {
          return [
            ...current,
            {
              availableStock: product.availableQuantity,
              name: product.name,
              priceInCents: product.priceInCents,
              productId: product.id,
              quantity
            }
          ];
        }

        return current.map((item) =>
          item.productId === product.id
            ? {
                ...item,
                availableStock: product.availableQuantity,
                name: product.name,
                priceInCents: product.priceInCents,
                quantity: item.quantity + quantity
              }
            : item
        );
      });
      return { ok: true };
    },
    [items]
  );

  const updateItemQuantity = useCallback(
    (productId: string, quantity: number): CartOperationResult => {
      const item = items.find((candidate) => candidate.productId === productId);

      if (item === undefined) {
        return { message: "Item não encontrado no carrinho.", ok: false };
      }

      const validation = validateQuantity(quantity, item.availableStock);

      if (!validation.ok) {
        return validation;
      }

      setItems((current) =>
        current.map((candidate) =>
          candidate.productId === productId
            ? { ...candidate, quantity }
            : candidate
        )
      );
      return { ok: true };
    },
    [items]
  );

  const removeItem = useCallback((productId: string) => {
    setItems((current) =>
      current.filter((item) => item.productId !== productId)
    );
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  const getItemQuantity = useCallback(
    (productId: string) =>
      items.find((item) => item.productId === productId)?.quantity ?? 0,
    [items]
  );

  const syncProducts = useCallback((products: Product[]) => {
    const productsById = new Map(
      products.map((product) => [product.id, product])
    );

    setItems((current) => {
      let changed = false;
      const nextItems = current.map((item) => {
        const product = productsById.get(item.productId);

        if (product === undefined) {
          return item;
        }

        if (
          item.availableStock === product.availableQuantity &&
          item.name === product.name &&
          item.priceInCents === product.priceInCents
        ) {
          return item;
        }

        changed = true;

        return {
          ...item,
          availableStock: product.availableQuantity,
          name: product.name,
          priceInCents: product.priceInCents
        };
      });

      return changed ? nextItems : current;
    });
  }, []);

  const value = useMemo<UseCartResult>(() => {
    const totalItems = items.reduce(
      (total, item) => total + item.quantity,
      0
    );
    const totalPriceInCents = items.reduce(
      (total, item) => total + item.priceInCents * item.quantity,
      0
    );

    return {
      addItem,
      clearCart,
      getItemQuantity,
      items,
      removeItem,
      syncProducts,
      totalItems,
      totalPriceInCents,
      updateItemQuantity
    };
  }, [
    addItem,
    clearCart,
    getItemQuantity,
    items,
    removeItem,
    syncProducts,
    updateItemQuantity
  ]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): UseCartResult {
  const context = useContext(CartContext);

  if (context === null) {
    throw new Error("useCart deve ser utilizado dentro de CartProvider.");
  }

  return context;
}
