# Prompts utilizados

Este arquivo registra uma amostra de dez prompts relevantes utilizados durante
o desenvolvimento do CaseCellShop.

Os textos foram condensados para retirar repetições e referências de contexto
já documentadas no README. Eles preservam a finalidade das solicitações
originais, mas não são uma transcrição integral do histórico.

A inteligência artificial foi utilizada como ferramenta de apoio para organizar
requisitos, comparar alternativas, revisar decisões técnicas, levantar cenários
de teste e auxiliar na documentação. As sugestões não foram consideradas
corretas automaticamente: cada decisão incorporada foi conferida no código, nas
restrições do desafio e nos testes.

## Stack definida

### Back-end

- Node.js;
- TypeScript;
- Express;
- express-validator;
- Prisma;
- SQLite.

### Front-end

- React;
- TypeScript;
- Next.js com App Router;
- `fetch` nativo;
- hooks próprios.

### Testes

- Jest;
- `fetch` nativo do Node.js para testes HTTP da API;
- React Testing Library;
- `@testing-library/user-event`.

---

## 1 — Revisão do planejamento inicial

**Prompt**

> Revise o planejamento técnico abaixo para o CaseCellShop sem substituir as
> decisões já definidas. Verifique se os requisitos funcionais e não funcionais,
> a arquitetura incremental, o modelo de domínio, os endpoints, os estados do
> pedido, a consistência de estoque, a idempotência, a simulação do ERP, os
> testes, os riscos e as limitações estão cobertos. Aponte lacunas, contradições
> ou complexidade desnecessária. Considere Express, express-validator, Prisma,
> SQLite, Next.js, fetch nativo, hooks próprios e Jest. Não escreva o código
> nesta etapa.

**Resultado**

- requisitos e critérios de aceite organizados por catálogo, checkout e
  acompanhamento do pedido;
- separação entre arquitetura do mini-projeto e evolução conceitual futura;
- identificação antecipada dos riscos de concorrência, idempotência e
  indisponibilidade do ERP;
- ordem incremental de implementação, sem propor a reescrita do ERP legado.

**Decisões**

- Express seria a única fonte das regras de negócio;
- Next.js permaneceria somente como aplicação de apresentação;
- autenticação, pagamento, cloud e integração real com ERP ficariam fora do
  escopo;
- microserviços e mensageria externa não seriam introduzidos no mini-projeto.

**Validação**

- planejamento confrontado com o enunciado e com as restrições obrigatórias;
- decisões consolidadas no README e nos documentos conceituais.

---

## 2 — Estrutura inicial e contratos do projeto

**Prompt**

> Crie a estrutura inicial do monorepo CaseCellShop com npm workspaces. Use
> apps/api para Express, apps/web para Next.js e packages/contracts para
> contratos públicos compartilhados. Configure TypeScript strict, scripts de
> desenvolvimento, build, lint, typecheck, testes, Prisma, migration e seed. Não
> implemente as regras de checkout ainda.

**Resultado**

- monorepo organizado com npm workspaces;
- API Express isolada em `apps/api`;
- aplicação Next.js isolada em `apps/web`;
- contratos públicos compartilhados em `packages/contracts`;
- scripts centralizados para desenvolvimento, build, testes, lint, typecheck e
  Prisma.

**Decisões**

- manter um único gerenciador de pacotes e comandos executados pela raiz;
- compartilhar somente contratos públicos, sem entidades Prisma;
- não adicionar Docker nesta etapa para diminuir complexidade;
- automatizar geração, migrations pendentes e seed antes da inicialização da
  API local.

**Validação**

- instalação e scripts executados a partir da raiz do repositório;
- typecheck e build realizados nos três workspaces.

---

## 3 — Modelagem de produtos e pedidos

**Prompt**

> Modele Product e Order com Prisma e SQLite. Use valores monetários em
> centavos, Idempotency-Key única, requestHash, estados do pedido, relacionamento
> entre pedido e produto, índices, migration e seed. Inclua um produto com uma
> única unidade para o teste de concorrência. Explique as limitações do SQLite e
> não retorne objetos Prisma diretamente pela API.

**Resultado**

- contratos TypeScript para produtos, pedidos, itens, estados e erros;
- modelos Prisma para `Product`, `Order`, `OrderItem` e claim de processamento;
- relacionamento de um pedido para vários itens;
- mappers explícitos entre persistência e respostas HTTP;
- migrations versionadas e seed local com cinco produtos.

O modelo originalmente solicitado para uma compra unitária foi posteriormente
evoluído para `Order` 1:N `OrderItem`, preservando idempotência, snapshots e
transação do carrinho completo.

**Decisões**

- valores monetários são inteiros em centavos;
- itens guardam snapshots de nome e preço para preservar o histórico;
- `Idempotency-Key` possui restrição única no banco;
- o seed local é deliberadamente destrutivo e não representa uma estratégia de
  produção.

**Validação**

- testes do pacote de contratos;
- testes dos contratos públicos e do repository de pedidos, com a serialização
  das respostas também verificada pelos testes HTTP;
- geração do Prisma Client e aplicação das migrations durante o fluxo local.

---

## 4 — API Express, validação e modelo de erros

**Prompt**

> Implemente a base da API com Express e TypeScript, separando app.ts de
> server.ts. Adicione requestId, logs estruturados, CORS, health checks,
> encerramento gracioso e middleware global de erros. Use express-validator para
> body, params, query e Idempotency-Key. Implemente GET /api/products, GET
> /api/products/:id, POST /api/orders e GET /api/orders/:id, com controllers
> pequenos, services, repositories e mappers.

**Resultado**

- `app.ts` cria a aplicação sem abrir porta e `server.ts` controla o servidor;
- requestId recebido ou gerado e devolvido no header;
- logs estruturados de conclusão e falha das requisições;
- middlewares globais de erro e rota inexistente;
- validadores separados para body, params, query e `Idempotency-Key`;
- endpoints `/health`, `/ready`, catálogo e pedidos.

**Decisões**

- controllers apenas traduzem HTTP e chamam services;
- repositories concentram o acesso ao Prisma;
- validação estrutural permanece separada das regras de aplicação;
- erros internos e stack traces não são expostos ao cliente.

**Validação**

- testes unitários dos validators e do middleware de validação;
- testes HTTP de health, readiness, catálogo, pedidos e formato dos erros;
- lint e TypeScript strict sem exceções para dados externos.

---

## 5 — Carrinho e estoque atômico

**Prompt**

> Implemente a movimentação de estoque de forma atômica. Duas requisições
> diferentes devem disputar a última unidade e somente uma pode ser aceita. Use
> uma atualização condicional com Prisma dentro de uma transação, verificando
> id, produto ativo e estoque maior ou igual à quantidade. Não faça leitura
> seguida de atualização baseada no valor lido e não use mutex em memória como
> garantia principal. Crie um teste concorrente com requisições HTTP reais.

**Resultado**

- reserva de todos os itens dentro da transação que cria o pedido;
- decremento condicional e atômico para cada produto;
- rollback integral quando qualquer item do carrinho falha;
- diferenciação entre produto inexistente e estoque insuficiente;
- teste concorrente sobre o produto que possui somente uma unidade no seed.

**Decisões**

- não executar leitura de estoque seguida de update baseado no valor lido;
- não usar mutex em memória como garantia principal;
- ordenar itens antes da reserva para manter execução determinística;
- nunca criar pedido parcial quando apenas parte do carrinho possui estoque.

**Validação**

- duas requisições HTTP reais disputam a última unidade;
- somente uma compra é aceita e a outra recebe `INSUFFICIENT_STOCK`;
- estoque final confirmado como zero e nunca negativo;
- o cenário da última unidade verifica a compra da quantidade exata, e o teste
  do carrinho confirma o rollback integral.

---

## 6 — Idempotência do checkout

**Prompt**

> Implemente idempotência no POST /api/orders. Exija o header Idempotency-Key,
> armazene a chave com restrição única e gere um requestHash canônico a partir de
> productId e quantity. Mesma chave e mesmo payload devem retornar o pedido
> existente sem reduzir o estoque novamente. Mesma chave e payload diferente
> devem retornar IDEMPOTENCY_CONFLICT. Trate também duas requisições simultâneas
> com a mesma chave.

**Resultado**

- hash SHA-256 de uma representação normalizada do carrinho;
- replay com HTTP 200 e header `Idempotency-Replayed: true`;
- conflito HTTP 409 quando uma chave é reutilizada com outro conteúdo;
- recuperação do pedido vencedor após violação concorrente da restrição única;
- estoque movimentado apenas uma vez.

**Decisões**

- a ordem recebida dos itens não altera o hash da mesma intenção;
- consulta prévia é apenas uma otimização, não a proteção principal;
- a restrição única do banco resolve a corrida entre requisições simultâneas;
- retry da mesma intenção conserva a chave, enquanto alteração do carrinho gera
  outra chave.

**Validação**

- testes de replay, conflito e requisições simultâneas;
- verificação do número de pedidos, itens e decrementos de estoque;
- confirmação de que o ERP não é chamado novamente para pedidos finais.

---

## 7 — ERP lento ou instável

**Prompt**

> Crie um ErpGateway simulado com modos de sucesso, lentidão e falha temporária.
> Permita comportamento determinístico nos testes, injete as funções de
> aleatoriedade e espera, registre duração e tentativas e permita que pedidos
> lentos fiquem em PROCESSING para consulta posterior. Crie um worker local
> simples, sem RabbitMQ, Kafka ou Redis.

**Resultado**

- gateway simulado com atraso, sucesso e falha temporária;
- resposta HTTP 202 quando a janela síncrona é ultrapassada;
- worker local para retomar pedidos processáveis;
- incremento persistente de tentativas e limite configurável;
- claim com lease e token para impedir transições concorrentes do mesmo pedido;
- devolução transacional do carrinho após falha definitiva.

**Decisões**

- aleatoriedade, espera e relógio são injetáveis nos testes;
- o estoque é reservado antes do ERP, mantido na confirmação e devolvido uma
  única vez após falha definitiva;
- respostas atrasadas são protegidas por fencing no banco;
- worker em processo e SQLite são simplificações locais, não uma solução
  distribuída de produção.

**Validação**

- testes determinísticos dos três modos do gateway;
- testes do worker, limite de tentativas e devolução única;
- teste de dois processadores e teste de resposta após expiração do lease;
- polling HTTP até estados finais.

---

## 8 — Front-end Next.js

**Prompt**

> Implemente o front-end com Next.js App Router, React e TypeScript consumindo
> exclusivamente a API Express. Use fetch nativo e hooks próprios para produtos,
> checkout e polling. Mostre loading, sucesso, validação, estoque insuficiente,
> processamento e falha temporária. Desabilite o botão durante o envio, preserve
> a quantidade após falha e reutilize a Idempotency-Key no retry da mesma
> intenção.

**Resultado**

- catálogo responsivo com controle explícito de quantidade;
- carrinho compartilhado, fixo durante a rolagem e sem sobrepor os produtos;
- `apiClient` com fetch nativo e validação das respostas externas;
- hooks `useProducts`, `useCheckout` e `useOrderPolling`;
- estados visíveis para loading, sucesso, processamento e falhas;
- atualização do catálogo após confirmação.

**Decisões**

- componentes visuais não chamam `fetch` diretamente;
- o botão permanece bloqueado durante o envio;
- falha temporária preserva carrinho e chave de idempotência;
- polling possui cancelamento, limite de tempo e encerramento em estado final;
- `AbortController` e guards de montagem evitam atualizações tardias.

**Validação**

- testes dos hooks sem depender de detalhes privados;
- testes visíveis dos componentes com React Testing Library e user-event;
- cenários de loading, duplo clique, retry, polling e acessibilidade.

---

## 9 — Estratégia de testes

**Prompt**

> Crie testes com Jest. No back-end, inicie o Express em uma porta temporária e
> use o fetch nativo do Node.js, sem Supertest. Cubra produtos, validação,
> pedidos, estoque, idempotência, concorrência, ERP e contrato de erros. No
> front-end, use React Testing Library e user-event para testar o comportamento
> percebido pelo usuário.

**Resultado**

- helper HTTP que abre o Express em `127.0.0.1` com porta aleatória;
- encerramento explícito de servidores e conexões de banco;
- bancos SQLite temporários e isolados nos testes de persistência;
- cobertura unitária de services, repository de pedidos, validators, gateway e
  worker;
- cobertura comportamental do front-end com mocks controlados do fetch.

**Decisões**

- não usar Supertest;
- testar a API pela interface HTTP real com o fetch nativo do Node.js;
- evitar testes limitados a nomes de funções privadas ou estado interno;
- manter ambientes Jest `node` na API e `jsdom` no front-end.

**Validação**

- `npm run lint` aprovado nos três workspaces;
- `npm run check` aprovado, incluindo typecheck, testes e build;
- 83 testes aprovados na verificação consolidada: 2 de contratos, 64 da API
  e 17 do front-end.

---

## 10 — Criação da documentação

**Prompt**

> Com base no código, nos testes e nas decisões técnicas existentes no
> repositório CaseCellShop, crie a documentação final da entrega. Gere um
> README.md simples e objetivo com visão geral, tecnologias, estrutura,
> instalação, execução, testes, endpoints, decisões técnicas, limitações e
> próximos passos. Atualize PROMPTS.md com somente os prompts mais relevantes,
> registrando sugestões aproveitadas, decisões do autor e formas reais de
> verificação. Não invente comandos, endpoints, testes, variáveis ou
> funcionalidades; confira os arquivos existentes antes de documentar.

**Resultado**

- README alinhado aos scripts e ao comportamento do seed;
- documentação conceitual de arquitetura, estoque, idempotência, ERP e
  observabilidade;
- diagramas Mermaid da arquitetura e da sequência de checkout;
- especificação OpenAPI 3.0 servida em `/openapi.json`;
- Swagger UI disponível em `/docs` com exemplos de catálogo, checkout, erros e
  cenários do ERP.

**Decisões**

- OpenAPI é somente documentação e não participa da validação em runtime;
- `express-validator` continua sendo a validação HTTP oficial;
- os exemplos usam produtos e respostas coerentes com o seed e os contratos;
- limitações do SQLite, do worker local e do seed destrutivo permanecem
  explícitas.

**Validação**

- teste HTTP verifica `/openapi.json`, enquanto `/docs` permanece disponível
  para a validação manual pelo Swagger UI;
- teste estrutural confirma endpoints, respostas, estados e referências locais;
- cenários documentados para sucesso, lentidão e falha temporária do ERP;
- README e documentos conferidos contra os arquivos executáveis do projeto.

---

## Sugestões avaliadas e não adotadas

As alternativas abaixo não são proibidas pelo desafio. Elas foram avaliadas e
descartadas para manter a entrega simples, local e proporcional ao mini-projeto.

| Alternativa considerada | Decisão adotada | Motivo |
| --- | --- | --- |
| NestJS ou Fastify | Express | Oferecer rotas, middlewares e tratamento de erros com menos abstrações para uma API pequena |
| Moleculer ou microsserviços | API modular única | Evitar transporte, descoberta de serviços e operação distribuída antes de existir essa necessidade |
| Zod, JSON Schema ou AJV | express-validator | Manter uma única estratégia de validação em runtime integrada às rotas Express |
| TanStack Query | fetch e hooks próprios | Manter explícito o ciclo das requisições |
| Axios | fetch nativo | Evitar dependência HTTP desnecessária |
| Supertest | fetch nativo do Node.js | Exercitar a API por HTTP real |
| Vitest | Jest | Usar um único executor nos workspaces e a integração existente com Next.js |
| PostgreSQL ou MySQL | SQLite | Aproveitar a permissão de banco local, sem instalar servidor ou fornecer credenciais |
| Docker | Execução direta com npm | API, web e SQLite não dependem de serviços externos nesta etapa |
| Redis | Banco transacional como fonte de verdade | Estoque e idempotência exigem persistência; cache adicionaria invalidação e risco de dados defasados |
| RabbitMQ ou Kafka | Worker local | Demonstrar processamento assíncrono sem introduzir broker e operação externa no mini-projeto |

---

## Responsabilidades do autor

Permaneceram sob responsabilidade do autor:

- interpretação final dos requisitos;
- escolha e aprovação da arquitetura;
- entendimento das regras de negócio;
- revisão do código gerado ou sugerido;
- execução e interpretação dos testes;
- validação da concorrência e da idempotência;
- correções finais;
- conferência da documentação;
- decisão sobre o conteúdo entregue.

---

## Riscos considerados no uso de IA

- sugestão de APIs ou configurações inexistentes;
- dependências incompatíveis;
- código que compila, mas não preserva a regra de negócio;
- race conditions difíceis de perceber em revisão superficial;
- idempotência ou compensação de estoque incompletas;
- testes que não reproduzem o cenário real;
- complexidade desnecessária;
- documentação divergente da implementação;
- aceitação de sugestões sem compreensão.

---

## Conclusão

As respostas da IA foram tratadas como hipóteses, checklists e rascunhos. Os
riscos foram reduzidos com versões controladas, TypeScript strict, lint, testes
unitários e HTTP, cenários concorrentes, builds dos workspaces e conferência da
documentação contra o repositório.

Uma sugestão só foi mantida quando respeitou as restrições do desafio,
permaneceu compatível com o código existente e passou pelas verificações
aplicáveis. A responsabilidade técnica final continuou sendo do autor.
