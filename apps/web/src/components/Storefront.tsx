"use client";

import { useEffect, useState } from "react";

import { CartProvider, useCart } from "@/hooks/useCart";
import { useCheckout } from "@/hooks/useCheckout";
import { useProducts } from "@/hooks/useProducts";
import { CheckoutStatus } from "./CheckoutStatus";
import { ProductCard } from "./ProductCard";
import { ShoppingCart } from "./ShoppingCart";

function validateQuantity(
  value: string,
  availableQuantity: number
): string | null {
  if (!/^[1-9]\d*$/.test(value)) {
    return "Informe uma quantidade inteira maior que zero.";
  }

  const quantity = Number(value);

  if (!Number.isSafeInteger(quantity)) {
    return "Informe uma quantidade válida.";
  }

  if (quantity > availableQuantity) {
    return "A quantidade solicitada supera o estoque exibido.";
  }

  return null;
}

function StorefrontContent() {
  const { error, isLoading, isRefreshing, products, refresh } = useProducts();
  const cart = useCart();
  const { addItem, clearCart, syncProducts, totalItems } = cart;
  const checkout = useCheckout({
    onConfirmed: () => {
      clearCart();
      refresh();
    },
    onStockRejected: refresh
  });
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [quantityErrors, setQuantityErrors] = useState<
    Record<string, string | null>
  >({});
  const [cartMessage, setCartMessage] = useState("");

  useEffect(() => {
    setQuantities((current) => {
      let changed = false;
      const next = { ...current };

      for (const product of products) {
        if (next[product.id] === undefined) {
          next[product.id] = "1";
          changed = true;
        }
      }

      return changed ? next : current;
    });
    syncProducts(products);
  }, [products, syncProducts]);

  function handleQuantityChange(productId: string, value: string): void {
    setQuantities((current) => ({ ...current, [productId]: value }));
    setQuantityErrors((current) => ({ ...current, [productId]: null }));
  }

  function handleAdd(productId: string): void {
    const product = products.find((item) => item.id === productId);

    if (product === undefined) {
      return;
    }

    const value = quantities[productId] ?? "";
    const validationError = validateQuantity(
      value,
      product.availableQuantity
    );

    if (validationError !== null) {
      setQuantityErrors((current) => ({
        ...current,
        [productId]: validationError
      }));
      return;
    }

    const result = addItem(product, Number(value));

    if (!result.ok) {
      setQuantityErrors((current) => ({
        ...current,
        [productId]: result.message
      }));
      return;
    }

    checkout.invalidateIntent();
    setQuantities((current) => ({ ...current, [productId]: "1" }));
    setCartMessage(`${product.name} foi adicionado ao carrinho.`);
  }

  function handleCartChanged(): void {
    checkout.invalidateIntent();
    setCartMessage("Carrinho atualizado.");
  }

  return (
    <main>
      <header className="site-header">
        <a
          className="brand"
          href="#catalogo"
          aria-label="CaseCellShop — ir ao catálogo"
        >
          <span className="brand-mark" aria-hidden="true">
            C
          </span>
          <span>CaseCellShop</span>
        </a>
        <a className="header-note" href="#carrinho">
          Carrinho ({totalItems})
        </a>
      </header>

      <div className="storefront-layout">
        <section className="shop-hero" aria-labelledby="page-title">
          <div className="hero-copy">
            <p className="eyebrow">Sua capa. Seu jeito.</p>
            <h1 id="page-title">
              Proteção com <em>personalidade.</em>
            </h1>
            <p className="hero-description">
              Escolha seus favoritos e finalize tudo de uma vez!
              Fácil, rápido e sem complicação.
            </p>
            <a className="hero-link" href="#catalogo">
              Explorar coleção <span aria-hidden="true">↓</span>
            </a>
          </div>

          <div className="hero-art" aria-hidden="true">
            <div className="hero-case hero-case--back" />
            <div className="hero-case hero-case--front">
              <span>CASE</span>
              <span>CELL</span>
            </div>
          </div>
        </section>

        <section
          className="catalog-section"
          id="catalogo"
          aria-labelledby="catalog-title"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Coleção disponível</p>
              <h2 id="catalog-title">Escolha as suas próximas capas</h2>
            </div>
            {!isLoading && error === null && (
              <p className="catalog-count" aria-live="polite">
                {products.length}{" "}
                {products.length === 1 ? "modelo" : "modelos"}
                {isRefreshing && " · atualizando…"}
              </p>
            )}
          </div>

          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {cartMessage}
          </p>

          {isLoading && (
            <div className="loading-state" aria-busy="true" aria-live="polite">
              <span className="loading-ring" aria-hidden="true" />
              <h2>Carregando produtos</h2>
              <p>Consultando preços e estoque…</p>
            </div>
          )}

          {!isLoading && error !== null && products.length === 0 && (
            <div className="empty-state" role="alert">
              <span className="empty-state__symbol" aria-hidden="true">
                !
              </span>
              <h2>Não foi possível carregar os produtos</h2>
              <p>{error}</p>
              <button
                className="secondary-button"
                type="button"
                onClick={refresh}
              >
                Tentar novamente
              </button>
            </div>
          )}

          {!isLoading && error === null && products.length === 0 && (
            <div className="empty-state">
              <h2>Nenhum produto disponível</h2>
              <p>Volte em breve para conferir novos modelos.</p>
            </div>
          )}

          {products.length > 0 && (
            <div className="product-grid" aria-busy={isRefreshing}>
              {products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  quantity={quantities[product.id] ?? "1"}
                  quantityError={quantityErrors[product.id] ?? null}
                  disabled={checkout.isLocked}
                  onAdd={handleAdd}
                  onQuantityChange={handleQuantityChange}
                />
              ))}
            </div>
          )}
        </section>

        <aside className="cart-sidebar" id="carrinho">
          <ShoppingCart
            checkoutState={checkout.state}
            disabled={checkout.isLocked}
            onCartChanged={handleCartChanged}
            onCheckout={(items) => {
              void checkout.checkout(items);
            }}
          />
        </aside>
      </div>

      <CheckoutStatus
        state={checkout.state}
        onReset={checkout.reset}
        onResumePolling={checkout.resumePolling}
        onRetry={() => {
          void checkout.retry();
        }}
        onRetryAsNewIntent={() => {
          void checkout.retryAsNewIntent();
        }}
      />

      <footer className="site-footer">
        <span>CaseCellShop</span>
        <p>Seu estilo, sua escolha · Compra simples e segura</p>
      </footer>
    </main>
  );
}

export function Storefront() {
  return (
    <CartProvider>
      <StorefrontContent />
    </CartProvider>
  );
}
