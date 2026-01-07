# Phase B2 Design Decisions & Implementation Guide

**Status:** Pre-Implementation Analysis
**Target:** Define all ambiguities before writing `classify.ts`
**Authority:** Phase-B2.md + CLAUDE.md + shared/diff.ts

---

## 1. Evidence Key Vocabulary Runtime Validation

### Issue
Phase-B2.md §1.3 defines **canonical key vocabularies per section**, but TypeScript has no constraint enforcement. A finding like `{ section: "finalUrl", keys: ["invalid_key"] }` would pass type-checking.

### Design Decision: Create ValidEvidenceKeys Type

**Option A: Strict Union Type (Recommended)**
```typescript
// shared/diff.ts

export type ValidEvidenceKeysBySection = {
  probe: undefined | "left" | "right";
  status: undefined;
  finalUrl: undefined | "scheme" | "host" | "path" | "query" | "finalUrl";
  redirects: undefined | "hopCount" | "chain" | "finalHost";
  headers: string[]; // lowercased header names (dynamic, validated at runtime)
  content: undefined | "content-type" | "content-length" | "body-hash";
  timing: undefined | "duration_ms";
  cf: undefined | "colo" | "asn" | "country";
};

export type ValidDiffEvidence<S extends DiffEvidence["section"] = DiffEvidence["section"]> =
  S extends keyof ValidEvidenceKeysBySection
    ? Omit<DiffEvidence, "keys"> & { keys?: ValidEvidenceKeysBySection[S] }
    : DiffEvidence;
```

**Implementation Notes:**
- For `headers` and `cf`, keys can be arrays/sets — cannot fully constrain at type level
- Add runtime validator in `classify.ts` to catch malformed evidence during testing

**Option B: Simple Validation Function (Pragmatic)**
```typescript
export function isValidEvidenceKey(section: DiffEvidence["section"], key: string): boolean {
  const valid: Record<string, Set<string>> = {
    probe: new Set(["left", "right"]),
    status: new Set([]),
    finalUrl: new Set(["scheme", "host", "path", "query", "finalUrl"]),
    redirects: new Set(["hopCount", "chain", "finalHost"]),
    headers: new Set(), // all lowercase header names allowed
    content: new Set(["content-type", "content-length", "body-hash"]),
    timing: new Set(["duration_ms"]),
    cf: new Set(["colo", "asn", "country"]),
  };

  if (!valid[section]) return false;
  if (section === "headers") return key.toLowerCase() === key; // lowercase validation
  if (section === "cf") return valid[section]?.has(key) ?? false;
  return valid[section]?.has(key) ?? false;
}

export function validateDiffEvidence(evidence: DiffEvidence): boolean {
  if (!evidence.keys) return true; // undefined keys are valid
  return evidence.keys.every(key => isValidEvidenceKey(evidence.section, key));
}
```

### Recommendation
**Use Option B** for MVP: simpler to implement, easier to debug at runtime, clearer error messages.

---

## ✅ DECISION MADE (2026-01-07): Option B — Soft Correlation

**Status:** RESOLVED — See PHASE_B2_OPEN_DECISION.md for full context.

**Implementation:** Always emit CF_CONTEXT_DRIFT if CF context differs, but severity depends on timing drift presence:
- Severity = `warn` if TIMING_DRIFT is also present
- Severity = `info` if no timing drift

**Rationale:** Infrastructure visibility; users see colo/ASN changes even if they haven't impacted performance yet.

---

## 2. Evidence Deduplication & ID Generation

### Issue
Phase-B2.md §1.4 requires findings to be deduplicated by `(code, section, sorted keys)`, but there's no formalized logic in code.

### Design Decision: Formalize Dedup Key Computation

**In shared/diff.ts:**
```typescript
/**
 * Compute a deterministic deduplication key for a finding.
 * Used to collapse duplicate findings before final output.
 *
 * Format: ${code}:${section}:${sortedKeyString}
 * Example: "CORS_HEADER_DRIFT:headers:access-control-allow-credentials,access-control-allow-origin"
 */
export function computeFindingDeduplicateKey(
  code: DiffFindingCode,
  evidenceSection: DiffEvidence["section"],
  keys: string[] | undefined
): string {
  const sortedKeys = (keys ?? []).sort().join(",");
  return `${code}:${evidenceSection}:${sortedKeys}`;
}

/**
 * Compute a stable ID for a finding.
 * Used in DiffFinding.id field.
 *
 * Format: ${code}:${section}:${sortedKeyString}
 * (Same as deduplication key for determinism)
 */
export function computeFindingId(
  code: DiffFindingCode,
  evidence?: DiffEvidence[]
): string {
  if (!evidence || evidence.length === 0) {
    return `${code}:unknown:`;
  }
  // Use first evidence item as primary (typically only one per finding)
  const primary = evidence[0];
  return computeFindingDeduplicateKey(code, primary.section, primary.keys);
}
```

**In classify.ts:**
```typescript
// Before returning findings, deduplicate
const uniqueFindings = new Map<string, DiffFinding>();
for (const finding of rawFindings) {
  const dedupeKey = computeFindingDeduplicateKey(finding.code, finding.evidence?.[0]?.section ?? "unknown", finding.evidence?.[0]?.keys);
  if (!uniqueFindings.has(dedupeKey)) {
    uniqueFindings.set(dedupeKey, finding);
  }
}
const deduplicatedFindings = Array.from(uniqueFindings.values());
```

### Recommendation
**Implement both helpers in shared/diff.ts**. They're small, deterministic, and essential for correctness.

---

## 3. Finding Generation Rule Registry

### Issue
Phase-B2.md §4 defines 14 rule groups with specific triggers, severity logic, and message templates. These are currently prose-only. Risk: manual translation → bugs.

### Design Decision: Create Rule Definition Structure

**Option A: Full Rule Registry (Comprehensive)**
```typescript
// src/analysis/rules.ts

export type FindingRuleDefinition = {
  code: DiffFindingCode;
  category: FindingCategory;
  description: string;
  triggers: Array<{
    name: string; // e.g., "A1", "A2"
    description: string;
    condition: string; // human-readable
  }>;
};

export const FINDING_RULE_REGISTRY: Record<DiffFindingCode, FindingRuleDefinition> = {
  PROBE_FAILURE: {
    code: "PROBE_FAILURE",
    category: "unknown",
    description: "One or both probes failed to complete",
    triggers: [
      {
        name: "A1",
        description: "Both probes failed",
        condition: "probe.leftOk === false && probe.rightOk === false"
      },
      {
        name: "A2",
        description: "One probe failed, one succeeded",
        condition: "probe.outcomeChanged === true"
      }
    ]
  },
  // ... 12 more codes
} as const;
```

**Option B: Minimal Registry (Practical)**
```typescript
// In shared/diff.ts or src/analysis/constants.ts

export const FINDING_RULE_MAP: Record<DiffFindingCode, { category: FindingCategory; description: string }> = {
  PROBE_FAILURE: { category: "unknown", description: "One or both probes failed" },
  STATUS_MISMATCH: { category: "routing", description: "HTTP status codes differ" },
  FINAL_URL_MISMATCH: { category: "routing", description: "Final URLs differ" },
  REDIRECT_CHAIN_CHANGED: { category: "routing", description: "Redirect chain changed" },
  AUTH_CHALLENGE_PRESENT: { category: "security", description: "www-authenticate header differs" },
  CORS_HEADER_DRIFT: { category: "security", description: "CORS headers differ" },
  CACHE_HEADER_DRIFT: { category: "cache", description: "Cache-control differs" },
  CONTENT_TYPE_DRIFT: { category: "content", description: "Content-Type differs" },
  BODY_HASH_DRIFT: { category: "content", description: "Response body differs" },
  CONTENT_LENGTH_DRIFT: { category: "content", description: "Content length differs" },
  TIMING_DRIFT: { category: "timing", description: "Response timing differs" },
  CF_CONTEXT_DRIFT: { category: "platform", description: "Cloudflare context differs" },
  UNKNOWN_DRIFT: { category: "unknown", description: "Unclassified drift detected" },
} as const;
```

### Recommendation
**Use Option B for MVP**. It's lightweight, easy to audit against Phase-B2.md, and provides enough structure for testing. Move to Option A in Phase B3+ if needed for richer rule composition.

---

## 4. Timing Drift Constants

### Issue
Phase-B2.md §3 defines 5 thresholds but they're not in code yet, risking hardcoding drift.

### Design Decision: Create Timing Constants

**In shared/diff.ts or src/analysis/constants.ts:**
```typescript
/**
 * Thresholds for timing drift classification.
 * Derived from Phase-B2.md §3.
 * All values in milliseconds except RATIO_* (unitless).
 */
export const TIMING_DRIFT_THRESHOLDS = {
  /** Minimum duration on the slower side to trigger timing drift rules */
  MIN_TIMING_LEFT_MS: 50,

  /** Absolute delta in ms above which timing drift is "warn" severity */
  ABS_DELTA_WARN_MS: 300,

  /** Absolute delta in ms above which timing drift is "critical" severity */
  ABS_DELTA_CRIT_MS: 1000,

  /** Ratio (right/left) above which timing drift is "warn" severity */
  RATIO_WARN: 1.5,

  /** Ratio (right/left) above which timing drift is "critical" severity */
  RATIO_CRIT: 2.5,
} as const;

export type TimingDriftThresholds = typeof TIMING_DRIFT_THRESHOLDS;
```

**Usage in classify.ts:**
```typescript
import { TIMING_DRIFT_THRESHOLDS } from "./constants";

function classifyTimingDrift(left: number, right: number): Severity {
  const max = Math.max(left, right);
  if (max < TIMING_DRIFT_THRESHOLDS.MIN_TIMING_LEFT_MS) {
    return "info"; // too small to care
  }

  const delta = Math.abs(right - left);
  const ratio = Math.max(left, right) / Math.min(left, right);

  if (delta >= TIMING_DRIFT_THRESHOLDS.ABS_DELTA_CRIT_MS || ratio >= TIMING_DRIFT_THRESHOLDS.RATIO_CRIT) {
    return "critical";
  }
  if (delta >= TIMING_DRIFT_THRESHOLDS.ABS_DELTA_WARN_MS || ratio >= TIMING_DRIFT_THRESHOLDS.RATIO_WARN) {
    return "warn";
  }
  return "info";
}
```

### Recommendation
**Implement in shared/diff.ts**. Makes constants auditable, testable, and easy to adjust if Phase-B2.md thresholds change.

---

## 5. Status Code Classification Logic

### Issue
Phase-B2.md §4.B1 defines status mismatch severity as:
- `critical` if 2xx vs 4xx/5xx OR 3xx vs non-3xx
- `warn` otherwise

This logic isn't formalized.

### Design Decision: Create Status Classifier

**In src/analysis/classifiers.ts:**
```typescript
/**
 * Classify HTTP status code differences.
 * Based on Phase-B2.md §4.B1.
 */
export function classifyStatusDrift(left: number, right: number): Severity {
  const leftFamily = Math.floor(left / 100);
  const rightFamily = Math.floor(right / 100);

  // Critical: 2xx vs 4xx/5xx or 3xx vs non-3xx
  if (
    (leftFamily === 2 && (rightFamily === 4 || rightFamily === 5)) ||
    (rightFamily === 2 && (leftFamily === 4 || leftFamily === 5)) ||
    (leftFamily === 3 && rightFamily !== 3) ||
    (rightFamily === 3 && leftFamily !== 3)
  ) {
    return "critical";
  }

  // Otherwise warn
  return "warn";
}
```

### Recommendation
**Create classifiers module** with pure functions for each complex severity decision (status, content-type, cache-control, etc.). Makes logic testable and Phase-B2.md-auditable.

---

## 6. URL Component Parsing for FINAL_URL_MISMATCH

### Issue
Phase-B2.md §4.B2 requires distinguishing scheme/host vs path/query differences with different severities:
- `critical` if scheme or host differs
- `warn` if only path/query differs

Need utility to parse and compare URL components.

### Design Decision: URL Component Extractor

**In src/analysis/urlUtils.ts:**
```typescript
export type UrlComponents = {
  scheme: string;
  host: string;
  path: string;
  query: string;
};

export function parseUrlComponents(url: string): UrlComponents {
  const parsed = new URL(url);
  return {
    scheme: parsed.protocol.replace(":", ""), // "https"
    host: parsed.hostname || "", // includes port
    path: parsed.pathname,
    query: parsed.search,
  };
}

export function classifyUrlDrift(left: string, right: string): { severity: Severity; diffType: string[] } {
  const leftParts = parseUrlComponents(left);
  const rightParts = parseUrlComponents(right);

  const diffs: string[] = [];

  if (leftParts.scheme !== rightParts.scheme) diffs.push("scheme");
  if (leftParts.host !== rightParts.host) diffs.push("host");
  if (leftParts.path !== rightParts.path) diffs.push("path");
  if (leftParts.query !== rightParts.query) diffs.push("query");

  const severity =
    diffs.includes("scheme") || diffs.includes("host")
      ? "critical"
      : diffs.length > 0
      ? "warn"
      : "info";

  return { severity, diffType: diffs };
}
```

### Recommendation
**Implement utility module**. Testable, reusable, and clearly maps to Phase-B2.md rules.

---

## 7. Header Diff Computation (Whitelist Enforcement)

### Issue
Phase-B2.md lists allowlisted headers: `cache-control`, `content-type`, `vary`, `www-authenticate`, `location`, `access-control-*`.

The diff engine must:
1. Only capture whitelisted headers
2. Normalize keys to lowercase
3. Compute added/removed/changed/unchanged categories

### Design Decision: Header Diff Compiler

**In src/analysis/headerDiff.ts:**
```typescript
export type AllowlistedHeader = "cache-control" | "content-type" | "vary" | "www-authenticate" | "location";
export type AccessControlHeader = string; // Must start with "access-control-"

export function isWhitelistedHeader(key: string): key is AllowlistedHeader | AccessControlHeader {
  const lower = key.toLowerCase();
  const coreAllowed: Set<string> = new Set([
    "cache-control",
    "content-type",
    "vary",
    "www-authenticate",
    "location",
  ]);
  return coreAllowed.has(lower) || lower.startsWith("access-control-");
}

export function computeHeaderDiff(
  leftHeaders: Record<string, string> | undefined,
  rightHeaders: Record<string, string> | undefined
): { core: HeaderDiff<CoreHeaderKey>; accessControl?: HeaderDiff<string> } {
  const normLeft = normalizeHeaders(leftHeaders ?? {});
  const normRight = normalizeHeaders(rightHeaders ?? {});

  const coreDiff = computeHeaderDiffForCategory(
    filterHeadersByCategory(normLeft, "core"),
    filterHeadersByCategory(normRight, "core")
  );

  const acHeaders = {
    left: filterHeadersByCategory(normLeft, "accessControl"),
    right: filterHeadersByCategory(normRight, "accessControl"),
  };
  const accessControlDiff =
    Object.keys(acHeaders.left).length > 0 || Object.keys(acHeaders.right).length > 0
      ? computeHeaderDiffForCategory(acHeaders.left, acHeaders.right)
      : undefined;

  return { core: coreDiff, accessControl: accessControlDiff };
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (isWhitelistedHeader(key)) {
      normalized[key.toLowerCase()] = value;
    }
  }
  return normalized;
}

function filterHeadersByCategory(
  headers: Record<string, string>,
  category: "core" | "accessControl"
): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (category === "core" && isCorHeader(key)) {
      filtered[key] = value;
    } else if (category === "accessControl" && key.startsWith("access-control-")) {
      filtered[key] = value;
    }
  }
  return filtered;
}

function isCorHeader(key: string): key is CoreHeaderKey {
  return ["cache-control", "content-type", "vary", "www-authenticate", "location"].includes(key);
}

function computeHeaderDiffForCategory<K extends string>(
  leftHeaders: Record<K, string>,
  rightHeaders: Record<K, string>
): HeaderDiff<K> {
  const result: HeaderDiff<K> = {
    added: {},
    removed: {},
    changed: {},
    unchanged: {},
  };

  const allKeys = new Set([...Object.keys(leftHeaders), ...Object.keys(rightHeaders)]);

  for (const key of allKeys) {
    const leftVal = leftHeaders[key as K];
    const rightVal = rightHeaders[key as K];

    if (leftVal === undefined) {
      result.added![key as K] = rightVal;
    } else if (rightVal === undefined) {
      result.removed![key as K] = leftVal;
    } else if (leftVal === rightVal) {
      result.unchanged![key as K] = leftVal;
    } else {
      result.changed![key as K] = { left: leftVal, right: rightVal, changed: true };
    }
  }

  return result;
}
```

### Recommendation
**Implement early**. Header handling is complex and deserves a dedicated module. Ensures whitelist enforcement and determinism.

---

## 8. Content-Type Normalization

### Issue
Phase-B2.md §4.D3 requires normalizing content-type by removing charset/parameters:
```
normalize(v) = v.split(";")[0].trim().toLowerCase()
```

This should be consistent across all uses.

### Design Decision: Content Type Normalizer

**In src/analysis/contentUtils.ts:**
```typescript
export function normalizeContentType(contentType: string | undefined): string | undefined {
  if (!contentType) return undefined;
  return contentType.split(";")[0].trim().toLowerCase();
}

export function classifyContentTypeDrift(left: string | undefined, right: string | undefined): Severity {
  const normLeft = normalizeContentType(left);
  const normRight = normalizeContentType(right);

  if (normLeft === normRight) return "info";

  // Critical if major change (e.g., text/html vs application/json)
  if (
    (normLeft?.includes("text/html") && normRight?.includes("application/json")) ||
    (normLeft?.includes("application/json") && normRight?.includes("text/html"))
  ) {
    return "critical";
  }

  return "warn";
}
```

### Recommendation
**Simple utility**, easy to test, and keeps Phase-B2.md logic close to implementation.

---

## 9. Content Length Classification

### Issue
Phase-B2.md §4.D5 defines severity thresholds:
- `< 200 bytes` → `info`
- `≥ 200 bytes` → `warn`
- `≥ 2000 bytes` and same status → `critical`

### Design Decision: Content Length Classifier

**In src/analysis/contentUtils.ts:**
```typescript
export function classifyContentLengthDrift(
  leftLen: number | undefined,
  rightLen: number | undefined,
  statusChanged: boolean
): Severity {
  if (leftLen === undefined || rightLen === undefined || leftLen === rightLen) {
    return "info";
  }

  const delta = Math.abs(rightLen - leftLen);

  if (delta >= 2000 && !statusChanged) {
    return "critical";
  }
  if (delta >= 200) {
    return "warn";
  }
  return "info";
}
```

### Recommendation
**Implement alongside content-type logic**.

---

## 10. Redirect Chain Comparison

### Issue
Phase-B2.md §4.B3 requires comparing redirect chains with specific severity logic:
- `warn` by default
- `critical` if hop count differs by ≥ 2 OR final host differs

### Design Decision: Redirect Chain Comparator

**In src/analysis/redirectUtils.ts:**
```typescript
export function compareRedirectChains(
  leftChain: RedirectHop[] | undefined,
  rightChain: RedirectHop[] | undefined
): {
  chainChanged: boolean;
  hopCountDelta: number;
  finalHostChanged: boolean;
  severity: Severity;
} {
  const leftHops = leftChain?.length ?? 0;
  const rightHops = rightChain?.length ?? 0;
  const hopCountDelta = Math.abs(rightHops - leftHops);

  const leftFinalHost = extractHost((leftChain ?? [])[leftChain!.length - 1]?.toUrl);
  const rightFinalHost = extractHost((rightChain ?? [])[rightChain!.length - 1]?.toUrl);
  const finalHostChanged = leftFinalHost !== rightFinalHost;

  const chainChanged = !arraysEqual(leftChain, rightChain);

  let severity: Severity = "warn";
  if (hopCountDelta >= 2 || finalHostChanged) {
    severity = "critical";
  }

  return { chainChanged, hopCountDelta, finalHostChanged, severity };
}

function extractHost(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname || "";
  } catch {
    return "";
  }
}

function arraysEqual(a: RedirectHop[] | undefined, b: RedirectHop[] | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((hop, i) => hop.toUrl === b[i]?.toUrl && hop.status === b[i]?.status);
}
```

### Recommendation
**Implement before building redirect finding rules**.

---

## 11. Cache-Control Keyword Detection

### Issue
Phase-B2.md §4.D1 requires detecting if `no-store` or `private` appears in cache-control header.

### Design Decision: Cache-Control Parser

**In src/analysis/cacheUtils.ts:**
```typescript
export function hasCacheControlKeyword(cacheControlHeader: string | undefined, keyword: "no-store" | "private"): boolean {
  if (!cacheControlHeader) return false;
  return cacheControlHeader.toLowerCase().split(",").some(directive =>
    directive.trim().split("=")[0].trim() === keyword
  );
}

export function classifyCacheControlDrift(
  left: string | undefined,
  right: string | undefined
): Severity {
  const leftNoStore = hasCacheControlKeyword(left, "no-store");
  const rightNoStore = hasCacheControlKeyword(right, "no-store");

  const leftPrivate = hasCacheControlKeyword(left, "private");
  const rightPrivate = hasCacheControlKeyword(right, "private");

  // Critical if presence of no-store or private differs
  if (leftNoStore !== rightNoStore || leftPrivate !== rightPrivate) {
    return "critical";
  }

  return "warn";
}
```

### Recommendation
**Implement cache utilities early**.

---

## 12. Body Hash Computation & Comparison

### Issue
Phase-B2.md doesn't specify hash algorithm, but SHA-256 is standard. SignalEnvelope already stores `bodyHash`, so just need to compare.

### Design Decision: Use Existing Body Hash

**In classify.ts:**
```typescript
// Body hashes are already computed by ActiveProbeProvider
// Just compare them in the diff

if (leftEnvelope.result.ok && rightEnvelope.result.ok) {
  const leftHash = (leftEnvelope.result as ProbeSuccess).response.bodyHash;
  const rightHash = (rightEnvelope.result as ProbeSuccess).response.bodyHash;

  if (leftHash && rightHash && leftHash !== rightHash) {
    // BODY_HASH_DRIFT with appropriate severity
  }
}
```

### Recommendation
**No new work needed**. Just consume `SignalEnvelope.bodyHash` field from ActiveProbeProvider.

---

## 13. Probe Outcome Detection Logic

### Issue
Phase-B2.md §4.A requires checking:
- Both probes failed: `probe.leftOk === false && probe.rightOk === false`
- One probe failed: `probe.outcomeChanged === true`

These fields come from `ProbeOutcomeDiff`, which must be computed from two `SignalEnvelope` objects.

### Design Decision: ProbeOutcomeDiff Compiler

**In src/analysis/probeUtils.ts:**
```typescript
export function compileProbeOutcomeDiff(
  leftEnvelope: SignalEnvelope,
  rightEnvelope: SignalEnvelope
): ProbeOutcomeDiff {
  const leftOk = leftEnvelope.result.ok;
  const rightOk = rightEnvelope.result.ok;

  const leftErrorCode = !leftOk ? (leftEnvelope.result as ProbeFailure).error.code : undefined;
  const rightErrorCode = !rightOk ? (rightEnvelope.result as ProbeFailure).error.code : undefined;

  return {
    leftOk,
    rightOk,
    leftErrorCode,
    rightErrorCode,
    outcomeChanged: leftOk !== rightOk,
  };
}
```

### Recommendation
**Implement early**. Essential for Rule Group A (probe failure detection).

---

## 14. Finding Sorting & Ordering

### Issue
Phase-B2.md §1.4 requires findings to be sorted by:
1. `severity` (`critical` > `warn` > `info`)
2. `code` (lexicographically)
3. `message` (lexicographically)

### Design Decision: Findings Sorter

**In shared/diff.ts or src/analysis/sorting.ts:**
```typescript
export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  warn: 1,
  info: 2,
};

export function sortFindings(findings: DiffFinding[]): DiffFinding[] {
  return [...findings].sort((a, b) => {
    // 1. Sort by severity (critical > warn > info)
    const severityDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (severityDiff !== 0) return severityDiff;

    // 2. Sort by code (lexicographically)
    const codeDiff = a.code.localeCompare(b.code);
    if (codeDiff !== 0) return codeDiff;

    // 3. Sort by message (lexicographically)
    return a.message.localeCompare(b.message);
  });
}
```

### Recommendation
**Implement as utility function**. Used in final step of `classifyDiff()`.

---

## 15. CF Context Drift Correlation with Timing

### Issue
Phase-B2.md §4.F1 says CF_CONTEXT_DRIFT is `warn` **only if correlated with timing drift**.

What does "correlated" mean? Current severity logic is unclear.

### Design Decision: Clarify CF Context Severity Logic

**Options:**
1. **Strict Correlation**: Only emit CF_CONTEXT_DRIFT if TIMING_DRIFT is also present
2. **Flexible Correlation**: If CF context differs AND timing differs, mark as warn; if CF differs alone, mark as info

**Recommendation for MVP**: Use Option 2 (more lenient).

```typescript
export function shouldEmitCfContextFinding(
  cfDiff: CfContextDiff | undefined,
  hasTiming Drift: boolean
): boolean {
  if (!cfDiff) return false;

  // CF_CONTEXT_DRIFT is emitted if context differs
  const contextChanged =
    cfDiff.colo?.changed ||
    cfDiff.country?.changed ||
    cfDiff.asn?.changed;

  // Severity depends on timing correlation
  // Return severity rule: critical only if timing also drifts
  return contextChanged;
}

export function cfContextDriftSeverity(hasTim ingDrift: boolean): Severity {
  return hasTimingDrift ? "warn" : "info";
}
```

**Action Item**: Confirm with team whether Phase-B2.md §4.F1 requires **hard correlation** (omit finding if no timing drift) or **soft correlation** (lower severity if no timing drift).

---

## Summary: Implementation Checklist Before Writing classify.ts

| Item | Decision | File | Priority |
|------|----------|------|----------|
| Evidence Key Validation | Option B: Runtime validator function | `src/analysis/validators.ts` | 🔴 High |
| Dedup Key Computation | Add helpers to shared/diff.ts | `shared/diff.ts` | 🔴 High |
| Rule Registry | Option B: Lightweight map | `src/analysis/constants.ts` | 🟡 Medium |
| Timing Constants | Move to code | `shared/diff.ts` | 🟡 Medium |
| Status Classifier | Create pure function | `src/analysis/classifiers.ts` | 🔴 High |
| URL Component Parser | Create utility | `src/analysis/urlUtils.ts` | 🔴 High |
| Header Diff Compiler | Implement with whitelist | `src/analysis/headerDiff.ts` | 🔴 High |
| Content-Type Normalizer | Simple utility | `src/analysis/contentUtils.ts` | 🔴 High |
| Content Length Classifier | Simple utility | `src/analysis/contentUtils.ts` | 🟡 Medium |
| Redirect Chain Comparator | Implement logic | `src/analysis/redirectUtils.ts` | 🔴 High |
| Cache-Control Parser | Keyword detection | `src/analysis/cacheUtils.ts` | 🟡 Medium |
| Body Hash Comparison | Use existing field | `src/analysis/classify.ts` | ✅ Done |
| Probe Outcome Compiler | Convert envelopes → ProbeOutcomeDiff | `src/analysis/probeUtils.ts` | 🔴 High |
| Findings Sorter | Sort by (severity, code, message) | `shared/diff.ts` | 🔴 High |
| CF Context Correlation | **Clarify with team** | Phase-B2.md | 🔴 Critical |

---

## Next Steps

1. **Resolve Issue #15**: Clarify CF context drift correlation logic in Phase-B2.md
2. **Create utility modules**: Implement the 🔴 **High** priority items first
3. **Write tests**: Each utility should have snapshot tests matching Phase-B2.md examples
4. **Implement classify.ts**: Orchestrate utilities into 14 rule groups
5. **Snapshot test classify()**: Verify byte-stable output with known inputs
