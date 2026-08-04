import { checkExact } from "express-validator";

import { createIdParamValidator } from "./common.validator";

export const getOrderByIdValidators = [
  checkExact([createIdParamValidator()], {
    locations: ["params"],
    message: "O parâmetro de rota não é permitido."
  })
];
