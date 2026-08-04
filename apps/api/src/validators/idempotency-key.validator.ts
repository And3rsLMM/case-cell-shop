import { header, type ValidationChain } from "express-validator";

export const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

function hasNoSurroundingWhitespace(value: unknown): boolean {
  return typeof value === "string" && value === value.trim();
}

export function createIdempotencyKeyValidator(): ValidationChain {
  return header("Idempotency-Key")
    .exists({ values: "undefined" })
    .withMessage("O header Idempotency-Key é obrigatório.")
    .bail()
    .isString()
    .withMessage("O header Idempotency-Key deve ser uma string.")
    .bail()
    .isLength({
      min: IDEMPOTENCY_KEY_MIN_LENGTH,
      max: IDEMPOTENCY_KEY_MAX_LENGTH
    })
    .withMessage(
      `O header Idempotency-Key deve possuir entre ${IDEMPOTENCY_KEY_MIN_LENGTH} e ${IDEMPOTENCY_KEY_MAX_LENGTH} caracteres.`
    )
    .bail()
    .custom(hasNoSurroundingWhitespace)
    .withMessage("O header Idempotency-Key não deve conter espaços nas extremidades.");
}

export const idempotencyKeyValidators = [createIdempotencyKeyValidator()];
