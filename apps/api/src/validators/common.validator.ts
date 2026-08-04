import { param, type ValidationChain } from "express-validator";

const MAX_IDENTIFIER_LENGTH = 128;

export function isNonBlankString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function createIdParamValidator(): ValidationChain {
  return param("id")
    .exists({ values: "undefined" })
    .withMessage("O identificador é obrigatório.")
    .bail()
    .isString()
    .withMessage("O identificador deve ser uma string não vazia.")
    .bail()
    .custom(isNonBlankString)
    .withMessage("O identificador deve ser uma string não vazia.")
    .bail()
    .isLength({ max: MAX_IDENTIFIER_LENGTH })
    .withMessage(
      `O identificador deve possuir no máximo ${MAX_IDENTIFIER_LENGTH} caracteres.`
    );
}
