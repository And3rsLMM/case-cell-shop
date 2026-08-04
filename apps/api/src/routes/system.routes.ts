import { Router } from "express";

import {
  createHealthController,
  createReadyController
} from "../controllers/system.controller";
import type { ReadinessService } from "../services/readiness.service";

interface SystemRouterDependencies {
  now: () => Date;
  readinessService: ReadinessService;
}

export function createSystemRouter(
  dependencies: SystemRouterDependencies
): Router {
  const router = Router();

  router.get("/health", createHealthController(dependencies.now));
  router.get("/ready", createReadyController(dependencies.readinessService));

  return router;
}
