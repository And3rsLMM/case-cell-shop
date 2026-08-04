import type { PrismaClient } from "@prisma/client";

export type ReadinessCheck = () => Promise<void>;

export function createPrismaReadinessCheck(
  prismaClient: PrismaClient
): ReadinessCheck {
  return async () => {
    await prismaClient.$queryRaw`SELECT 1`;
  };
}
