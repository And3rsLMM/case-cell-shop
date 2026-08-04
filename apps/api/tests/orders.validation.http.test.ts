/* eslint-disable @typescript-eslint/unbound-method */
import type {
  ApiError,
  ValidationFieldError
} from "@case-cell-shop/contracts";

import { createApp } from "../src/app";
import type { OrderRepository } from "../src/repositories/order.repository";
import type { OrderProcessor } from "../src/services/order-processor.service";
import type { Logger } from "../src/utils/logger";
import {
  startHttpTestServer,
  type HttpTestServer
} from "./helpers/http-test-server";

const REQUEST_ID = "validation-http-request-id";

describe("validação HTTP de pedidos", () => {
  let server: HttpTestServer;
  let baseUrl: string;
  let orderRepository: jest.Mocked<OrderRepository>;

  beforeAll(async () => {
    orderRepository = {
      createAttempt: jest.fn(),
      failAndReleaseStock: jest.fn(),
      findById: jest.fn(),
      findByIdempotencyKey: jest.fn(),
      findProcessable: jest.fn(),
      markConfirmed: jest.fn(),
      markTemporaryFailure: jest.fn(),
      startProcessingAttempt: jest.fn()
    };
    const orderProcessor: jest.Mocked<OrderProcessor> = {
      processOrder: jest.fn(),
      waitForIdle: jest.fn()
    };
    const logger: jest.Mocked<Logger> = {
      error: jest.fn(),
      info: jest.fn()
    };
    const app = createApp({
      logger,
      orderProcessor,
      orderRepository,
      requestIdFactory: () => REQUEST_ID
    });

    server = await startHttpTestServer(app);
    baseUrl = server.baseUrl;
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function postOrder(
    body: unknown,
    idempotencyKey: string | null = "valid-key-123"
  ): Promise<Response> {
    return fetch(`${baseUrl}/api/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(idempotencyKey === null
          ? {}
          : { "Idempotency-Key": idempotencyKey })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  }

  function expectValidationContract(
    response: Response,
    body: ApiError,
    expectedFields: ValidationFieldError[]
  ): void {
    expect(response.status).toBe(400);
    expect(response.headers.get("X-Request-Id")).toBe(REQUEST_ID);
    expect(response.headers.get("Idempotency-Replayed")).toBeNull();
    expect(body.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Os dados enviados são inválidos.",
      retryable: false,
      requestId: REQUEST_ID
    });
    const details = body.error.details as {
      fields: ValidationFieldError[];
    };
    expect(details.fields).toHaveLength(expectedFields.length);
    expect(details.fields).toEqual(expect.arrayContaining(expectedFields));
  }

  it("rejeita body e campos obrigatórios ausentes", async () => {
    const cases: Array<[unknown, ValidationFieldError]> = [
      [undefined, { field: "items", message: "Os itens são obrigatórios." }],
      [
        { items: [] },
        {
          field: "items",
          message: "Os itens devem formar um array com 1 a 20 produtos distintos."
        }
      ],
      [
        { items: [{ quantity: 1 }] },
        {
          field: "items[0].productId",
          message: "O productId é obrigatório em cada item."
        }
      ],
      [
        { items: [{ productId: "product-1" }] },
        {
          field: "items[0].quantity",
          message: "A quantidade é obrigatória em cada item."
        }
      ]
    ];

    for (const [requestBody, expectedField] of cases) {
      const response = await postOrder(requestBody);
      const body = (await response.json()) as ApiError;

      expectValidationContract(response, body, [expectedField]);
    }
    expect(orderRepository.createAttempt).not.toHaveBeenCalled();
  });

  it("rejeita todos os formatos inválidos de quantity", async () => {
    for (const quantity of [0, -1, 1.5, "1"]) {
      const response = await postOrder({
        items: [{ productId: "product-1", quantity }]
      });
      const body = (await response.json()) as ApiError;

      expectValidationContract(response, body, [
        {
          field: "items[0].quantity",
          message: "A quantidade deve ser um inteiro maior que zero."
        }
      ]);
    }
    expect(orderRepository.createAttempt).not.toHaveBeenCalled();
  });

  it("rejeita campos extras e productId duplicado", async () => {
    const cases: Array<[unknown, ValidationFieldError]> = [
      [
        {
          items: [{ productId: "product-1", quantity: 1 }],
          coupon: "PROMO"
        },
        { field: "coupon", message: "O campo não é permitido." }
      ],
      [
        { items: [{ productId: "product-1", quantity: 1, price: 1 }] },
        { field: "items[0]", message: "O item contém campo não permitido." }
      ],
      [
        {
          items: [
            { productId: "product-1", quantity: 1 },
            { productId: "product-1", quantity: 2 }
          ]
        },
        {
          field: "items",
          message: "O mesmo productId não pode aparecer mais de uma vez."
        }
      ]
    ];

    for (const [requestBody, expectedField] of cases) {
      const response = await postOrder(requestBody);
      const body = (await response.json()) as ApiError;

      expectValidationContract(response, body, [expectedField]);
    }
    expect(orderRepository.createAttempt).not.toHaveBeenCalled();
  });

  it("rejeita mais itens distintos que o limite configurado", async () => {
    const response = await postOrder({
      items: Array.from({ length: 21 }, (_, index) => ({
        productId: `product-${index}`,
        quantity: 1
      }))
    });
    const body = (await response.json()) as ApiError;

    expectValidationContract(response, body, [
      {
        field: "items",
        message: "Os itens devem formar um array com 1 a 20 produtos distintos."
      }
    ]);
  });

  it("rejeita Idempotency-Key ausente com contrato próprio", async () => {
    const response = await postOrder(
      { items: [{ productId: "product-1", quantity: 1 }] },
      null
    );
    const body = (await response.json()) as ApiError;

    expect(response.status).toBe(400);
    expect(response.headers.get("X-Request-Id")).toBe(REQUEST_ID);
    expect(body).toEqual({
      error: {
        code: "IDEMPOTENCY_KEY_REQUIRED",
        details: {},
        message: "O header Idempotency-Key é obrigatório.",
        requestId: REQUEST_ID,
        retryable: false
      }
    });
    expect(orderRepository.createAttempt).not.toHaveBeenCalled();
  });
});
