import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { config } from "dotenv";

import type { ErpSimulationMode } from "../gateways/erp.gateway";

const environmentCandidates = [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../../.env")
];

const environmentFile = environmentCandidates.find(existsSync);

if (environmentFile !== undefined) {
  config({ path: environmentFile });
}

process.env.DATABASE_URL ??= "file:./dev.db";

function readPort(value: string | undefined): number {
  const port = Number(value ?? "3333");

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("API_PORT deve ser um número inteiro entre 1 e 65535.");
  }

  return port;
}

function readWebOrigin(value: string | undefined): string {
  const origin = value ?? "http://localhost:3000";

  try {
    const url = new URL(origin);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error();
    }

    return url.origin;
  } catch {
    throw new Error("WEB_ORIGIN deve ser uma origem HTTP ou HTTPS válida.");
  }
}

function readJsonBodyLimit(value: string | undefined): string {
  const limit = value ?? "32kb";

  if (!/^[1-9]\d*(?:b|kb|mb)$/i.test(limit)) {
    throw new Error("JSON_BODY_LIMIT deve usar o formato 32kb, 1mb ou equivalente.");
  }

  return limit.toLowerCase();
}

function readNonNegativeInteger(
  name: string,
  value: string | undefined,
  fallback: number
): number {
  const parsed = Number(value ?? fallback);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} deve ser um número inteiro maior ou igual a zero.`);
  }

  return parsed;
}

function readPositiveInteger(
  name: string,
  value: string | undefined,
  fallback: number
): number {
  const parsed = Number(value ?? fallback);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} deve ser um número inteiro maior que zero.`);
  }

  return parsed;
}

function readFailureRate(value: string | undefined): number {
  const failureRate = Number(value ?? "0");

  if (!Number.isFinite(failureRate) || failureRate < 0 || failureRate > 1) {
    throw new Error("ERP_FAILURE_RATE deve ser um número entre 0 e 1.");
  }

  return failureRate;
}

function readErpSimulationMode(
  value: string | undefined
): ErpSimulationMode | undefined {
  if (value === undefined || value === "" || value === "automatic") {
    return undefined;
  }

  if (
    value === "success" ||
    value === "slow" ||
    value === "temporary-failure"
  ) {
    return value;
  }

  throw new Error(
    "ERP_SIMULATION_MODE deve ser automatic, success, slow ou temporary-failure."
  );
}

const erpMinDelayMs = readNonNegativeInteger(
  "ERP_MIN_DELAY_MS",
  process.env.ERP_MIN_DELAY_MS,
  50
);
const erpMaxDelayMs = readNonNegativeInteger(
  "ERP_MAX_DELAY_MS",
  process.env.ERP_MAX_DELAY_MS,
  150
);

if (erpMaxDelayMs < erpMinDelayMs) {
  throw new Error("ERP_MAX_DELAY_MS deve ser maior ou igual a ERP_MIN_DELAY_MS.");
}

const erpSyncTimeoutMs = readPositiveInteger(
  "ERP_SYNC_TIMEOUT_MS",
  process.env.ERP_SYNC_TIMEOUT_MS,
  200
);
const erpProcessingLeaseMs = readPositiveInteger(
  "ERP_PROCESSING_LEASE_MS",
  process.env.ERP_PROCESSING_LEASE_MS,
  30_000
);

export const environment = {
  apiPort: readPort(process.env.API_PORT),
  webOrigin: readWebOrigin(process.env.WEB_ORIGIN),
  jsonBodyLimit: readJsonBodyLimit(process.env.JSON_BODY_LIMIT),
  order: {
    maxDistinctItems: readPositiveInteger(
      "ORDER_MAX_DISTINCT_ITEMS",
      process.env.ORDER_MAX_DISTINCT_ITEMS,
      20
    )
  },
  erp: {
    minDelayMs: erpMinDelayMs,
    maxDelayMs: erpMaxDelayMs,
    failureRate: readFailureRate(process.env.ERP_FAILURE_RATE),
    simulationMode: readErpSimulationMode(
      process.env.ERP_SIMULATION_MODE
    ),
    syncTimeoutMs: erpSyncTimeoutMs,
    processingLeaseMs: erpProcessingLeaseMs,
    maxAttempts: readPositiveInteger(
      "ERP_MAX_ATTEMPTS",
      process.env.ERP_MAX_ATTEMPTS,
      3
    )
  }
};
