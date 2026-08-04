import { checkExact, query } from "express-validator";

import { isNonBlankString } from "./common.validator";

const MAX_PAGE_SIZE = 100;
const MAX_CURSOR_LENGTH = 128;

const productListQueryValidators = [
  query("limit")
    .optional()
    .isInt({ min: 1, max: MAX_PAGE_SIZE })
    .withMessage(`O limite deve ser um inteiro entre 1 e ${MAX_PAGE_SIZE}.`),
  query("cursor")
    .optional()
    .isString()
    .withMessage("O cursor deve ser uma string não vazia.")
    .bail()
    .custom(isNonBlankString)
    .withMessage("O cursor deve ser uma string não vazia.")
    .bail()
    .isLength({ max: MAX_CURSOR_LENGTH })
    .withMessage(
      `O cursor deve possuir no máximo ${MAX_CURSOR_LENGTH} caracteres.`
    )
];

export const getProductsValidators = [
  checkExact(productListQueryValidators, {
    locations: ["query"],
    message: "O parâmetro de consulta não é permitido."
  })
];
