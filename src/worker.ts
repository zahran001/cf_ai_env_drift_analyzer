// Main Worker entry point
// Routes incoming requests to API handlers

import { router } from "./api/routes";
import type { Env } from "./env";
export { CompareEnvironments } from "./workflows/compareEnvironments";
export { EnvPairDO } from "./storage/envPairDO";

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    return router(request, env);
  },
};
