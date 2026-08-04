import { Router } from "express";
import swaggerUi from "swagger-ui-express";

import { openApiDocument } from "../openapi/openapi.document";

export function createDocumentationRouter(): Router {
  const router = Router();

  router.get("/openapi.json", (_request, response) => {
    response.status(200).json(openApiDocument);
  });

  router.use(
    "/docs",
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
      customCss: ".swagger-ui .topbar { display: none; }",
      customSiteTitle: "CaseCellShop API",
      swaggerOptions: {
        displayRequestDuration: true,
        filter: true,
        tryItOutEnabled: true
      }
    })
  );

  return router;
}
