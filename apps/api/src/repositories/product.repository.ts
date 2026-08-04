import type { PrismaClient, Product as ProductRecord } from "@prisma/client";

export interface FindActiveProductsPageInput {
  cursor: string | undefined;
  take: number;
}

export interface ProductRepository {
  findActiveById(id: string): Promise<ProductRecord | null>;
  findActivePage(
    input: FindActiveProductsPageInput
  ): Promise<ProductRecord[]>;
}

export function createPrismaProductRepository(
  prismaClient: PrismaClient
): ProductRepository {
  return {
    findActiveById: (id) =>
      prismaClient.product.findFirst({
        where: {
          id,
          active: true
        }
      }),
    findActivePage: ({ cursor, take }) =>
      prismaClient.product.findMany({
        where: {
          active: true
        },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take,
        ...(cursor === undefined
          ? {}
          : {
              cursor: { id: cursor },
              skip: 1
            })
      })
  };
}
