import {
  Prisma,
  type PrismaClient,
  type Product as ProductRecord
} from "@prisma/client";

import { createPrismaOrderRepository } from "../src/repositories/order.repository";
import { createOrderRecord } from "./helpers/order-fixture";

const createdAt = new Date("2026-08-02T12:00:00.000Z");
const updatedAt = new Date("2026-08-02T12:01:00.000Z");

const productRecord: ProductRecord = {
  id: "product-1",
  name: "Capinha",
  description: "Descrição",
  priceInCents: 3_990,
  stock: 1,
  active: true,
  createdAt,
  updatedAt
};

const pendingOrder = createOrderRecord({
  requestHash: "request-hash"
});

const attemptInput = {
  idempotencyKey: "order-key-123",
  items: [{ productId: productRecord.id, quantity: 1 }],
  requestHash: "request-hash"
};

describe("Prisma order repository", () => {
  const orderFindUnique = jest.fn();
  const orderFindMany = jest.fn();
  const orderCreate = jest.fn();
  const orderUpdateMany = jest.fn();
  const processingClaimCreate = jest.fn();
  const processingClaimDeleteMany = jest.fn();
  const processingClaimFindUnique = jest.fn();
  const processingClaimUpdateMany = jest.fn();
  const productFindFirst = jest.fn();
  const productFindUnique = jest.fn();
  const productUpdate = jest.fn();
  const productUpdateMany = jest.fn();
  const transactionClient = {
    order: {
      create: orderCreate,
      findUnique: orderFindUnique,
      updateMany: orderUpdateMany
    },
    orderProcessingClaim: {
      create: processingClaimCreate,
      deleteMany: processingClaimDeleteMany,
      findUnique: processingClaimFindUnique,
      updateMany: processingClaimUpdateMany
    },
    product: {
      findFirst: productFindFirst,
      findUnique: productFindUnique,
      update: productUpdate,
      updateMany: productUpdateMany
    }
  } as unknown as Prisma.TransactionClient;
  const runTransaction = jest.fn(
    (operation: (transaction: Prisma.TransactionClient) => Promise<unknown>) =>
      operation(transactionClient)
  );
  const prismaClient = {
    $transaction: runTransaction,
    order: {
      findMany: orderFindMany,
      findUnique: orderFindUnique,
      updateMany: orderUpdateMany
    }
  } as unknown as PrismaClient;
  const repository = createPrismaOrderRepository(
    prismaClient,
    () => new Date("2026-08-03T12:00:00.000Z")
  );

  beforeEach(() => {
    jest.clearAllMocks();
    orderFindUnique.mockResolvedValue(null);
    orderCreate.mockResolvedValue(pendingOrder);
    orderFindMany.mockResolvedValue([]);
    orderUpdateMany.mockResolvedValue({ count: 1 });
    processingClaimCreate.mockResolvedValue({
      orderId: "order-1",
      token: "claim-1",
      leaseUntil: new Date("2026-08-03T12:01:00.000Z")
    });
    processingClaimDeleteMany.mockResolvedValue({ count: 1 });
    processingClaimFindUnique.mockResolvedValue(null);
    processingClaimUpdateMany.mockResolvedValue({ count: 1 });
    productFindFirst.mockResolvedValue(productRecord);
    productFindUnique.mockResolvedValue({ active: true, stock: 0 });
    productUpdate.mockResolvedValue(productRecord);
    productUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("reserva condicionalmente e cria o pedido com snapshot do item", async () => {
    const result = await repository.createAttempt(attemptInput);

    expect(productUpdateMany).toHaveBeenCalledWith({
      where: {
        id: productRecord.id,
        active: true,
        stock: { gte: 1 }
      },
      data: { stock: { decrement: 1 } }
    });
    expect(orderCreate).toHaveBeenCalledWith({
      data: {
        idempotencyKey: attemptInput.idempotencyKey,
        requestHash: attemptInput.requestHash,
        totalPriceInCents: 3_990,
        status: "PENDING",
        items: {
          create: [
            {
              productId: productRecord.id,
              productNameSnapshot: productRecord.name,
              quantity: 1,
              subtotalInCents: 3_990,
              unitPriceInCents: 3_990
            }
          ]
        }
      },
      include: { items: { orderBy: { productId: "asc" } } }
    });
    expect(result).toEqual({ kind: "CREATED", order: pendingOrder });
  });

  it("recupera o pedido vencedor após uma corrida gerar P2002", async () => {
    const uniqueError = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed.",
      {
        code: "P2002",
        clientVersion: "6.19.3",
        meta: { target: ["idempotencyKey"] }
      }
    );
    runTransaction.mockRejectedValueOnce(uniqueError);
    orderFindUnique.mockResolvedValueOnce(pendingOrder);

    const result = await repository.createAttempt(attemptInput);

    expect(result).toEqual({ kind: "EXISTING", order: pendingOrder });
    expect(orderFindUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: attemptInput.idempotencyKey },
      include: { items: { orderBy: { productId: "asc" } } }
    });
  });

  it("inicia uma tentativa e incrementa processingAttempts atomicamente", async () => {
    const processingOrder = createOrderRecord({
      status: "PROCESSING",
      processingAttempts: 1
    });
    orderFindUnique
      .mockResolvedValueOnce(pendingOrder)
      .mockResolvedValueOnce(processingOrder);
    const claim = {
      claimedAt: new Date("2026-08-03T12:00:00.000Z"),
      leaseUntil: new Date("2026-08-03T12:01:00.000Z"),
      token: "claim-1"
    };

    const result = await repository.startProcessingAttempt(
      "order-1",
      3,
      claim
    );

    expect(orderUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "order-1",
        status: { in: ["PENDING", "PROCESSING"] },
        processingAttempts: { lt: 3 }
      },
      data: {
        status: "PROCESSING",
        processingAttempts: { increment: 1 },
        errorCode: null,
        errorMessage: null
      }
    });
    expect(result).toEqual({
      kind: "CLAIMED",
      order: processingOrder,
      token: "claim-1"
    });
  });

  it("não devolve estoque quando o claim já foi consumido", async () => {
    const failedOrder = createOrderRecord({
      status: "FAILED",
      stockReleasedAt: new Date("2026-08-03T12:00:00.000Z")
    });
    processingClaimDeleteMany.mockResolvedValueOnce({ count: 0 });
    orderFindUnique.mockResolvedValueOnce(failedOrder);

    const result = await repository.failAndReleaseStock(
      "order-1",
      "claim-antigo",
      "ERP_MAX_ATTEMPTS_EXCEEDED",
      "Limite atingido."
    );

    expect(result).toEqual({ kind: "CLAIM_LOST", order: failedOrder });
    expect(productUpdate).not.toHaveBeenCalled();
  });
});
