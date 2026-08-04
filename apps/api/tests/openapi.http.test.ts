import { createApp } from "../src/app";
import { openApiDocument } from "../src/openapi/openapi.document";
import type { Logger } from "../src/utils/logger";
import {
  startHttpTestServer,
  type HttpTestServer
} from "./helpers/http-test-server";

function collectLocalReferences(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectLocalReferences);
  }

  if (typeof value !== "object" || value === null) {
    return [];
  }

  return Object.entries(value).flatMap(([key, nestedValue]) => {
    if (
      key === "$ref" &&
      typeof nestedValue === "string" &&
      nestedValue.startsWith("#/")
    ) {
      return [nestedValue];
    }

    return collectLocalReferences(nestedValue);
  });
}

function resolveLocalReference(
  document: unknown,
  reference: string
): unknown {
  return reference
    .slice(2)
    .split("/")
    .reduce<unknown>((currentValue, segment) => {
      if (
        typeof currentValue !== "object" ||
        currentValue === null ||
        Array.isArray(currentValue)
      ) {
        return undefined;
      }

      return (currentValue as Record<string, unknown>)[segment];
    }, document);
}

describe("documentação OpenAPI", () => {
  let server: HttpTestServer;

  beforeAll(async () => {
    const logger: jest.Mocked<Logger> = {
      error: jest.fn(),
      info: jest.fn()
    };
    const app = createApp({
      logger,
      requestIdFactory: () => "openapi-request-id"
    });

    server = await startHttpTestServer(app);
  });

  afterAll(async () => {
    await server.close();
  });

  it("serve a especificação por HTTP real", async () => {
    const response = await fetch(`${server.baseUrl}/openapi.json`);
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/json"
    );
    expect(response.headers.get("X-Request-Id")).toBe(
      "openapi-request-id"
    );
    expect(body).toMatchObject({
      openapi: "3.0.3",
      info: { title: "CaseCellShop API" }
    });
  });

  it("documenta todos os endpoints públicos e referências existentes", () => {
    expect(Object.keys(openApiDocument.paths).sort()).toEqual([
      "/api/orders",
      "/api/orders/{id}",
      "/api/products",
      "/api/products/{id}",
      "/health",
      "/ready"
    ]);

    const references = collectLocalReferences(openApiDocument);

    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(resolveLocalReference(openApiDocument, reference)).toBeDefined();
    }
  });

  it("mantém os principais contratos do checkout na especificação", () => {
    const createOrder = openApiDocument.paths["/api/orders"].post;

    expect(createOrder.parameters).toContainEqual({
      $ref: "#/components/parameters/IdempotencyKey"
    });
    expect(Object.keys(createOrder.responses).sort()).toEqual([
      "200",
      "201",
      "202",
      "400",
      "404",
      "409",
      "500",
      "502",
      "503"
    ]);
    expect(openApiDocument.components.schemas.OrderStatus.enum).toEqual([
      "PENDING",
      "PROCESSING",
      "CONFIRMED",
      "FAILED",
      "STOCK_REJECTED"
    ]);
  });

  it("inclui exemplos e instruções para os três modos determinísticos do ERP", () => {
    const scenarios = openApiDocument["x-erp-test-scenarios"];
    const requestExamples =
      openApiDocument.paths["/api/orders"].post.requestBody.content[
        "application/json"
      ].examples;

    expect(scenarios.map(({ id }) => id)).toEqual([
      "erp-success",
      "erp-slow",
      "erp-temporary-failure"
    ]);
    expect(scenarios.map(({ environment }) => environment.ERP_SIMULATION_MODE))
      .toEqual(["success", "slow", "temporary-failure"]);
    expect(Object.keys(requestExamples)).toEqual(
      expect.arrayContaining([
        "erpSuccess",
        "erpSlow",
        "erpTemporaryFailure"
      ])
    );
    expect(
      openApiDocument.paths["/api/orders/{id}"].get.description
    ).toContain("polling");
  });
});
