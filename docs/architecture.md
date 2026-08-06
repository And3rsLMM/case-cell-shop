# Arquitetura e sequência do checkout

## Arquitetura do mini-projeto

O Next.js é exclusivamente a camada de apresentação. Todas as validações HTTP,
regras de aplicação, idempotência, reserva de estoque e decisões sobre o ERP
permanecem na API Express.

```mermaid
flowchart LR
    U["Cliente"] --> W["Next.js App Router<br/>React + hooks próprios"]
    W --> CART["CartProvider + useCart"]
    W -->|"fetch nativo / HTTP"| M["Express<br/>requestId + CORS + JSON + logs"]

    subgraph API["API Express — fonte única das regras"]
        M --> V["express-validator"]
        V --> C["Controllers"]
        C --> S["Services"]
        S --> R["Repositories"]
        S --> P["OrderProcessor"]
        M --> H
        M --> Y
        H["GET /health"]
        Y["GET /ready"] --> Q["Readiness check"]
        K["Worker local"] --> P
    end

    R --> PR["Prisma Client"]
    Q --> PR
    PR --> DB[("SQLite")]
    P --> G["ErpGateway simulado"]
    G -. "adaptador futuro" .-> ERP["ERP monolítico<br/>fora do mini-projeto"]

    CT["packages/contracts<br/>contratos públicos"] -.-> W
    CT -.-> C
```

O worker em processo e o ERP simulado mantêm o mini-projeto autocontido. Em uma
evolução de produção, o contrato do gateway permite substituir a simulação por
um adaptador real, e o worker deve migrar para uma infraestrutura durável com
claim persistente. Essas substituições não exigem mover regras para o Next.js.

## Sequência do checkout

### Criação, idempotência e reserva

```mermaid
sequenceDiagram
    autonumber
    actor Cliente
    participant Web as Next.js
    participant API as Express / OrderService
    participant DB as Prisma / SQLite

    Cliente->>Web: Adiciona, edita ou remove itens do carrinho
    Cliente->>Web: Finaliza a compra
    Web->>API: POST /api/orders com chave e itens
    API->>API: Valida header e body
    API->>DB: Busca a Idempotency-Key

    alt Mesma chave e mesmo carrinho
        DB-->>API: Pedido existente
        API-->>Web: 200 com replay idempotente
    else Mesma chave e carrinho diferente
        DB-->>API: Chave associada a outro conteúdo
        API-->>Web: 409 IDEMPOTENCY_CONFLICT
    else Nova chave
        API->>DB: Reserva estoque e cria pedido em uma transação

        alt Falha em qualquer item
            DB-->>API: Desfaz toda a transação
            API-->>Web: 404 produto ou 409 estoque
            Note over Web,DB: Carrinho preservado sem pedido parcial
        else Todos os itens reservados
            DB-->>API: Pedido PENDING com itens e total
        end
    end
```

### Processamento e acompanhamento

```mermaid
sequenceDiagram
    autonumber
    participant Web as Next.js
    participant API as Express / OrderService
    participant Processor as OrderProcessor
    participant DB as Prisma / SQLite
    participant ERP as ErpGateway

    API->>Processor: Processa o pedido reservado
    Processor->>DB: Inicia tentativa e marca PROCESSING
    Processor->>ERP: Envia o pedido completo

    alt ERP confirma dentro da janela
        ERP-->>Processor: Sucesso
        Processor->>DB: Marca CONFIRMED
        Processor-->>API: Pedido confirmado
        API-->>Web: 201 CONFIRMED
        Web->>API: Atualiza o catálogo
        API-->>Web: Estoque atualizado
    else Processamento excede a janela
        API-->>Web: 202 com orderId e statusUrl
        Note over Processor,ERP: O processamento continua em segundo plano

        loop Até estado final ou limite de tempo
            Web->>API: Consulta GET /api/orders/:id
            API->>DB: Consulta o status
            DB-->>API: PROCESSING, CONFIRMED ou FAILED
            API-->>Web: 200 com o status atual
        end
    else ERP retorna falha temporária
        ERP-->>Processor: Falha temporária
        Processor->>DB: Mantém PROCESSING para nova tentativa
        Processor-->>API: Falha temporária
        API-->>Web: 503 com orderId e statusUrl
        Note over Web,API: Nova tentativa reutiliza a mesma Idempotency-Key
        Note over Processor,DB: O worker retoma o pedido até confirmar ou falhar
    end
```

Cada resposta inclui o header `X-Request-Id`, que permite localizar a requisição nos logs. Ao final do processamento, a API registra apenas informações úteis e previamente selecionadas, como `orderId`, `productId` na consulta de um produto, `itemCount`, `status`, `durationMs`, `errorCode` e se a resposta reutilizou um pedido existente. O conteúdo completo da requisição e dados sensíveis não são armazenados.
