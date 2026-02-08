import type { SignalEnvelope } from "./signal";
import type { EnvDiff } from "./diff";
import type { LlmExplanation } from "./llm";

export type CompareRequest = {
  leftUrl: string;
  rightUrl: string;

  // Purely UI-facing labels; do not affect analysis.
  leftLabel?: string;
  rightLabel?: string;

  // Reserved for future tuning (timeouts, redirect limit, etc.)
  // options?: CompareOptions;
};

export type CompareStartResponse = {
  comparisonId: string;
};

/**
 * Add "queued" now to avoid breaking changes once Workflows/DO scheduling is real.
 */
export type CompareStatus = "queued" | "running" | "completed" | "failed";

/**
 * Stable error codes for UX + debugging.
 * Keep this small in MVP; expand later as needed.
 */
export type CompareErrorCode =
  | "invalid_request"
  | "invalid_url"
  | "ssrf_blocked"
  | "timeout"
  | "dns_error"
  | "tls_error"
  | "fetch_error"
  | "internal_error";

export type CompareError = {
  code: CompareErrorCode;
  message: string;

  /**
   * Optional, safe-to-display metadata (no secrets).
   * Example: { timeoutMs: 10000 } or { blockedHost: "127.0.0.1" }
   */
  details?: Record<string, unknown>;
};

/**
 * Canonical poll response shape.
 * - When status === "completed": result is present.
 * - When status === "failed": error is present.
 */
export type CompareStatusResponse<ResultT = CompareResult> = {
  status: CompareStatus;
  result?: ResultT;
  error?: CompareError;
};

/**
 * Canonical comparison output (filled out across phases).
 *
 * Fields are populated progressively by the backend:
 * - Phase B1: comparisonId, leftUrl, rightUrl, labels
 * - Phase B2: left, right (SignalEnvelope), diff (EnvDiff)
 * - Phase B3: explanation (LlmExplanation)
 *
 * All complex fields remain optional because the backend may not
 * populate them until later phases are complete.
 */
export type CompareResult = {
  comparisonId: string;

  leftLabel?: string;
  rightLabel?: string;

  leftUrl: string;
  rightUrl: string;

  left?: SignalEnvelope;
  right?: SignalEnvelope;
  diff?: EnvDiff;
  explanation?: LlmExplanation;
};
