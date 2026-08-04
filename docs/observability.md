# Observabilidade e métricas futuras

## O que está implementado

Os logs da API são uma linha JSON por evento. Cada entrada possui
`timestamp`, `level`, `service` e `message`; os demais campos são adicionados
somente quando se aplicam ao evento.

| Evento | Campos relevantes |
| --- | --- |
| `http.request.completed` | `requestId`, método, rota, status HTTP, `durationMs`, `productId` em consulta unitária ou `orderId`/`itemCount` no pedido |
| `http.request.failed` | `requestId`, status HTTP, `errorCode`, `orderId`, `productId`, `itemCount` e status quando conhecidos |
| `erp.order.processed` | `requestId` quando originado no checkout, `orderId`, `itemCount`, `status`, `durationMs`, `processingAttempt` e `errorCode` em falhas |
| `order.processing.completed` | correlação do pedido, `itemCount`, status persistido, duração do ERP e tentativa |
| `order.worker.processed` | `orderId`, `itemCount`, status, tentativa e resultado do ciclo |

O middleware aceita um `X-Request-Id` com até 128 caracteres no conjunto
permitido ou gera `crypto.randomUUID()`. O identificador é devolvido no header
`X-Request-Id`. Durante o checkout síncrono, ele é propagado até o processador e
o gateway. Um retry iniciado posteriormente pelo worker não representa uma nova
requisição HTTP; nesse caso, `orderId` é a correlação durável principal.

O tempo HTTP é medido com relógio monotônico de alta resolução. O gateway mede
o processamento simulado e retorna `durationMs`, permitindo distinguir a
latência total do endpoint da duração atribuída ao ERP.

## Política de dados nos logs

Os contextos são allowlisted. Não são registrados:

- body completo, headers completos ou `Idempotency-Key`;
- descrição, preço ou dados arbitrários do produto;
- mensagens internas de bibliotecas, caminhos de banco ou stack traces;
- qualquer credencial, token, cookie ou informação de pagamento.

Erros inesperados são reduzidos ao tipo e, quando existir, a um código técnico.
A resposta HTTP sempre usa o contrato público de erro e nunca inclui stack
trace ou a causa interna.

## Endpoints operacionais

- `GET /health`: verifica apenas que o processo HTTP está vivo e retorna `200`.
- `GET /ready`: executa `SELECT 1` pelo Prisma a cada consulta. Retorna `200`
  quando a dependência está disponível ou `503 SERVICE_NOT_READY` com erro
  público seguro.
- `GET /api/orders/:id`: fornece o status necessário ao polling e retorna
  `404 ORDER_NOT_FOUND` para um identificador inexistente.

## Métricas futuras

O mini-projeto ainda não expõe Prometheus, OpenTelemetry ou um serviço externo.
Os eventos estruturados deixam as dimensões necessárias para uma evolução
incremental.

| Métrica | Tipo sugerido | Fonte e cálculo futuro |
| --- | --- | --- |
| Latência da vitrine | Histograma | `durationMs` de `GET /api/products`, complementado por Web Vitals no Next.js |
| Tempo do checkout | Histograma | `durationMs` de `POST /api/orders`, separado por status HTTP e status do pedido |
| Taxa de erros | Contador e razão | `http.request.failed` por rota e `errorCode` dividido pelo total de requisições |
| Falhas do ERP | Contador | eventos ERP com `errorCode`, agrupados por tentativa e resultado |
| Pedidos em processamento | Gauge | contagem persistida de pedidos `PENDING` e `PROCESSING` |
| Conflitos de estoque | Contador | respostas/logs com `errorCode = INSUFFICIENT_STOCK` |
| Replays idempotentes | Contador | `http.request.completed` com `idempotencyReplayed = true` |
| Tempo médio até confirmação | Histograma ou summary | diferença entre `Order.createdAt` e a transição persistida para `CONFIRMED` |

Em produção, as métricas devem usar cardinalidade controlada: `orderId`,
`productId` e `requestId` permanecem em logs/traces, mas não devem virar labels
de métricas. Labels adequados seriam rota normalizada, método, status HTTP,
status do pedido e `errorCode` conhecido.

## Alertas futuros

- aumento sustentado de `p95`/`p99` no catálogo ou checkout;
- crescimento da taxa de `5xx` ou de falhas temporárias do ERP;
- pedidos `PROCESSING` acima do limite de idade esperado;
- aumento anormal de conflitos de estoque ou replays idempotentes;
- readiness indisponível por mais de uma janela curta.
