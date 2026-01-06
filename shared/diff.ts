// shared/diff.ts

import type { SignalEnvelope } from "./signal";

/**
 * Increment only on breaking changes.
 */
export const DIFF_SCHEMA_VERSION = 1;

export type Severity = "info" | "warn" | "critical";

export type FindingCategory =
  | "routing"
  | "security"
  | "cache"
  | "headers"
  | "content"
  | "timing"
  | "platform"
  | "unknown";

/**
 * Generic “changed value” representation.
 * Deterministic and easy to snapshot-test.
 */
export type Change<T> = {
  left?: T;
  right?: T;
  changed: boolean;
};

export const unchanged = <T>(value: T): Change<T> => ({
  left: value,
  right: value,
  changed: false
});

export const changed = <T>(left: T | undefined, right: T | undefined): Change<T> => ({
  left,
  right,
  changed: true
});

/**
 * Deterministic header diff model.
 * Keys MUST be lowercase.
 *
 * For changed headers:
 *   changed["cache-control"] = { left: "...", right: "...", changed: true }
 */
export type HeaderMap = Record<string, string>;

export type HeaderDiff = {
  added: HeaderMap; // present only on right
  removed: HeaderMap; // present only on left
  changed: Record<string, Change<string>>; // present both, values differ
  unchanged: HeaderMap; // present both, same value
};

export type RedirectHop = {
  fromUrl: string;
  toUrl: string;
  status: number;
};

export type RedirectDiff = {
  // Chains as recorded (or empty array if not present)
  left: RedirectHop[];
  right: RedirectHop[];

  hopCount: Change<number>;
  finalUrlFromRedirects?: Change<string>; // optional if you compute it

  /**
   * True if left/right redirect paths are structurally different.
   * Deterministically computed (e.g., compare hop-by-hop).
   */
  chainChanged: boolean;
};

export type ContentDiff = {
  contentType?: Change<string>;
  contentLength?: Change<number>;
  bodyHash?: Change<string>;
};

export type TimingDiff = {
  durationMs?: Change<number>;

  /**
   * Optional derived metrics to make “timing drift” more meaningful.
   * Keep deterministic. Example:
   *   ratio = right/left (or undefined)
   */
  ratio?: number;
  deltaMs?: number;
};

export type CfContextDiff = {
  colo?: Change<string>;
  country?: Change<string>;
  asn?: Change<number>;
  asOrganization?: Change<string>;
  tlsVersion?: Change<string>;
  httpProtocol?: Change<string>;
};

/**
 * Findings are deterministic classifications produced by B2
 * (NOT the LLM explanation).
 */
export type DiffFindingCode =
  | "STATUS_MISMATCH"
  | "FINAL_URL_MISMATCH"
  | "REDIRECT_CHAIN_CHANGED"
  | "CACHE_HEADER_DRIFT"
  | "CORS_HEADER_DRIFT"
  | "AUTH_CHALLENGE_PRESENT"
  | "CONTENT_TYPE_DRIFT"
  | "BODY_HASH_DRIFT"
  | "CONTENT_LENGTH_DRIFT"
  | "TIMING_DRIFT"
  | "CF_CONTEXT_DRIFT"
  | "PROBE_FAILURE"
  | "UNKNOWN_DRIFT";

export type DiffEvidence = {
  // Deterministic pointers into the structured diff, not free-form JSON paths.
  // Example: { section: "headers", keys: ["cache-control"] }
  section:
    | "status"
    | "finalUrl"
    | "headers"
    | "redirects"
    | "content"
    | "timing"
    | "cf"
    | "probe";
  keys?: string[];
  note?: string;
};

export type DiffFinding = {
  code: DiffFindingCode;
  category: FindingCategory;
  severity: Severity;

  /**
   * Short deterministic message (non-LLM).
   * Example: "cache-control differs"
   */
  message: string;

  evidence?: DiffEvidence[];

  /**
   * Small deterministic recommendations list.
   * The LLM can later expand these into richer “next steps”.
   */
  recommendations?: string[];
};

/**
 * When probes fail, we still want a deterministic diff.
 * This captures top-level probe outcomes.
 */
export type ProbeOutcomeDiff = {
  leftOk?: boolean;
  rightOk?: boolean;

  /**
   * If a probe failed, capture stable error codes (if available),
   * not raw exception strings.
   */
  leftErrorCode?: string;
  rightErrorCode?: string;

  /**
   * If one side failed and the other succeeded, that is drift.
   */
  outcomeChanged: boolean;
};

export type EnvDiff = {
  schemaVersion: typeof DIFF_SCHEMA_VERSION;

  /**
   * Correlates the diff to a comparison run.
   */
  comparisonId: string;

  /**
   * For reproducibility/debug, include probe IDs used.
   */
  leftProbeId: string;
  rightProbeId: string;

  /**
   * Deterministic high-level probe state.
   */
  probe: ProbeOutcomeDiff;

  /**
   * Structured, deterministic diffs.
   * Sections may be omitted if not available (e.g., probe failure).
   */
  status?: Change<number>;
  finalUrl?: Change<string>;

  headers?: {
    core: HeaderDiff;
    accessControl?: HeaderDiff;
  };

  redirects?: RedirectDiff;

  content?: ContentDiff;

  timing?: TimingDiff;

  cf?: CfContextDiff;

  /**
   * Deterministic findings derived from the above sections.
   * Output should be in stable order (e.g., by severity then code).
   */
  findings: DiffFinding[];

  /**
   * Useful for UI ordering.
   */
  maxSeverity: Severity;
};

/**
 * Optional type: the canonical deterministic compare artifact.
 * (You can also define this in shared/api.ts and import EnvDiff there.)
 */
export type DeterministicCompareArtifact = {
  left: SignalEnvelope;
  right: SignalEnvelope;
  diff: EnvDiff;
};
