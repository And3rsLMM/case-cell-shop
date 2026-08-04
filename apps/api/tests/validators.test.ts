import type { NextFunction, Request, Response } from "express";
import {
  validationResult,
  type ContextRunner,
  type ValidationError
} from "express-validator";

import { isAppError } from "../src/domain/errors/app-error";
import { handleValidationErrors } from "../src/middlewares/validation-error.middleware";
import {
  createOrderValidators,
  idempotencyKeyValidators
} from "../src/validators";

interface RequestInput {
  body?: unknown;
  headers?: Record<string, unknown>;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
}

function createRequest(input: RequestInput = {}): Request {
  return {
    body: input.body ?? {},
    cookies: {},
    headers: input.headers ?? {},
    params: input.params ?? {},
    query: input.query ?? {}
  } as unknown as Request;
}

async function runValidators(
  validators: readonly ContextRunner[],
  request: Request
): Promise<ValidationError[]> {
  for (const validator of validators) {
    await validator.run(request);
  }

  return validationResult(request).array();
}

function getErrorPaths(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => {
    if (error.type === "field") {
      return [error.path];
    }

    if (error.type === "unknown_fields") {
      return error.fields.map(({ path }) => path);
    }

    return error.nestedErrors.flat().map(({ path }) => path);
  });
}

describe("validadores HTTP", () => {
  it("aceita uma tentativa de compra estruturalmente válida", async () => {
    const request = createRequest({
      body: { items: [{ productId: "product-1", quantity: 2 }] },
      headers: { "idempotency-key": "order-key-123" }
    });

    const errors = await runValidators(createOrderValidators, request);

    expect(errors).toEqual([]);
  });

  it("não converte uma quantity textual em número", async () => {
    const request = createRequest({
      body: { items: [{ productId: "product-1", quantity: "2" }] },
      headers: { "idempotency-key": "order-key-123" }
    });

    const errors = await runValidators(createOrderValidators, request);

    expect(getErrorPaths(errors)).toContain("items[0].quantity");
    expect(request.body).toEqual({
      items: [{ productId: "product-1", quantity: "2" }]
    });
  });

  it("valida o Idempotency-Key de forma independente", async () => {
    const request = createRequest({
      headers: { "idempotency-key": "short" }
    });

    const errors = await runValidators(idempotencyKeyValidators, request);

    expect(getErrorPaths(errors)).toEqual(["idempotency-key"]);
    expect(errors[0]).toMatchObject({
      msg: "O header Idempotency-Key deve possuir entre 8 e 128 caracteres."
    });
  });

});

describe("handleValidationErrors", () => {
  it("consolida os erros no AppError de validação", async () => {
    const request = createRequest({
      body: { items: [{ productId: "product-1", quantity: 0 }] },
      headers: { "idempotency-key": "order-key-123" }
    });
    const next = jest.fn() as jest.MockedFunction<NextFunction>;

    await runValidators(createOrderValidators, request);
    handleValidationErrors(request, {} as Response, next);

    const error = next.mock.calls[0]?.[0];

    expect(isAppError(error)).toBe(true);
    expect(error).toMatchObject({
      code: "VALIDATION_ERROR",
      details: {
        fields: [
          {
            field: "items[0].quantity",
            message: "A quantidade deve ser um inteiro maior que zero."
          }
        ]
      },
      message: "Os dados enviados são inválidos.",
      retryable: false,
      statusCode: 400
    });
  });

});
