import type { CheckoutState } from "@/hooks/useCheckout";
import { formatPrice } from "@/lib/formatters";

interface CheckoutStatusProps {
  onReset(): void;
  onResumePolling(): void;
  onRetry(): void;
  onRetryAsNewIntent(): void;
  state: CheckoutState;
}

function shortOrderId(orderId: string): string {
  return orderId.length > 12 ? `${orderId.slice(0, 12)}…` : orderId;
}

export function CheckoutStatus({
  onReset,
  onResumePolling,
  onRetry,
  onRetryAsNewIntent,
  state
}: CheckoutStatusProps) {
  if (state.phase === "IDLE") {
    return null;
  }

  const isError = [
    "FAILED",
    "IDEMPOTENCY_CONFLICT",
    "PRODUCT_UNAVAILABLE",
    "STOCK_REJECTED",
    "TEMPORARY_FAILURE",
    "UNEXPECTED_ERROR"
  ].includes(state.phase);

  return (
    <aside
      className={`checkout-status checkout-status--${state.phase.toLowerCase()}`}
      aria-atomic="true"
      aria-live={isError ? "assertive" : "polite"}
      role={isError ? "alert" : "status"}
    >
      <div className="checkout-status__icon" aria-hidden="true">
        {state.phase === "CONFIRMED"
          ? "✓"
          : state.phase === "SUBMITTING" || state.phase === "PROCESSING"
            ? "↻"
            : "!"}
      </div>

      <div className="checkout-status__content">
        {state.phase === "SUBMITTING" && (
          <>
            <h2>Enviando seu pedido</h2>
            <p>
              Reservando {state.items.length} produto
              {state.items.length === 1 ? "" : "s"} em uma única operação.
            </p>
          </>
        )}

        {state.phase === "PROCESSING" && (
          <>
            <h2>Pedido em processamento</h2>
            <p>
              O ERP ainda está trabalhando. A situação será atualizada
              automaticamente.
            </p>
            <small>Pedido {shortOrderId(state.orderId)}</small>
          </>
        )}

        {state.phase === "CONFIRMED" && (
          <>
            <h2>Pedido confirmado!</h2>
            <p>
              {state.order.items.length} produto
              {state.order.items.length === 1 ? "" : "s"}, total de{" "}
              {formatPrice(state.order.totalPriceInCents)}.
            </p>
            <ul className="checkout-items-summary">
              {state.order.items.map((item) => (
                <li key={item.productId}>
                  {item.quantity}× {item.name} — {formatPrice(item.subtotalInCents)}
                </li>
              ))}
            </ul>
            {state.replayed && (
              <small>Resposta recuperada com segurança pela idempotência.</small>
            )}
            <button className="status-action" type="button" onClick={onReset}>
              Continuar comprando
            </button>
          </>
        )}

        {state.phase === "STOCK_REJECTED" && (
          <>
            <h2>Estoque insuficiente</h2>
            <p>{state.message} Os itens afetados estão destacados no carrinho.</p>
            <button className="status-action" type="button" onClick={onReset}>
              Ajustar carrinho
            </button>
          </>
        )}

        {state.phase === "PRODUCT_UNAVAILABLE" && (
          <>
            <h2>Produto indisponível</h2>
            <p>{state.message} Remova os itens destacados para continuar.</p>
            <button className="status-action" type="button" onClick={onReset}>
              Ajustar carrinho
            </button>
          </>
        )}

        {state.phase === "TEMPORARY_FAILURE" && (
          <>
            <h2>Falha temporária no ERP</h2>
            <p>
              {state.message} Ao tentar novamente, usaremos a mesma chave para
              não reservar o estoque duas vezes.
            </p>
            {state.orderId !== undefined && (
              <small>O pedido continua sendo consultado em segundo plano.</small>
            )}
            <button className="status-action" type="button" onClick={onRetry}>
              Tentar novamente
            </button>
          </>
        )}

        {state.phase === "IDEMPOTENCY_CONFLICT" && (
          <>
            <h2>Conflito de tentativa</h2>
            <p>{state.message}</p>
            <button
              className="status-action"
              type="button"
              onClick={onRetryAsNewIntent}
            >
              Criar nova tentativa
            </button>
          </>
        )}

        {state.phase === "FAILED" && (
          <>
            <h2>Pedido não confirmado</h2>
            <p>{state.message} O estoque reservado foi liberado pela API.</p>
            <button className="status-action" type="button" onClick={onReset}>
              Voltar ao carrinho
            </button>
          </>
        )}

        {state.phase === "UNEXPECTED_ERROR" && (
          <>
            <h2>Não foi possível concluir</h2>
            <p>{state.message}</p>
            {state.retryable ? (
              <button className="status-action" type="button" onClick={onRetry}>
                Tentar novamente
              </button>
            ) : (
              <button className="status-action" type="button" onClick={onReset}>
                Voltar ao carrinho
              </button>
            )}
          </>
        )}

        {state.phase === "POLLING_TIMEOUT" && (
          <>
            <h2>O pedido ainda está em andamento</h2>
            <p>
              A consulta automática atingiu o limite de tempo, mas isso não
              significa que o pedido falhou.
            </p>
            <small>Pedido {shortOrderId(state.orderId)}</small>
            <button
              className="status-action"
              type="button"
              onClick={onResumePolling}
            >
              Consultar novamente
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
