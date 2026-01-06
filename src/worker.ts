// Main Worker entry point
// Routes incoming requests to API handlers

import { router } from "./api/routes";

export default {
  async fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> {
    return router(request);
  }
};
