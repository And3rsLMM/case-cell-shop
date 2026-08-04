import type {
  ValidationErrorDetails,
  ValidationFieldError
} from "@case-cell-shop/contracts";
import type { RequestHandler } from "express";
import {
  validationResult,
  type FieldValidationError,
  type ValidationError
} from "express-validator";

import { createAppError } from "../domain/errors/app-error";

function toMessage(message: unknown): string {
  return typeof message === "string" ? message : String(message);
}

function mapFieldError(error: FieldValidationError): ValidationFieldError {
  return {
    field: error.path,
    message: toMessage(error.msg)
  };
}

function mapValidationError(error: ValidationError): ValidationFieldError[] {
  if (error.type === "field") {
    return [mapFieldError(error)];
  }

  if (error.type === "unknown_fields") {
    return error.fields.map((field) => ({
      field: field.path,
      message: toMessage(error.msg)
    }));
  }

  if (error.type === "alternative") {
    return error.nestedErrors.map(mapFieldError);
  }

  return error.nestedErrors.flat().map(mapFieldError);
}

function uniqueByField(
  fields: ValidationFieldError[]
): ValidationFieldError[] {
  const seenFields = new Set<string>();

  return fields.filter(({ field }) => {
    if (seenFields.has(field)) {
      return false;
    }

    seenFields.add(field);
    return true;
  });
}

export const handleValidationErrors: RequestHandler = (
  request,
  _response,
  next
) => {
  const result = validationResult(request);

  if (result.isEmpty()) {
    next();
    return;
  }

  const fields = uniqueByField(
    result.array({ onlyFirstError: true }).flatMap(mapValidationError)
  );
  const details = { fields } satisfies ValidationErrorDetails;

  next(
    createAppError({
      code: "VALIDATION_ERROR",
      details,
      message: "Os dados enviados são inválidos.",
      retryable: false,
      statusCode: 400
    })
  );
};
