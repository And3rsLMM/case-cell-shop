import type { CreateOrderItemRequest } from "@case-cell-shop/contracts";
import { Prisma, type PrismaClient } from "@prisma/client";

export type OrderWithItems = Prisma.OrderGetPayload<{
  include: { items: true };
}>;

export interface CreateOrderAttemptInput {
  idempotencyKey: string;
  items: CreateOrderItemRequest[];
  requestHash: string;
}

export interface InsufficientStockItem {
  availableQuantity: number;
  productId: string;
  requestedQuantity: number;
}

export type CreateOrderAttemptResult =
  | { kind: "CREATED"; order: OrderWithItems }
  | { kind: "EXISTING"; order: OrderWithItems }
  | { kind: "INSUFFICIENT_STOCK"; items: InsufficientStockItem[] }
  | { kind: "PRODUCT_NOT_FOUND"; productIds: string[] };

export interface ProcessingClaimInput {
  claimedAt: Date;
  leaseUntil: Date;
  token: string;
}

export type ProcessingClaimResult =
  | { kind: "CLAIMED"; order: OrderWithItems; token: string }
  | { kind: "EXHAUSTED"; order: OrderWithItems; token: string };

export type ClaimedOrderTransitionResult =
  | { kind: "APPLIED"; order: OrderWithItems }
  | { kind: "CLAIM_LOST"; order: OrderWithItems | null };

export interface OrderRepository {
  createAttempt(
    input: CreateOrderAttemptInput
  ): Promise<CreateOrderAttemptResult>;
  findById(id: string): Promise<OrderWithItems | null>;
  findByIdempotencyKey(key: string): Promise<OrderWithItems | null>;
  findProcessable(limit: number, now: Date): Promise<OrderWithItems[]>;
  startProcessingAttempt(
    id: string,
    maxAttempts: number,
    claim: ProcessingClaimInput
  ): Promise<ProcessingClaimResult | null>;
  markConfirmed(
    id: string,
    claimToken: string
  ): Promise<ClaimedOrderTransitionResult>;
  markTemporaryFailure(
    id: string,
    claimToken: string,
    errorCode: string,
    errorMessage: string
  ): Promise<ClaimedOrderTransitionResult>;
  failAndReleaseStock(
    id: string,
    claimToken: string,
    errorCode: string,
    errorMessage: string
  ): Promise<ClaimedOrderTransitionResult>;
}

const orderWithItems = {
  items: { orderBy: { productId: "asc" as const } }
};

class ReservationRejectedError extends Error {
  constructor(readonly result: CreateOrderAttemptResult) {
    super(result.kind);
    this.name = "ReservationRejectedError";
  }
}

async function createAttemptInTransaction(
  transaction: Prisma.TransactionClient,
  input: CreateOrderAttemptInput
): Promise<CreateOrderAttemptResult> {
  const existingOrder = await transaction.order.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    include: orderWithItems
  });

  if (existingOrder !== null) {
    return { kind: "EXISTING", order: existingOrder };
  }

  const sortedItems = [...input.items].sort((first, second) => {
    if (first.productId < second.productId) {
      return -1;
    }

    if (first.productId > second.productId) {
      return 1;
    }

    return 0;
  });
  const itemsToCreate: Array<{
    productId: string;
    productNameSnapshot: string;
    quantity: number;
    subtotalInCents: number;
    unitPriceInCents: number;
  }> = [];

  for (const item of sortedItems) {
    const product = await transaction.product.findFirst({
      where: { id: item.productId, active: true }
    });

    if (product === null) {
      throw new ReservationRejectedError({
        kind: "PRODUCT_NOT_FOUND",
        productIds: [item.productId]
      });
    }

    const reservation = await transaction.product.updateMany({
      where: {
        id: item.productId,
        active: true,
        stock: { gte: item.quantity }
      },
      data: {
        stock: { decrement: item.quantity }
      }
    });

    if (reservation.count === 0) {
      const currentProduct = await transaction.product.findUnique({
        where: { id: item.productId },
        select: { active: true, stock: true }
      });

      if (currentProduct === null || !currentProduct.active) {
        throw new ReservationRejectedError({
          kind: "PRODUCT_NOT_FOUND",
          productIds: [item.productId]
        });
      }

      throw new ReservationRejectedError({
        kind: "INSUFFICIENT_STOCK",
        items: [
          {
            availableQuantity: currentProduct.stock,
            productId: item.productId,
            requestedQuantity: item.quantity
          }
        ]
      });
    }

    const subtotalInCents = product.priceInCents * item.quantity;
    itemsToCreate.push({
      productId: product.id,
      productNameSnapshot: product.name,
      quantity: item.quantity,
      subtotalInCents,
      unitPriceInCents: product.priceInCents
    });
  }

  const totalPriceInCents = itemsToCreate.reduce(
    (total, item) => total + item.subtotalInCents,
    0
  );

  const order = await transaction.order.create({
    data: {
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      totalPriceInCents,
      status: "PENDING",
      items: { create: itemsToCreate }
    },
    include: orderWithItems
  });

  return { kind: "CREATED", order };
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

async function acquireProcessingClaim(
  transaction: Prisma.TransactionClient,
  orderId: string,
  claim: ProcessingClaimInput
): Promise<boolean> {
  const currentClaim =
    await transaction.orderProcessingClaim.findUnique({
      where: { orderId }
    });

  if (currentClaim === null) {
    await transaction.orderProcessingClaim.create({
      data: {
        orderId,
        token: claim.token,
        leaseUntil: claim.leaseUntil
      }
    });
    return true;
  }

  if (currentClaim.leaseUntil > claim.claimedAt) {
    return false;
  }

  const replaced = await transaction.orderProcessingClaim.updateMany({
    where: {
      orderId,
      token: currentClaim.token,
      leaseUntil: { lte: claim.claimedAt }
    },
    data: {
      token: claim.token,
      leaseUntil: claim.leaseUntil
    }
  });

  return replaced.count === 1;
}

async function startProcessingAttemptInTransaction(
  transaction: Prisma.TransactionClient,
  id: string,
  maxAttempts: number,
  claim: ProcessingClaimInput
): Promise<ProcessingClaimResult | null> {
  const order = await transaction.order.findUnique({
    where: { id },
    include: orderWithItems
  });

  if (
    order === null ||
    (order.status !== "PENDING" && order.status !== "PROCESSING")
  ) {
    return null;
  }

  const acquired = await acquireProcessingClaim(transaction, id, claim);

  if (!acquired) {
    return null;
  }

  if (order.processingAttempts >= maxAttempts) {
    return { kind: "EXHAUSTED", order, token: claim.token };
  }

  const started = await transaction.order.updateMany({
    where: {
      id,
      status: { in: ["PENDING", "PROCESSING"] },
      processingAttempts: { lt: maxAttempts }
    },
    data: {
      status: "PROCESSING",
      processingAttempts: { increment: 1 },
      errorCode: null,
      errorMessage: null
    }
  });

  if (started.count === 0) {
    await transaction.orderProcessingClaim.deleteMany({
      where: { orderId: id, token: claim.token }
    });
    return null;
  }

  const startedOrder = await transaction.order.findUnique({
    where: { id },
    include: orderWithItems
  });

  if (startedOrder === null) {
    throw new Error("Pedido desapareceu durante o início do processamento.");
  }

  return { kind: "CLAIMED", order: startedOrder, token: claim.token };
}

async function claimLostResult(
  transaction: Prisma.TransactionClient,
  id: string
): Promise<ClaimedOrderTransitionResult> {
  const order = await transaction.order.findUnique({
    where: { id },
    include: orderWithItems
  });
  return { kind: "CLAIM_LOST", order };
}

async function consumeClaim(
  transaction: Prisma.TransactionClient,
  id: string,
  claimToken: string
): Promise<boolean> {
  const consumed = await transaction.orderProcessingClaim.deleteMany({
    where: { orderId: id, token: claimToken }
  });
  return consumed.count === 1;
}

async function findOrderWithItems(
  transaction: Prisma.TransactionClient,
  id: string
): Promise<OrderWithItems | null> {
  return transaction.order.findUnique({
    where: { id },
    include: orderWithItems
  });
}

async function markConfirmedInTransaction(
  transaction: Prisma.TransactionClient,
  id: string,
  claimToken: string
): Promise<ClaimedOrderTransitionResult> {
  if (!(await consumeClaim(transaction, id, claimToken))) {
    return claimLostResult(transaction, id);
  }

  const transition = await transaction.order.updateMany({
    where: { id, status: "PROCESSING", stockReleasedAt: null },
    data: {
      status: "CONFIRMED",
      errorCode: null,
      errorMessage: null
    }
  });

  if (transition.count === 0) {
    return claimLostResult(transaction, id);
  }

  const order = await findOrderWithItems(transaction, id);

  if (order === null) {
    throw new Error("Pedido desapareceu durante a confirmação.");
  }

  return { kind: "APPLIED", order };
}

async function markTemporaryFailureInTransaction(
  transaction: Prisma.TransactionClient,
  id: string,
  claimToken: string,
  errorCode: string,
  errorMessage: string
): Promise<ClaimedOrderTransitionResult> {
  if (!(await consumeClaim(transaction, id, claimToken))) {
    return claimLostResult(transaction, id);
  }

  const transition = await transaction.order.updateMany({
    where: { id, status: "PROCESSING", stockReleasedAt: null },
    data: {
      status: "PROCESSING",
      errorCode,
      errorMessage
    }
  });

  if (transition.count === 0) {
    return claimLostResult(transaction, id);
  }

  const order = await findOrderWithItems(transaction, id);

  if (order === null) {
    throw new Error("Pedido desapareceu após a falha temporária.");
  }

  return { kind: "APPLIED", order };
}

interface FailAndReleaseStockInput {
  claimToken: string;
  errorCode: string;
  errorMessage: string;
  id: string;
  releasedAt: Date;
}

async function failAndReleaseStockInTransaction(
  transaction: Prisma.TransactionClient,
  input: FailAndReleaseStockInput
): Promise<ClaimedOrderTransitionResult> {
  if (!(await consumeClaim(transaction, input.id, input.claimToken))) {
    return claimLostResult(transaction, input.id);
  }

  const order = await findOrderWithItems(transaction, input.id);

  if (order === null) {
    return { kind: "CLAIM_LOST", order: null };
  }

  const transition = await transaction.order.updateMany({
    where: {
      id: input.id,
      status: "PROCESSING",
      stockReleasedAt: null
    },
    data: {
      status: "FAILED",
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      stockReleasedAt: input.releasedAt
    }
  });

  if (transition.count === 0) {
    return claimLostResult(transaction, input.id);
  }

  for (const item of order.items) {
    await transaction.product.update({
      where: { id: item.productId },
      data: { stock: { increment: item.quantity } }
    });
  }

  const failedOrder = await findOrderWithItems(transaction, input.id);

  if (failedOrder === null) {
    throw new Error("Pedido desapareceu durante a falha definitiva.");
  }

  return { kind: "APPLIED", order: failedOrder };
}

export function createPrismaOrderRepository(
  prismaClient: PrismaClient,
  now: () => Date = () => new Date()
): OrderRepository {
  return {
    createAttempt: async (input) => {
      try {
        return await prismaClient.$transaction((transaction) =>
          createAttemptInTransaction(transaction, input)
        );
      } catch (error: unknown) {
        if (error instanceof ReservationRejectedError) {
          return error.result;
        }

        if (!isUniqueConstraintError(error)) {
          throw error;
        }

        const existingOrder = await prismaClient.order.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          include: orderWithItems
        });

        if (existingOrder === null) {
          throw error;
        }

        return { kind: "EXISTING", order: existingOrder };
      }
    },
    findById: (id) =>
      prismaClient.order.findUnique({
        where: { id },
        include: orderWithItems
      }),
    findByIdempotencyKey: (idempotencyKey) =>
      prismaClient.order.findUnique({
        where: { idempotencyKey },
        include: orderWithItems
      }),
    findProcessable: (limit, currentTime) =>
      prismaClient.order.findMany({
        where: {
          status: { in: ["PENDING", "PROCESSING"] },
          OR: [
            { processingClaim: { is: null } },
            {
              processingClaim: {
                is: { leaseUntil: { lte: currentTime } }
              }
            }
          ]
        },
        orderBy: { updatedAt: "asc" },
        take: limit,
        include: orderWithItems
      }),
    startProcessingAttempt: async (id, maxAttempts, claim) => {
      try {
        return await prismaClient.$transaction((transaction) =>
          startProcessingAttemptInTransaction(
            transaction,
            id,
            maxAttempts,
            claim
          )
        );
      } catch (error: unknown) {
        if (isUniqueConstraintError(error)) {
          return null;
        }
        throw error;
      }
    },
    markConfirmed: (id, claimToken) =>
      prismaClient.$transaction((transaction) =>
        markConfirmedInTransaction(transaction, id, claimToken)
      ),
    markTemporaryFailure: (
      id,
      claimToken,
      errorCode,
      errorMessage
    ) =>
      prismaClient.$transaction((transaction) =>
        markTemporaryFailureInTransaction(
          transaction,
          id,
          claimToken,
          errorCode,
          errorMessage
        )
      ),
    failAndReleaseStock: (
      id,
      claimToken,
      errorCode,
      errorMessage
    ) =>
      prismaClient.$transaction((transaction) =>
        failAndReleaseStockInTransaction(transaction, {
          id,
          claimToken,
          errorCode,
          errorMessage,
          releasedAt: now()
        })
      )
  };
}
