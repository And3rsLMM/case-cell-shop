"use client";

import { useEffect, useState, type ChangeEvent } from "react";

import type { CreateOrderItemRequest } from "@case-cell-shop/contracts";

import { useCart } from "@/hooks/useCart";
import type { CheckoutState } from "@/hooks/useCheckout";
import { formatPrice } from "@/lib/formatters";

interface ShoppingCartProps {
  checkoutState: CheckoutState;
  disabled: boolean;
  onCartChanged(): void;
  onCheckout(items: CreateOrderItemRequest[]): void;
}

function affectedProducts(state: CheckoutState): Set<string> {
  if (
    state.phase !== "STOCK_REJECTED" &&
    state.phase !== "PRODUCT_UNAVAILABLE"
  ) {
    return new Set();
  }

  return new Set(state.affectedProductIds);
}

export function ShoppingCart({
  checkoutState,
  disabled,
  onCartChanged,
  onCheckout
}: ShoppingCartProps) {
  const cart = useCart();
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [quantityDrafts, setQuantityDrafts] = useState<
    Record<string, string>
  >({});
  const affected = affectedProducts(checkoutState);
  const hasInvalidItems =
    Object.values(errors).some((message) => message !== null) ||
    cart.items.some((item) => item.quantity > item.availableStock);

  useEffect(() => {
    if (cart.items.length === 0) {
      setErrors({});
      setQuantityDrafts({});
    }
  }, [cart.items.length]);

  function updateQuantity(productId: string, value: string): void {
    setQuantityDrafts((current) => ({ ...current, [productId]: value }));

    if (!/^[1-9]\d*$/.test(value)) {
      setErrors((current) => ({
        ...current,
        [productId]: "Informe uma quantidade inteira maior que zero."
      }));
      return;
    }

    const result = cart.updateItemQuantity(productId, Number(value));
    setErrors((current) => ({
      ...current,
      [productId]: result.ok ? null : result.message
    }));

    if (result.ok) {
      onCartChanged();
    }
  }

  function handleQuantityChange(
    productId: string,
    event: ChangeEvent<HTMLInputElement>
  ): void {
    updateQuantity(productId, event.target.value);
  }

  function removeItem(productId: string): void {
    cart.removeItem(productId);
    setErrors((current) => {
      const next = { ...current };
      delete next[productId];
      return next;
    });
    setQuantityDrafts((current) => {
      const next = { ...current };
      delete next[productId];
      return next;
    });
    onCartChanged();
  }

  function clearCart(): void {
    cart.clearCart();
    setErrors({});
    setQuantityDrafts({});
    onCartChanged();
  }

  function finalizeOrder(): void {
    if (cart.items.length === 0 || disabled || hasInvalidItems) {
      return;
    }

    onCheckout(
      cart.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity
      }))
    );
  }

  return (
    <section className="cart-section" aria-labelledby="cart-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Sua seleção</p>
          <h2 id="cart-title">Carrinho</h2>
        </div>
        <p className="catalog-count" aria-live="polite">
          {cart.totalItems} {cart.totalItems === 1 ? "item" : "itens"}
        </p>
      </div>

      {cart.items.length === 0 ? (
        <div className="cart-empty">
          <p>Seu carrinho está vazio.</p>
          <div className="cart-empty__actions">
            <a className="cart-empty__catalog-link" href="#catalogo">
              Escolher produtos
            </a>
            <button
              className="buy-button cart-checkout-button"
              type="button"
              disabled
            >
              Finalizar compra
            </button>
          </div>
        </div>
      ) : (
        <div className="cart-panel">
          <ul className="cart-items">
            {cart.items.map((item) => {
              const errorId = `cart-quantity-${item.productId}-error`;
              const isAffected = affected.has(item.productId);

              return (
                <li
                  className={`cart-item ${
                    isAffected ? "cart-item--affected" : ""
                  }`}
                  key={item.productId}
                >
                  <div className="cart-item__description">
                    <strong>{item.name}</strong>
                    <span>{formatPrice(item.priceInCents)} por unidade</span>
                    {isAffected && (
                      <span className="cart-item__warning" role="alert">
                        Revise este item antes de tentar novamente.
                      </span>
                    )}
                  </div>

                  <div className="cart-item__actions">
                    <label htmlFor={`cart-quantity-${item.productId}`}>
                      Quantidade
                    </label>
                    <button
                      type="button"
                      disabled={disabled || item.quantity <= 1}
                      aria-label={`Diminuir quantidade de ${item.name}`}
                      onClick={() =>
                        updateQuantity(item.productId, String(item.quantity - 1))
                      }
                    >
                      −
                    </button>
                    <input
                      id={`cart-quantity-${item.productId}`}
                      type="number"
                      min="1"
                      max={Math.max(1, item.availableStock)}
                      step="1"
                      value={quantityDrafts[item.productId] ?? item.quantity}
                      disabled={disabled}
                      aria-invalid={
                        errors[item.productId] !== null &&
                        errors[item.productId] !== undefined
                      }
                      aria-describedby={
                        errors[item.productId] ? errorId : undefined
                      }
                      onChange={(event) =>
                        handleQuantityChange(item.productId, event)
                      }
                    />
                    <button
                      type="button"
                      disabled={
                        disabled || item.quantity >= item.availableStock
                      }
                      aria-label={`Aumentar quantidade de ${item.name}`}
                      onClick={() =>
                        updateQuantity(item.productId, String(item.quantity + 1))
                      }
                    >
                      +
                    </button>
                    <button
                      className="cart-item__remove"
                      type="button"
                      disabled={disabled}
                      onClick={() => removeItem(item.productId)}
                    >
                      Remover {item.name}
                    </button>
                  </div>

                  <strong className="cart-item__subtotal">
                    {formatPrice(item.priceInCents * item.quantity)}
                  </strong>
                  {errors[item.productId] && (
                    <p className="field-error" id={errorId} role="alert">
                      {errors[item.productId]}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="cart-summary">
            <div>
              <span>Total do carrinho</span>
              <strong>{formatPrice(cart.totalPriceInCents)}</strong>
              <small>O preço definitivo é recalculado pela API Express.</small>
            </div>
            <div className="cart-summary__actions">
              <button
                className="secondary-button"
                type="button"
                disabled={disabled}
                onClick={clearCart}
              >
                Limpar carrinho
              </button>
              <button
                className="buy-button cart-checkout-button"
                type="button"
                disabled={disabled || hasInvalidItems}
                onClick={finalizeOrder}
              >
                {checkoutState.phase === "SUBMITTING"
                  ? "Finalizando…"
                  : "Finalizar compra"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
