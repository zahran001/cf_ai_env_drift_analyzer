/**
 * Workflow: CompareEnvironments
 *
 * Responsibility: Orchestrate the 11-step comparison pipeline.
 *
 * IDEMPOTENCY RULES:
 * - comparisonId is stable (passed from Worker, not generated here)
 * - Probe IDs are deterministic: ${comparisonId}:${side}
 * - All step.do() calls receive stable, deterministic inputs
 * - DO methods use INSERT OR REPLACE for idempotent retries
 * - If Workflow step fails and retries:
 *   Same inputs → same probe IDs → DO upserts instead of duplicates
 *
 * RPC-ENABLED DO CALLS:
 * - stub.createComparison(args) works directly via RPC
 * - stub.saveProbe(args) works directly via RPC
 * - stub.getComparison(id) works directly via RPC
 * - (If RPC disabled, switch to stub.fetch() HTTP router)
 *
 * Per CLAUDE.md 2.2 Workflow Orchestration:
 * Execution steps (in order):
 * 1. Validate inputs and compute pairKey
 * 2. DO: createComparison → comparisonId, status = running
 * 3. Probe left URL → SignalEnvelope
 * 4. DO: saveProbe(comparisonId, "left", envelope)
 * 5. Probe right URL → SignalEnvelope
 * 6. DO: saveProbe(comparisonId, "right", envelope)
 * 7. Compute deterministic EnvDiff
 * 8. Load history (optional)
 * 9. Call Workers AI with diff, history → LLM explanation JSON
 * 10. Validate LLM output
 * 11. DO: saveResult(comparisonId, resultJson), status = completed
 * 12. On error: DO: failComparison(comparisonId, errorMessage)
 */

import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import type { CfContextSnapshot, FrozenSignalEnvelope } from "@shared/signal";
import type { Env } from "../env";
import { activeProbeProvider } from "../providers/activeProbe";
import { computeDiff } from "../analysis/diff";
import { explainDiff } from "../llm/explain";

export interface CompareEnvironmentsInput {
  comparisonId: string;
  leftUrl: string;
  rightUrl: string;
  pairKey: string;
  runnerContext: CfContextSnapshot;
}

/**
 * Workflow class for environment comparison.
 *
 * Extends WorkflowEntrypoint with Env binding and CompareEnvironmentsInput payload.
 * Called via: env.COMPARE_WORKFLOW.create({ id, payload: input })
 */
export class CompareEnvironments extends WorkflowEntrypoint<Env, CompareEnvironmentsInput> {
  /**
   * Main workflow entrypoint.
   *
   * @param event - WorkflowEvent containing the payload
   * @param step - Workflow step context (for step.do, step.sleep, etc.)
   * @returns Workflow completion result
   */
  async run(
    event: WorkflowEvent<CompareEnvironmentsInput>,
    step: WorkflowStep
  ): Promise<{ comparisonId: string; status: string }> {
    const input = event.payload;
    const env = this.env;

    console.log(`[Workflow::run] 🚀 WORKFLOW STARTED`);
    console.log(`[Workflow::run] Input received:`, JSON.stringify(input));
    console.log(`[Workflow::run] Input keys:`, Object.keys(input));

    const { comparisonId, leftUrl, rightUrl, pairKey, runnerContext } = input;
    console.log(`[Workflow::run] Destructured - comparisonId=${comparisonId}, pairKey=${pairKey}`);

    try {
      // ===== STEP 1: Validate Inputs (Local, No Network) =====

      console.log(`[Workflow] Validating inputs...`);
      if (!comparisonId || !leftUrl || !rightUrl || !pairKey) {
        throw new Error("Missing required parameters");
      }

      console.log(`[Workflow] All inputs valid`);
      console.log(`[Workflow] Starting comparison ${comparisonId} for ${leftUrl} <-> ${rightUrl}`);

      // ===== STEP 2: Create Comparison Record in DO =====

      const createResult = await step.do("createComparison", async () => {
        const doId = env.ENVPAIR_DO.idFromName(pairKey);
        const stub = env.ENVPAIR_DO.get(doId);
        // ✅ RPC-enabled: direct method call
        return (stub as any).createComparison(comparisonId, leftUrl, rightUrl);
      });

      console.log(`[Workflow] Comparison ${comparisonId} created, status=${createResult.status}`);

      // ===== STEP 3: Probe Left URL =====

      let leftEnvelope: FrozenSignalEnvelope;
      try {
        leftEnvelope = await step.do("probeLeft", async () => {
          const result = await activeProbeProvider.probe(leftUrl, runnerContext);
          return result as any;
        });
        if (!leftEnvelope) {
          throw new Error("probeLeft returned empty result");
        }
      } catch (err) {
        // Fail comparison on probe error
        await step.do("failLeft", async () => {
          const doId = env.ENVPAIR_DO.idFromName(pairKey);
          const stub = env.ENVPAIR_DO.get(doId);
          return (stub as any).failComparison(
            comparisonId,
            `Left probe failed: ${String(err)}`
          );
        });
        throw err;
      }

      // ===== STEP 4: Save Left Probe =====
      // ✅ IDEMPOTENT: probe ID = ${comparisonId}:left (same every time)

      await step.do("saveLeftProbe", async () => {
        const doId = env.ENVPAIR_DO.idFromName(pairKey);
        const stub = env.ENVPAIR_DO.get(doId);
        return (stub as any).saveProbe(comparisonId, "left", leftEnvelope);
      });

      // ===== STEP 5: Probe Right URL =====

      let rightEnvelope: FrozenSignalEnvelope;
      try {
        rightEnvelope = await step.do("probeRight", async () => {
          const result = await activeProbeProvider.probe(rightUrl, runnerContext);
          return result as any;
        });
        if (!rightEnvelope) {
          throw new Error("probeRight returned empty result");
        }
      } catch (err) {
        // Fail comparison on probe error
        await step.do("failRight", async () => {
          const doId = env.ENVPAIR_DO.idFromName(pairKey);
          const stub = env.ENVPAIR_DO.get(doId);
          return (stub as any).failComparison(
            comparisonId,
            `Right probe failed: ${String(err)}`
          );
        });
        throw err;
      }

      // ===== STEP 6: Save Right Probe (idempotent) =====

      await step.do("saveRightProbe", async () => {
        const doId = env.ENVPAIR_DO.idFromName(pairKey);
        const stub = env.ENVPAIR_DO.get(doId);
        return (stub as any).saveProbe(comparisonId, "right", rightEnvelope);
      });

      // ===== STEP 7: Compute Diff (Deterministic, Local) =====

      const diff = computeDiff(leftEnvelope, rightEnvelope);

      console.log(
        `[Workflow] Diff computed for ${comparisonId}: ${diff.findings.length} findings`
      );

      // ===== STEP 8: Load History (Truly Optional, For LLM Context) =====

      const history = await step.do("loadHistory", async () => {
        try {
          const doId = env.ENVPAIR_DO.idFromName(pairKey);
          const stub = env.ENVPAIR_DO.get(doId);
          return await (stub as any).getComparisonsForHistory(5);
        } catch (err) {
          console.warn(`[Workflow] loadHistory failed (non-fatal): ${String(err)}`);
          return [];
        }
      });

      // ===== STEP 9: Call LLM (Retry Loop, Max 3 Attempts) =====

      let explanation: unknown;
      let llmAttempts = 0;
      const MAX_LLM_ATTEMPTS = 3;

      while (llmAttempts < MAX_LLM_ATTEMPTS) {
        try {
          explanation = await step.do(
            `explainDiff_attempt_${llmAttempts + 1}`,
            async () => {
              return explainDiff(diff, history, env.AI);
            }
          );
          console.log(`[Workflow] LLM explanation generated for ${comparisonId}`);
          break; // Success
        } catch (err) {
          llmAttempts++;
          const errMsg = String(err);
          console.warn(
            `[Workflow] LLM attempt ${llmAttempts}/${MAX_LLM_ATTEMPTS} failed: ${errMsg}`
          );

          if (llmAttempts >= MAX_LLM_ATTEMPTS) {
            // All retries exhausted
            await step.do("failLLM", async () => {
              const doId = env.ENVPAIR_DO.idFromName(pairKey);
              const stub = env.ENVPAIR_DO.get(doId);
              return (stub as any).failComparison(
                comparisonId,
                `LLM service unavailable after ${MAX_LLM_ATTEMPTS} attempts: ${errMsg}`
              );
            });
            throw err;
          }

          // Exponential backoff: 2^attempt seconds (1s, 2s, 4s)
          const backoffMs = Math.pow(2, llmAttempts) * 1000;
          console.log(`[Workflow] Backing off ${backoffMs}ms before retry`);
          await step.sleep(`backoff_${llmAttempts}`, backoffMs);
        }
      }

      // ===== STEP 10: Validate LLM Output =====
      // (Validation happens inside explainDiff, this is just a safety check)

      if (!explanation) {
        throw new Error("LLM explanation is null after retries");
      }

      // ===== STEP 11: Save Result =====
      // ✅ IDEMPOTENT: no Date.now() or other non-deterministic values
      // The DO handles createdAt timestamp once in createComparison
      // Retries will upsert the same result without changing the stored timestamp

      await step.do("saveResult", async () => {
        const doId = env.ENVPAIR_DO.idFromName(pairKey);
        const stub = env.ENVPAIR_DO.get(doId);
        return (stub as any).saveResult(comparisonId, {
          diff,
          explanation,
        });
      });

      console.log(`[Workflow] Comparison ${comparisonId} completed`);

      return {
        comparisonId,
        status: "completed",
      };
    } catch (err) {
      // ===== STEP 12: Error Handler (Any Step Failure) =====

      const errorMessage = String(err);
      console.error(
        `[Workflow] Comparison ${comparisonId} failed: ${errorMessage}`
      );

      // Mark as failed in DO (if not already marked)
      try {
        await step.do("failWorkflow", async () => {
          const doId = env.ENVPAIR_DO.idFromName(pairKey);
          const stub = env.ENVPAIR_DO.get(doId);
          return (stub as any).failComparison(comparisonId, errorMessage);
        });
      } catch (doErr) {
        console.error(`[Workflow] Failed to mark comparison as failed: ${doErr}`);
      }

      // Re-throw to mark workflow as failed
      throw new Error(`Comparison failed: ${errorMessage}`);
    }
  }
}
