import type EnvPairDO from "./storage/envPairDO";

/**
 * Cloudflare Worker Env interface.
 * Bindings from wrangler.toml.
 */
export interface Env {
  // Durable Objects binding with RPC enabled
  ENVPAIR_DO: DurableObjectNamespace<EnvPairDO>;

  // Environment name (development, staging, production)
  ENVIRONMENT: "development" | "staging" | "production";
}
