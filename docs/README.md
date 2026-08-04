# Documentação

Este diretório reúne decisões técnicas e limitações do mini-projeto.

## Entrega conceitual

- [Respostas conceituais — Parte 1.A](RESPOSTAS-CONCEITUAIS.md)

## Decisões implementadas

- [OpenAPI interativo e cenários manuais da API](../apps/api/src/openapi/openapi.document.ts)
- [Concorrência e movimentação atômica de estoque](stock-concurrency.md)
- [Idempotência na criação de pedidos](idempotency.md)
- [Processamento simulado do ERP, claim persistente e worker local](erp-processing.md)
- [Arquitetura e sequência do checkout](architecture.md)
- [Observabilidade e métricas futuras](observability.md)

## Limites atuais

- A API Express é o único back-end.
- O Next.js não possui API Routes, Route Handlers ou Server Actions de negócio.
- O banco está configurado como SQLite por meio do Prisma.
- A integração com o ERP é simulada por um gateway injetável.
- A documentação OpenAPI é descritiva e não substitui o `express-validator`.
- O worker roda em processo e não substitui uma fila durável de produção.
