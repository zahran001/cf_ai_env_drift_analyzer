import type EnvPairDO from "./storage/envPairDO";

/**
 * Cloudflare Worker Env interface.
 * Bindings from wrangler.toml.
 */
export interface Env {
  // Durable Objects binding with RPC enabled
  ENVPAIR_DO: DurableObjectNamespace<EnvPairDO>;

  // Workers AI binding for LLM integration (Llama 3.3)
  AI: Ai;
}
