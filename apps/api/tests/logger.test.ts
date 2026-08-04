import {
  createConsoleLogger,
  serializeError
} from "../src/utils/logger";

describe("structured logger", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("escreve uma linha JSON com os campos de correlação", () => {
    const write = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const logger = createConsoleLogger("case-cell-shop-api");

    logger.info("order.processing.completed", {
      requestId: "request-1",
      orderId: "order-1",
      productId: "product-1",
      status: "CONFIRMED",
      durationMs: 18,
      processingAttempt: 1
    });

    const serializedEntry = String(write.mock.calls[0]?.[0]);
    const entry = JSON.parse(serializedEntry) as Record<string, unknown>;

    expect(entry).toMatchObject({
      level: "info",
      service: "case-cell-shop-api",
      message: "order.processing.completed",
      requestId: "request-1",
      orderId: "order-1",
      productId: "product-1",
      status: "CONFIRMED",
      durationMs: 18,
      processingAttempt: 1
    });
    expect(entry.timestamp).toEqual(expect.any(String));
  });

  it("não serializa mensagem interna nem stack trace", () => {
    const error = Object.assign(
      new Error("password=secret /internal/database.db"),
      { code: "DATABASE_FAILURE" }
    );

    expect(serializeError(error)).toEqual({
      code: "DATABASE_FAILURE",
      name: "Error"
    });
    expect(JSON.stringify(serializeError(error))).not.toContain("secret");
    expect(JSON.stringify(serializeError(error))).not.toContain("stack");
  });
});
