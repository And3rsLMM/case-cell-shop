import type { ChangeEvent, FormEvent } from "react";

import type { Product } from "@case-cell-shop/contracts";

import { formatPrice } from "@/lib/formatters";

interface ProductCardProps {
  disabled: boolean;
  onAdd(productId: string): void;
  onQuantityChange(productId: string, value: string): void;
  product: Product;
  quantity: string;
  quantityError: string | null;
}

export function ProductCard({
  disabled,
  onAdd,
  onQuantityChange,
  product,
  quantity,
  quantityError
}: ProductCardProps) {
  const inStock = product.availableQuantity > 0;
  const inputId = `quantity-${product.id}`;
  const errorId = `${inputId}-error`;
  const stockId = `${inputId}-stock`;
  const parsedQuantity = Number(quantity);
  const hasValidQuantity =
    /^[1-9]\d*$/.test(quantity) && Number.isSafeInteger(parsedQuantity);
  const canDecrease =
    inStock && !disabled && hasValidQuantity && parsedQuantity > 1;
  const canIncrease =
    inStock &&
    !disabled &&
    (!hasValidQuantity || parsedQuantity < product.availableQuantity);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onAdd(product.id);
  }

  function handleQuantityChange(event: ChangeEvent<HTMLInputElement>): void {
    onQuantityChange(product.id, event.target.value);
  }

  function adjustQuantity(change: -1 | 1): void {
    const currentQuantity = hasValidQuantity ? parsedQuantity : 1;
    const nextQuantity = Math.min(
      product.availableQuantity,
      Math.max(1, currentQuantity + change)
    );

    onQuantityChange(product.id, String(nextQuantity));
  }

  return (
    <article className="product-card">
      <div className="product-visual" aria-hidden="true">
        <div className="case-shape">
          <span>{product.name.slice(0, 1).toUpperCase()}</span>
        </div>
        <span className="visual-orbit visual-orbit--one" />
        <span className="visual-orbit visual-orbit--two" />
      </div>

      <div className="product-content">
        <div className="product-heading">
          <div>
            <p className="product-kicker">Capinha premium</p>
            <h2>{product.name}</h2>
          </div>
          <span
            className={`stock-badge ${inStock ? "" : "stock-badge--empty"}`}
          >
            {inStock ? `${product.availableQuantity} em estoque` : "Sem estoque"}
          </span>
        </div>

        <p className="product-description">{product.description}</p>

        <div className="product-purchase">
          <div>
            <span className="price-label">Preço</span>
            <strong className="product-price">
              {formatPrice(product.priceInCents)}
            </strong>
          </div>

          <form className="buy-form" onSubmit={handleSubmit} noValidate>
            <div className="quantity-field">
              <label htmlFor={inputId}>Quantidade</label>
              <div className="quantity-stepper">
                <button
                  type="button"
                  disabled={!canDecrease}
                  aria-label={`Diminuir quantidade de ${product.name}`}
                  onClick={() => adjustQuantity(-1)}
                >
                  -
                </button>
                <input
                  id={inputId}
                  name="quantity"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={quantity}
                  onChange={handleQuantityChange}
                  disabled={!inStock || disabled}
                  aria-describedby={quantityError ? errorId : stockId}
                  aria-invalid={quantityError !== null}
                />
                <button
                  type="button"
                  disabled={!canIncrease}
                  aria-label={`Aumentar quantidade de ${product.name}`}
                  onClick={() => adjustQuantity(1)}
                >
                  +
                </button>
              </div>
              <span id={stockId} className="sr-only">
                Estoque disponível: {product.availableQuantity}.
              </span>
            </div>

            <button
              className="buy-button"
              type="submit"
              disabled={!inStock || disabled}
            >
              {inStock ? "Adicionar ao carrinho" : "Indisponível"}
            </button>
          </form>
        </div>

        {quantityError !== null && (
          <p id={errorId} className="field-error" role="alert">
            {quantityError}
          </p>
        )}
      </div>
    </article>
  );
}
