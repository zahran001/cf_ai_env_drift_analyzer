// shared/diff.ts

import type { SignalEnvelope, RedirectHop } from "./signal";

// Re-export for convenience
export type { SignalEnvelope } from "./signal";

/**
 * Increment only on breaking changes.
 */
export const DIFF_SCHEMA_VERSION = 1;

export type Severity = "info" | "warn" | "critical";

export type FindingCategory =
  | "routing"
  | "security"
  | "cache"
  | "content"
  | "timing"
  | "platform"
  | "unknown";

/**
 * Generic "changed value" representation.
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
/**
 * Finding codes emitted by the deterministic classifier (Phase B2).
 * Keep this list in sync with Phase-B2.md.
 */
export const FINDING_CODES = [
  "PROBE_FAILURE",
  "STATUS_MISMATCH",
  "FINAL_URL_MISMATCH",
  "REDIRECT_CHAIN_CHANGED",
  "AUTH_CHALLENGE_PRESENT",
  "CORS_HEADER_DRIFT",
  "CACHE_HEADER_DRIFT",
  "CONTENT_TYPE_DRIFT",
  "BODY_HASH_DRIFT",
  "CONTENT_LENGTH_DRIFT",
  "TIMING_DRIFT",
  "CF_CONTEXT_DRIFT",
  "UNKNOWN_DRIFT",
] as const;

export type DiffFindingCode = (typeof FINDING_CODES)[number];

/**
 * Mirrors the allowlisted core headers in shared/signal.ts.
 * Keys MUST be lowercase.
 */
export type CoreHeaderKey =
  | "cache-control"
  | "content-type"
  | "vary"
  | "www-authenticate"
  | "location";

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

/**
 * Deterministic header diff model.
 * Keys MUST be lowercase.
 *
 * Generic type allows strong typing for core headers while keeping
 * access-control headers flexible (Record<string, ...>).
 */
export type HeaderDiff<K extends string = string> = {
  added: Partial<Record<K, string>>; // present only on right
  removed: Partial<Record<K, string>>; // present only on left
  changed: Partial<Record<K, Change<string>>>; // present both, values differ
  unchanged: Partial<Record<K, string>>; // present both, same value
};

export type DiffFinding = {
  /**
   * Stable identifier for this finding within a diff.
   * Recommended format: `${code}:${section}:${keysJoined}`.
   */
  id: string;

  code: DiffFindingCode;
  category: FindingCategory;
  severity: Severity;

  /**
   * Short deterministic message (non-LLM).
   * Example: "cache-control differs"
   */
  message: string;

  /**
   * Optional raw values for UI/debugging and future prompting.
   * Keep these small and deterministic.
   */
  left_value?: unknown;
  right_value?: unknown;

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
 *
 * In the comparison pipeline, left and right envelopes are always
 * present once created, so leftOk and rightOk are required.
 */
export type ProbeOutcomeDiff = {
  leftOk: boolean;
  rightOk: boolean;

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
    core: HeaderDiff<CoreHeaderKey>;
    accessControl?: HeaderDiff<string>;
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

/**
 * Helper: Compute a deduplication key for a finding.
 * Key: (code, first_evidence_section, sorted_evidence_keys)
 */
export function computeDedupKey(finding: DiffFinding): string {
  const sortedKeys = finding.evidence
    ?.flatMap((ev) => ev.keys ?? [])
    .sort() ?? [];
  return `${finding.code}:${finding.evidence?.[0]?.section}:${sortedKeys.join(
    ","
  )}`;
}

/**
 * Helper: Deduplicate findings by (code, section, keys).
 * Keeps first occurrence, discards duplicates.
 */
export function deduplicateFindings(findings: DiffFinding[]): DiffFinding[] {
  const seen = new Map<string, DiffFinding>();

  for (const finding of findings) {
    const key = computeDedupKey(finding);
    if (!seen.has(key)) {
      seen.set(key, finding);
    }
  }

  return Array.from(seen.values());
}

const SEVERITY_ORDER = { critical: 0, warn: 1, info: 2 } as const;

/**
 * Helper: Sort findings by (severity DESC, code ASC, message ASC).
 * Deterministic ordering for consistent UI and snapshots.
 *
 * IMPORTANT: This function sorts the input array in-place using Array.sort().
 * The returned array is the same reference as the input. If immutability is required,
 * pass a copy instead (e.g., `sortFindings([...findings])`).
 */
export function sortFindings(findings: DiffFinding[]): DiffFinding[] {
  return findings.sort((a, b) => {
    const sevA = SEVERITY_ORDER[a.severity];
    const sevB = SEVERITY_ORDER[b.severity];
    if (sevA !== sevB) return sevA - sevB;

    const codeComp = a.code.localeCompare(b.code);
    if (codeComp !== 0) return codeComp;

    return a.message.localeCompare(b.message);
  });
}

/**
 * Helper: Compute max severity from findings.
 * critical > warn > info
 */
export function computeMaxSeverity(findings: DiffFinding[]): Severity {
  if (findings.length === 0) return "info";

  for (const finding of findings) {
    if (finding.severity === "critical") return "critical";
  }

  for (const finding of findings) {
    if (finding.severity === "warn") return "warn";
  }

  return "info";
}
