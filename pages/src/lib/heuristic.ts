/**
 * Heuristic progress messaging based on elapsed time during polling.
 * Messages transition as the poll progresses, giving users visibility into
 * different backend phases without requiring backend-driven status updates.
 *
 * Phase 0 (0–2s): Initializing — Starting workflow, creating DO record
 * Phase 1 (2–5s): Probing — Running ActiveProbe on left and right URLs
 * Phase 2 (5–8s): Analyzing — Computing EnvDiff, calling LLM
 * Phase 3 (8–10s): Finalizing — Persisting results to DO
 * Phase 4 (>10s): Stuck — Unusual delay, suggest checking backend
 */

export function getHeuristicProgress(elapsedMs: number): string {
  if (elapsedMs < 2000) {
    return "Initializing comparison…";
  }
  if (elapsedMs < 5000) {
    return "Probing environments…";
  }
  if (elapsedMs < 8000) {
    return "Analyzing drift & generating explanation…";
  }
  if (elapsedMs > 10000) {
    return "Taking longer than usual…";
  }
  return "Processing…";
}
