# Idempotência na criação de pedidos

O `POST /api/orders` exige o header `Idempotency-Key`. A coluna
`Order.idempotencyKey` possui uma restrição `UNIQUE` tanto no schema Prisma
quanto na migration inicial.

## Hash canônico

A API projeta cada item somente como `productId` normalizado em NFC e
`quantity`, ordena o array lexicograficamente por `productId`, serializa com
`JSON.stringify` e calcula SHA-256 com `node:crypto`. Propriedades extras e
produtos repetidos são rejeitados antes pelo `express-validator`. Dois
carrinhos com os mesmos produtos e quantidades em ordens diferentes geram o
mesmo hash.

## Fluxo

1. A validação HTTP confirma header e body.
2. O service calcula o `requestHash`.
3. Uma consulta rápida procura a chave já persistida.
4. Se a chave existe, o hash é comparado:
   - hash igual: o pedido atual é serializado, com HTTP 200 e
     `Idempotency-Replayed: true`;
   - hash diferente: a API retorna HTTP 409 `IDEMPOTENCY_CONFLICT`.
5. Se a chave ainda não existe, o repository repete a verificação dentro da
   mesma transação que decrementa todos os estoques e cria `Order`/`OrderItem`.
6. Somente o pedido completo efetivamente criado é enviado ao gateway do ERP.

## Corrida entre requisições

Duas requisições podem passar simultaneamente pela consulta inicial. A
restrição única do banco é a garantia definitiva: uma criação vence e a
outra recebe `P2002` do Prisma. A transação perdedora é revertida, incluindo
todos os seus decrementos e `OrderItem`; em seguida, o repository recupera por
`idempotencyKey` o pedido vencedor com os itens. O service compara o hash antes
de responder.

A garantia não depende de mutex em memória e continua válida com várias
instâncias da API apontando para o mesmo banco.

## Retry após timeout

Se o ERP continuar processando ao fim da janela síncrona, o pedido permanece
`PROCESSING` e a API retorna `202` com `orderId` e `statusUrl`. Se uma falha
temporária terminar dentro dessa janela, a API retorna `503`, também com esses
dados para acompanhamento. Um retry com a mesma chave recupera o pedido, não
decrementa estoque e não faz outro envio síncrono ao ERP. O cliente pode
consultar `GET /api/orders/:id`.

Pedidos em estado final, como `CONFIRMED`, também são apenas reproduzidos.
Pedidos não finais são retomados pelo worker local; retries HTTP apenas
reproduzem o estado existente e não fazem um novo envio síncrono ao ERP.

No front-end, a intenção guarda o payload normalizado junto com a chave. Apenas
adicionar, remover ou alterar quantidade invalida essa intenção. Fechar uma
mensagem, repetir após timeout ou falha temporária conserva chave e payload.

## Limitação do SQLite

O SQLite serializa escritas e é adequado para este mini-projeto, mas pode
reduzir throughput e produzir contenção sob carga alta. Em produção,
PostgreSQL oferece concorrência de escrita e mecanismos de lock mais
adequados; a restrição única e o update condicional continuam sendo as
garantias centrais.
