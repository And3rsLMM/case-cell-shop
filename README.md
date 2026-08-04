# CaseCellShop

Projeto desenvolvido para o desafio técnico Fullstack Pleno. A proposta é
apresentar uma solução executável para catálogo, carrinho e checkout, além de
planejar a evolução gradual de uma loja integrada a um sistema legado.

## Contexto do desafio

A CaseCellShop vende capinhas para celular e consulta produtos, preços e
estoque diretamente em um ERP monolítico com MySQL. Com o crescimento de
milhares para milhões de acessos, a vitrine ficou lenta, compras passaram a
disputar o mesmo estoque e o checkout começou a sofrer timeout durante o
processamento de pedidos e faturamento.

Como o ERP não pode ser alterado, o desafio é reduzir essa dependência de forma
incremental, manter o estoque consistente e permitir que pedidos lentos sejam
acompanhados sem reescrever o sistema existente.

## Entrega

- [Respostas conceituais](docs/RESPOSTAS-CONCEITUAIS.md): as seis perguntas da
  Parte 1.A do desafio.
- [Prompts utilizados](PROMPTS.md): principais usos de IA, critérios de revisão
  e responsabilidades do autor.
- [Documentação técnica](docs/README.md): arquitetura, estoque, idempotência,
  ERP e observabilidade.

## O que foi implementado

- catálogo de produtos ativos com preço e estoque disponível;
- carrinho multi-item e checkout único;
- validação de body, params, query e headers com `express-validator`;
- reserva atômica e transacional, sem pedido parcial ou estoque negativo;
- idempotência persistente por `Idempotency-Key`;
- ERP simulado com sucesso, lentidão e falha temporária;
- processamento local assíncrono com tentativas, claim, lease e fencing token;
- polling de pedidos em processamento;
- loading, prevenção de múltiplos cliques, retry coerente e mensagens
  acessíveis;
- logs estruturados, `requestId`, endpoints operacionais e OpenAPI.

## Stack e organização

O monorepo usa npm workspaces e TypeScript strict.

```text
case-cell-shop/
  apps/
    api/                 # Express, Prisma, SQLite, ERP e worker
    web/                 # Next.js App Router e React
  packages/
    contracts/           # contratos públicos compartilhados
  docs/                  # decisões e respostas conceituais
  README.md
  PROMPTS.md
```

| Camada | Tecnologias |
| --- | --- |
| API | Node.js, TypeScript, Express e `express-validator` |
| Persistência | Prisma e SQLite |
| Web | Next.js App Router, React, `fetch` nativo e hooks próprios |
| Testes | Jest, `fetch` HTTP real, React Testing Library e `user-event` |

O Next.js é somente a aplicação de apresentação. Rotas HTTP, persistência e
regras de negócio permanecem na API Express.

## Como executar

### Pré-requisitos

- Node.js 20.9 ou superior;
- npm 10 ou superior;
- portas `3000` e `3333` disponíveis.

Na raiz do monorepo:

1. Instale as dependências:

   ```bash
   npm install
   ```

2. Crie o arquivo de ambiente.

   WSL ou Linux:

   ```bash
   cp .env.example .env
   ```

   Windows PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Inicie API e front-end:

   ```bash
   npm run dev
   ```

4. Acesse:

   - aplicação: `http://localhost:3000`;
   - API: `http://localhost:3333`;
   - Swagger UI: `http://localhost:3333/docs`;
   - OpenAPI: `http://localhost:3333/openapi.json`;
   - health: `http://localhost:3333/health`;
   - readiness: `http://localhost:3333/ready`.

Use `Ctrl+C` para encerrar os processos.

### Preparação automática do banco

Antes de iniciar a API, o script `predev`:

1. gera o Prisma Client;
2. aplica as migrations pendentes;
3. executa o seed.

O seed é deliberadamente destrutivo no ambiente local: remove pedidos, restaura
os cinco produtos e reinicia seus estoques. Isso ocorre ao executar novamente
`npm run dev` ou `npm run dev:api`, e não a cada hot reload. Essa estratégia é
somente para demonstração e não deve ser usada em produção.

Para executar os processos separadamente:

```bash
npm run dev:api
npm run dev:web
```

Somente `dev:api` prepara e reinicia o banco.

### Scripts principais

| Comando | Finalidade |
| --- | --- |
| `npm run dev` | Inicia API e web |
| `npm run dev:api` | Prepara o banco e inicia somente a API |
| `npm run dev:web` | Inicia somente o Next.js |
| `npm test` | Executa todos os testes |
| `npm run typecheck` | Verifica os tipos |
| `npm run lint` | Executa ESLint nos workspaces |
| `npm run build` | Gera os builds de produção |
| `npm run check` | Executa typecheck, testes e build |
| `npm run prisma:setup` | Gera o Client, aplica migrations e executa o seed destrutivo |

Os comandos Prisma individuais permanecem disponíveis para manutenção:

```bash
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:seed
npm run prisma:migrate -- --name nome-da-migration
```

### Variáveis de ambiente

Os valores de `.env.example` funcionam localmente.

| Nome | Padrão ou exemplo | Uso |
| --- | --- | --- |
| `API_PORT` | `3333` | Porta da API |
| `WEB_ORIGIN` | `http://localhost:3000` | Origem permitida pelo CORS |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:3333` | API acessada pelo navegador |
| `DATABASE_URL` | `file:./dev.db` | Arquivo SQLite |
| `JSON_BODY_LIMIT` | `32kb` | Limite do body JSON |
| `ORDER_MAX_DISTINCT_ITEMS` | `20` | Máximo de produtos distintos por pedido |
| `ERP_SIMULATION_MODE` | `automatic` | `automatic`, `success`, `slow` ou `temporary-failure` |
| `ERP_MIN_DELAY_MS` / `ERP_MAX_DELAY_MS` | `50` / `150` | Intervalo de atraso simulado |
| `ERP_FAILURE_RATE` | `0` | Probabilidade de falha no modo automático |
| `ERP_SYNC_TIMEOUT_MS` | `200` | Janela antes da resposta `202` |
| `ERP_MAX_ATTEMPTS` | `3` | Limite de tentativas |
| `ERP_PROCESSING_LEASE_MS` | `30000` | Validade do claim de processamento |

## API e Swagger

| Método | Endpoint | Finalidade |
| --- | --- | --- |
| `GET` | `/health` | Verifica o processo HTTP |
| `GET` | `/ready` | Verifica API e banco |
| `GET` | `/api/products` | Lista produtos ativos |
| `GET` | `/api/products/:id` | Consulta um produto ativo |
| `POST` | `/api/orders` | Cria ou reproduz uma compra |
| `GET` | `/api/orders/:id` | Consulta o status do pedido |

Exemplo de checkout:

```bash
curl -X POST http://localhost:3333/api/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: checkout-example-001" \
  -d "{\"items\":[{\"productId\":\"case-clear-iphone-15\",\"quantity\":2},{\"productId\":\"case-armor-galaxy-s24\",\"quantity\":1}]}"
```

O Swagger UI contém exemplos de validação, produto inexistente, estoque
insuficiente, replay, conflito de idempotência, última unidade e ERP.

| Cenário | Configuração | Resultado principal |
| --- | --- | --- |
| Sucesso | `ERP_SIMULATION_MODE=success` | `201 CONFIRMED` |
| Lentidão | `ERP_SIMULATION_MODE=slow` | `202 PROCESSING`, seguido de polling |
| Falha temporária | `ERP_SIMULATION_MODE=temporary-failure` | `503` inicial; worker tenta até `FAILED` |

Para trocar o cenário, altere `.env`, reinicie `npm run dev:api` e use uma nova
`Idempotency-Key`. A reinicialização também executa o seed destrutivo. O OpenAPI
é apenas documentação: validação e regras continuam no Express.

Erros seguem o mesmo envelope:

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Não há estoque suficiente para um ou mais produtos.",
    "details": {},
    "retryable": false,
    "requestId": "request-id"
  }
}
```

## Decisões técnicas principais

### Stack e infraestrutura

**Node.js e TypeScript.** Adotamos a stack preferencial do desafio e adequada a
uma API orientada a I/O. O TypeScript strict reduz ambiguidades e permite
compartilhar contratos públicos, enquanto `express-validator` mantém a
validação dos dados externos em runtime.

**Express em vez de NestJS ou Moleculer.** Express oferece rotas, middlewares e
tratamento de erros com poucas abstrações e injeção de dependências simples.
NestJS adicionaria módulos e decorators; Moleculer, conceitos de microserviços
que não são necessários para o escopo atual.

**SQLite em vez de MySQL.** Como o desafio aceita banco local, SQLite mantém a
execução autocontida e facilita migrations e bancos isolados nos testes. Usar
MySQL exigiria instalar e configurar um servidor externo sem necessidade para
este mini-projeto. Em produção, migraríamos para PostgreSQL ou MySQL devido à
escala de escrita.

**Sem Docker.** API, front-end e SQLite executam com Node.js, npm e
`npm run dev`, sem serviços externos. Docker acrescentaria configuração sem
resolver uma necessidade atual, mas poderia padronizar CI, homologação e deploy
em uma evolução da solução.

**Sem Redis.** Estoque e idempotência dependem de transações e restrições no
banco, não de cache. Redis adicionaria operação e risco de dados defasados sem
benefício necessário ao mini-projeto; futuramente, poderia acelerar o catálogo,
aplicar rate limiting ou apoiar coordenação distribuída.

### Estoque

Dentro de uma única transação, a API ordena os itens e executa `updateMany`
condicional com `stock >= quantity` e decremento atômico. Se qualquer item
falhar, todo o carrinho sofre rollback e nenhum pedido parcial é criado. Uma
restrição `CHECK` oferece defesa adicional contra estoque negativo.

### Idempotência

`Idempotency-Key` é única no banco e associada ao SHA-256 do carrinho
normalizado. Mesma chave e payload recuperam o pedido sem novo decremento ou
chamada desnecessária ao ERP; payload diferente retorna
`IDEMPOTENCY_CONFLICT`. O navegador conserva a chave em retry da mesma intenção
e cria outra após uma alteração real do carrinho.

### ERP e processamento

O estoque é reservado antes do ERP. Se o processamento ultrapassar a janela
síncrona, a API retorna `202` e o pedido pode ser consultado. Falhas temporárias
mantêm o pedido processável; ao esgotar as tentativas, ele passa a `FAILED` e o
estoque é devolvido uma única vez. Claim, lease e fencing token evitam que dois
processadores apliquem a mesma transição no banco.

## Testes

```bash
npm test
npm run lint
npm run check
```

A suíte enxuta possui 83 testes, concentrados nos requisitos e riscos centrais:

| Workspace | Testes |
| --- | ---: |
| Contratos | 2 |
| API | 64 |
| Web | 17 |

A API é exercitada por HTTP real com `fetch` nativo, servidor em porta efêmera
e SQLite isolado. A suíte prioriza validação, contratos, concorrência da última
unidade, rollback, idempotência simultânea, ERP, polling e devolução única. Os
casos redundantes entre testes unitários e HTTP foram removidos.

## Limitações e evolução

Limitações assumidas nesta entrega:

- SQLite possui concorrência de escrita limitada;
- worker e ERP simulado executam no processo da API;
- não há fila durável, sincronização real ou reconciliação com o ERP;
- o lease não é renovado durante chamadas muito longas;
- não há autenticação, pagamento, deploy em cloud ou carrinho persistido;
- o total exibido pelo navegador é informativo; a API é a fonte de verdade.

Para produção, os próximos passos são PostgreSQL, catálogo sincronizado e
cacheado, outbox/fila durável, workers independentes, ERP idempotente por
`orderId`, reconciliação, métricas, traces e testes de carga e falhas.

## Uso de IA

A IA apoiou planejamento, implementação, testes e revisão. Sugestões foram
conferidas contra o enunciado, o código e os resultados reais de typecheck,
lint, testes e build. As decisões finais e a responsabilidade pela entrega
permanecem com o autor; os principais registros estão em [PROMPTS.md](PROMPTS.md).
