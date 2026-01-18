import type EnvPairDO from "./storage/envPairDO";
import type { CompareEnvironmentsInput } from "./workflows/compareEnvironments";

/**
 * Cloudflare Worker Env interface.
 * Bindings from wrangler.toml.
 */
export interface Env {
  // Durable Objects binding with RPC enabled
  ENVPAIR_DO: DurableObjectNamespace<EnvPairDO>;

  // Workers AI binding for LLM integration (Llama 3.3)
  AI: Ai;

  // Workflows binding for comparison orchestration
  COMPARE_WORKFLOW: Workflow<CompareEnvironmentsInput>;
}
