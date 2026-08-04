/* eslint-disable @typescript-eslint/unbound-method */
import { createApp } from "../src/app";
import type { ReadinessCheck } from "../src/gateways/readiness.gateway";
import type { Logger } from "../src/utils/logger";
import {
  startHttpTestServer,
  type HttpTestServer
} from "./helpers/http-test-server";

describe("rotas de sistema e middlewares HTTP", () => {
  let server: HttpTestServer;
  let baseUrl: string;
  let readinessCheck: jest.MockedFunction<ReadinessCheck>;
  let logger: jest.Mocked<Logger>;

  beforeAll(async () => {
    readinessCheck = jest.fn<ReturnType<ReadinessCheck>, []>();
    readinessCheck.mockResolvedValue(undefined);
    logger = {
      info: jest.fn(),
      error: jest.fn()
    };

    const app = createApp({
      corsOrigin: "http://localhost:3000",
      logger,
      now: () => new Date("2026-08-02T12:00:00.000Z"),
      readinessCheck,
      requestIdFactory: () => "generated-request-id"
    });

    server = await startHttpTestServer(app);
    baseUrl = server.baseUrl;
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    readinessCheck.mockResolvedValue(undefined);
  });

  it("responde ao health por HTTP real e preserva um X-Request-Id válido", async () => {
    const response = await fetch(`${baseUrl}/health`, {
      headers: {
        "X-Request-Id": "client-request-123"
      }
    });
    const body = (await response.json()) as {
      service: string;
      status: string;
      timestamp: string;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Request-Id")).toBe("client-request-123");
    expect(body).toEqual({
      service: "api",
      status: "ok",
      timestamp: "2026-08-02T12:00:00.000Z"
    });
    expect(logger.info).toHaveBeenCalledWith(
      "http.request.completed",
      expect.objectContaining({
        requestId: "client-request-123",
        method: "GET",
        path: "/health",
        statusCode: 200
      })
    );
    const completedLog = logger.info.mock.calls.find(
      ([message]) => message === "http.request.completed"
    );
    expect(typeof completedLog?.[1]?.durationMs).toBe("number");
  });

  it("retorna ready quando as dependências estão disponíveis", async () => {
    const response = await fetch(`${baseUrl}/ready`);
    const body = (await response.json()) as {
      service: string;
      status: string;
      timestamp: string;
    };

    expect(response.status).toBe(200);
    expect(readinessCheck).toHaveBeenCalledTimes(1);
    expect(body).toEqual({
      service: "api",
      status: "ready",
      timestamp: "2026-08-02T12:00:00.000Z"
    });
  });

  it("retorna erro seguro quando a API não está pronta", async () => {
    readinessCheck.mockRejectedValueOnce(
      new Error("detalhe interno da conexão com o banco")
    );

    const response = await fetch(`${baseUrl}/ready`);
    const body = (await response.json()) as {
      error: {
        code: string;
        message: string;
        requestId: string;
        retryable: boolean;
      };
    };

    expect(response.status).toBe(503);
    expect(body.error).toEqual({
      code: "SERVICE_NOT_READY",
      details: {},
      message: "A API ainda não está pronta para receber tráfego.",
      requestId: "generated-request-id",
      retryable: true
    });
    expect(JSON.stringify(body)).not.toContain("detalhe interno");
    expect(JSON.stringify(body)).not.toContain("stack");
    expect(logger.error.mock.calls).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledWith(
      "http.request.failed",
      expect.objectContaining({
        requestId: "generated-request-id",
        errorCode: "SERVICE_NOT_READY",
        statusCode: 503
      })
    );
  });

  it("normaliza JSON inválido sem expor stack trace", async () => {
    const response = await fetch(`${baseUrl}/health`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: "{"
    });
    const body = (await response.json()) as {
      error: {
        code: string;
        requestId: string;
      };
    };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_JSON");
    expect(body.error.requestId).toBe("generated-request-id");
    expect(JSON.stringify(body)).not.toContain("stack");
  });

});
