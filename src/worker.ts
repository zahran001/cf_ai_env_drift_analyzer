// Main Worker entry point
// Routes incoming requests to API handlers

import { router } from "./api/routes";
import type { Env } from "./env";
import { CompareEnvironments } from "./workflows/compareEnvironments";
import { EnvPairDO } from "./storage/envPairDO";

export { CompareEnvironments, EnvPairDO };

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    return router(request, env);
  },
};
