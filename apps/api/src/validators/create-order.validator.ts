import { body, checkExact } from "express-validator";

import { environment } from "../config/environment";
import { isNonBlankString } from "./common.validator";
import { createIdempotencyKeyValidator } from "./idempotency-key.validator";

const MAX_PRODUCT_ID_LENGTH = 128;

function isPositiveSafeInteger(value: unknown): boolean {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= 1
  );
}

function hasDistinctProductIds(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return true;
  }

  const productIds = value.flatMap((item: unknown) => {
    if (typeof item !== "object" || item === null) {
      return [];
    }

    const productId = (item as Record<string, unknown>).productId;

    return typeof productId === "string"
      ? [productId.normalize("NFC")]
      : [];
  });

  return new Set(productIds).size === productIds.length;
}

function hasOnlyAllowedItemFields(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return true;
  }

  return Object.keys(value).every(
    (field) => field === "productId" || field === "quantity"
  );
}

const createOrderBodyValidators = [
  body("items")
    .exists({ values: "undefined" })
    .withMessage("Os itens são obrigatórios.")
    .bail()
    .isArray({ min: 1, max: environment.order.maxDistinctItems })
    .withMessage(
      `Os itens devem formar um array com 1 a ${environment.order.maxDistinctItems} produtos distintos.`
    )
    .bail()
    .custom(hasDistinctProductIds)
    .withMessage("O mesmo productId não pode aparecer mais de uma vez."),
  body("items.*")
    .custom(hasOnlyAllowedItemFields)
    .withMessage("O item contém campo não permitido."),
  body("items.*.productId")
    .exists({ values: "undefined" })
    .withMessage("O productId é obrigatório em cada item.")
    .bail()
    .isString()
    .withMessage("O productId deve ser uma string não vazia.")
    .bail()
    .custom(isNonBlankString)
    .withMessage("O productId deve ser uma string não vazia.")
    .bail()
    .isLength({ max: MAX_PRODUCT_ID_LENGTH })
    .withMessage(
      `O productId deve possuir no máximo ${MAX_PRODUCT_ID_LENGTH} caracteres.`
    ),
  body("items.*.quantity")
    .exists({ values: "undefined" })
    .withMessage("A quantidade é obrigatória em cada item.")
    .bail()
    .custom(isPositiveSafeInteger)
    .withMessage("A quantidade deve ser um inteiro maior que zero.")
];

export const createOrderValidators = [
  createIdempotencyKeyValidator(),
  checkExact(createOrderBodyValidators, {
    locations: ["body"],
    message: "O campo não é permitido."
  })
];
