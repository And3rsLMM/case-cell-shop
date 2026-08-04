# Concorrência e movimentação de estoque

## Garantia atômica

A reserva não usa o padrão de ler todos os estoques, calcular novos valores na
aplicação e depois gravá-los. O repositório ordena os itens por `productId` e,
para cada um, executa diretamente um `updateMany` condicional dentro da mesma
transação que cria `Order` e todos os `OrderItem`:

- `id` deve corresponder ao produto solicitado;
- `active` deve ser `true`;
- `stock` deve ser maior ou igual à quantidade;
- o valor é alterado com o decremento atômico do Prisma.

O banco decide qual concorrente atende à condição. Depois do comando, a
aplicação verifica `result.count`:

- `1`: a reserva do item foi obtida e o fluxo segue para o próximo item;
- `0`: o produto ativo é consultado apenas para distinguir produto inexistente
  de estoque insuficiente. A transação lança uma rejeição de domínio e é
  revertida; nenhum pedido `STOCK_REJECTED` parcial é persistido.

Somente depois de reservar todos os itens o repositório calcula subtotais e
total com preços atuais do banco e persiste o pedido. Se o item N falhar, os
decrementos dos itens 1 até N−1 são revertidos automaticamente. As constraints
`CHECK` da migration oferecem uma segunda barreira para estoque, quantidade e
valores inválidos.

## Múltiplas instâncias

A reserva de estoque não depende de mutex em memória. Todas as instâncias
disputam a mesma atualização condicional no banco, portanto um mutex local não
é necessário para essa garantia. Com uma unidade disponível em um produto
compartilhado, somente um carrinho consegue alterar a linha de `stock = 1` para
`stock = 0`; o outro encontra `stock < quantity`, recebe `count = 0`, reverte
seus demais itens e retorna `INSUFFICIENT_STOCK`.

A criação do pedido, seus itens e todos os decrementos pertencem à mesma
transação. Se qualquer reserva ou criação falhar, tudo é revertido.

## Limitações do SQLite

SQLite admite múltiplos leitores, mas serializa escritores. Isso preserva a
correção da atualização condicional, porém reduz o throughput sob muitas compras
simultâneas. Em contenção elevada, uma operação também pode falhar com
`SQLITE_BUSY`, dependendo do timeout e do modo de journal configurados.

Os testes isolados usam WAL e `busy_timeout` para reduzir flutuações. Isso não
transforma SQLite em banco adequado para alta concorrência ou múltiplas
máquinas. Em PostgreSQL, a ordem determinística ajuda a reduzir deadlocks; ainda
seriam necessários pool, timeout, nível de isolamento e retry de conflitos
transitórios, mantendo o mesmo predicado atômico em cada `UPDATE` e uma única
transação para o carrinho.
