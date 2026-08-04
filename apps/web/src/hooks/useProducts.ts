"use client";

import { useCallback, useEffect, useState } from "react";

import type { Product } from "@case-cell-shop/contracts";

import {
  apiClient as defaultApiClient,
  type ApiClient
} from "@/lib/api-client";

interface ProductsState {
  error: string | null;
  isLoading: boolean;
  isRefreshing: boolean;
  products: Product[];
}

export interface UseProductsResult extends ProductsState {
  refresh(): void;
}

export function useProducts(
  client: Pick<ApiClient, "getProducts"> = defaultApiClient
): UseProductsResult {
  const [reloadVersion, setReloadVersion] = useState(0);
  const [state, setState] = useState<ProductsState>({
    error: null,
    isLoading: true,
    isRefreshing: false,
    products: []
  });

  const refresh = useCallback(() => {
    setReloadVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    const abortController = new AbortController();
    let active = true;

    setState((current) => ({
      ...current,
      error: null,
      isLoading: current.products.length === 0,
      isRefreshing: current.products.length > 0
    }));

    async function loadProducts(): Promise<void> {
      try {
        const response = await client.getProducts(abortController.signal);

        if (!active) {
          return;
        }

        setState({
          error: null,
          isLoading: false,
          isRefreshing: false,
          products: response.items
        });
      } catch (error: unknown) {
        if (
          !active ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          return;
        }

        setState((current) => ({
          ...current,
          error:
            error instanceof Error
              ? error.message
              : "Não foi possível carregar os produtos.",
          isLoading: false,
          isRefreshing: false
        }));
      }
    }

    void loadProducts();

    return () => {
      active = false;
      abortController.abort();
    };
  }, [client, reloadVersion]);

  return { ...state, refresh };
}
