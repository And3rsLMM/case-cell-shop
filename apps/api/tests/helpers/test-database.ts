import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { PrismaClient } from "@prisma/client";

export interface TestDatabase {
  databaseUrl: string;
  prisma: PrismaClient;
  close(): Promise<void>;
  reset(): Promise<void>;
}

const migrationsDirectory = resolve(
  __dirname,
  "../../prisma/migrations"
);

function toSqliteDatabaseUrl(databasePath: string): string {
  return `file:${databasePath.replaceAll("\\", "/")}`;
}

async function applyMigrationFile(
  prisma: PrismaClient,
  migrationPath: string
): Promise<void> {
  const migrationSql = await readFile(migrationPath, "utf8");
  const statements = migrationSql
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
}

async function applyProjectMigrations(prisma: PrismaClient): Promise<void> {
  const entries = await readdir(migrationsDirectory, {
    withFileTypes: true
  });
  const migrationDirectories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (migrationDirectories.length === 0) {
    throw new Error("Nenhuma migration do Prisma foi encontrada para os testes.");
  }

  for (const directory of migrationDirectories) {
    await applyMigrationFile(
      prisma,
      join(migrationsDirectory, directory, "migration.sql")
    );
  }
}

export async function createTestDatabase(
  name = "case-cell-shop-test-"
): Promise<TestDatabase> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), name));
  const databasePath = join(temporaryDirectory, "test.db");
  const databaseUrl = toSqliteDatabaseUrl(databasePath);
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });

  try {
    await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL");
    await prisma.$queryRawUnsafe("PRAGMA busy_timeout = 10000");
    await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
    await applyProjectMigrations(prisma);
  } catch (migrationError: unknown) {
    const cleanupErrors: unknown[] = [migrationError];

    try {
      await prisma.$disconnect();
    } catch (disconnectError: unknown) {
      cleanupErrors.push(disconnectError);
    }

    try {
      await rm(temporaryDirectory, { force: true, recursive: true });
    } catch (removeError: unknown) {
      cleanupErrors.push(removeError);
    }

    if (cleanupErrors.length > 1) {
      throw new AggregateError(
        cleanupErrors,
        "Falha ao migrar e limpar o banco SQLite de teste."
      );
    }

    throw migrationError;
  }

  let closePromise: Promise<void> | null = null;

  return {
    databaseUrl,
    prisma,
    reset: async () => {
      await prisma.$transaction([
        prisma.order.deleteMany(),
        prisma.product.deleteMany()
      ]);
    },
    close: () => {
      closePromise ??= (async () => {
        const cleanupErrors: unknown[] = [];

        try {
          await prisma.$disconnect();
        } catch (disconnectError: unknown) {
          cleanupErrors.push(disconnectError);
        }

        try {
          await rm(temporaryDirectory, { force: true, recursive: true });
        } catch (removeError: unknown) {
          cleanupErrors.push(removeError);
        }

        if (cleanupErrors.length > 0) {
          throw new AggregateError(
            cleanupErrors,
            "Falha ao encerrar o banco SQLite de teste."
          );
        }
      })();

      return closePromise;
    }
  };
}
