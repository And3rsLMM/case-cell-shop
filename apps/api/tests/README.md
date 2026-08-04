# Testes do back-end

A suíte usa Jest com `testEnvironment: "node"` e o `fetch` nativo do Node.js.
Não há Supertest: os testes HTTP sobem a aplicação Express em um servidor real,
vinculado exclusivamente a `127.0.0.1` e a uma porta efêmera escolhida pelo
sistema operacional (`port: 0`).

## Servidor HTTP isolado

`helpers/http-test-server.ts` recebe a aplicação Express, cria um
`node:http.Server`, aguarda o evento `listening`, lê a porta atribuída e devolve
`baseUrl` e `close()`. O encerramento é idempotente, fecha conexões ociosas e
ativas e propaga erros tanto da inicialização quanto do shutdown.

## SQLite, migrations e limpeza

`helpers/test-database.ts` cria um diretório temporário exclusivo no diretório
temporário do sistema e instancia um `PrismaClient` apontando para esse arquivo.
As migrations reais de `prisma/migrations`, em ordem lexical, são lidas e
executadas nesse banco. Assim, o teste concorrente não replica manualmente o
schema e falha se uma migration necessária não puder ser aplicada.

Antes de cada cenário integrado, pedidos são excluídos antes dos produtos para
respeitar a chave estrangeira, e os fixtures necessários são recriados. No fim
da suíte, o Prisma é desconectado e o diretório temporário é removido mesmo
quando há erro; falhas de desconexão ou remoção são propagadas como
`AggregateError`.

## Bônus verificados

- `health.test.ts` cobre `GET /health`, `GET /ready`, propagação de
  `X-Request-Id` e respostas sem stack trace.
- `orders.http.test.ts` cobre `GET /api/orders/:id` e a correlação dos logs HTTP
  com pedido, quantidade de itens, status e erro.
- `orders.concurrent.http.test.ts` dispara duas compras reais da última unidade,
  confirma uma aceitação, uma rejeição e estoque final zero.
- `logger.test.ts`, `erp.gateway.test.ts` e
  `order-processor.service.test.ts` cobrem JSON estruturado, duração,
  `processingAttempt`, `errorCode` e sanitização de erros.

## Execução

Na raiz do monorepo:

```bash
npm test --workspace @case-cell-shop/api
```

Para tipos, testes e build de todos os workspaces:

```bash
npm run check
```
