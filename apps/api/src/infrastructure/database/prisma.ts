import { PrismaClient } from "@prisma/client";

export function createPrismaClient(): PrismaClient {
  return new PrismaClient();
}

export const prisma = createPrismaClient();

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
