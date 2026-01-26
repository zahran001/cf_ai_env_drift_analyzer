# HTTP Request vs Network Failures Fix - Comprehensive Change Chain

**Overview:** This document traces the complete chain of changes implemented to properly distinguish between HTTP response errors (4xx/5xx status codes) and network-level failures (DNS errors, timeouts, SSRF blocks, etc.).

**Key commits:**
- `9ff736c` (Jan 22, 2026): "differentiating HTTP vs network failures" - Initial architecture split
- `5b44fa8` (Jan 24, 2026): "added another utility - isNetworkFailure" - Shared utility extraction

---

## 1. Type System Changes

### 1.1 Signal Types (`shared/signal.ts`)

**Before:**
```typescript
export type ProbeFailure = {
  ok: false;
  error: ProbeError;
  durationMs?: number;
};

export type ProbeResult = ProbeSuccess | ProbeFailure;
```

**After:**
```typescript
// Successful HTTP response (2xx/3xx)
export type ProbeSuccess = {
  ok: true;
  response: ResponseMetadata;
  redirects?: RedirectHop[];
  durationMs: number;
};

// HTTP error response (4xx/5xx) - request completed with error status
export type ProbeResponseError = {
  ok: false;
  response: ResponseMetadata;  // HAS HTTP response
  redirects?: RedirectHop[];
  durationMs: number;
};

// Network-level failure (DNS, timeout, TLS, SSRF, etc.)
export type ProbeNetworkFailure = {
  ok: false;
  error: ProbeError;           // NO HTTP response
  durationMs?: number;
};

export type ProbeResult = ProbeSuccess | ProbeResponseError | ProbeNetworkFailure;
```

**Semantic Change:**
- **Discriminant:** The presence/absence of `response` field vs `error` field
  - `response` field = request completed (regardless of status code)
  - `error` field = request failed before HTTP response
- `ok=true`: Always HTTP 2xx/3xx
- `ok=false + response field`: HTTP 4xx/5xx (compare normally)
- `ok=false + error field`: Network failure (different handling)

---

## 2. Provider Changes

### 2.1 ActiveProbeProvider (`src/providers/activeProbe.ts`)

**New Utility Function:**
```typescript
/**
 * Classify HTTP status code as probe success or failure.
 *
 * Semantics:
 * - 2xx and 3xx: Probe succeeded (request was fulfilled or redirected)
 * - 4xx and 5xx: Probe failed (request was rejected or server errored)
 *
 * This ensures that status drift (e.g., 200 vs 404) is correctly captured
 * in outcomeChanged and severity classification.
 */
function classifyStatusOutcome(status: number): boolean {
  return status < 400;
}
```

**Result Construction Logic:**
```typescript
// OLD: Always returned ProbeSuccess if response received
const success: ProbeSuccess = {
  ok: true,
  response,
  redirects: redirects.length > 0 ? redirects : undefined,
  durationMs: tracker.getElapsedMs(),
};
return { ..., result: success };

// NEW: Classify status and return appropriate type
const isSuccessStatus = classifyStatusOutcome(status);
const result: ProbeSuccess | ProbeResponseError = isSuccessStatus
  ? {
      ok: true,
      response,
      redirects: redirects.length > 0 ? redirects : undefined,
      durationMs: tracker.getElapsedMs(),
    }
  : {
      ok: false,
      response,  // Still have response for 4xx/5xx
      redirects: redirects.length > 0 ? redirects : undefined,
      durationMs: tracker.getElapsedMs(),
    };

return { ..., result };
```

**Impact:**
- 4xx/5xx responses now have `ok=false` but still contain full response metadata
- Network errors still return `ProbeNetworkFailure` with `error` field
- Enables downstream systems to distinguish between "server error" and "network unreachable"

---

## 3. Shared Utility Layer

### 3.1 ProbeUtils (`src/analysis/probeUtils.ts`)

**New ProbeOutcomeDiff Type (via shared/diff.ts):**
```typescript
export type ProbeOutcomeDiff = {
  leftOk: boolean;
  rightOk: boolean;
  leftErrorCode?: ProbeErrorCode;
  rightErrorCode?: ProbeErrorCode;
  outcomeChanged: boolean;
  responsePresent: boolean;  // TRUE if BOTH have response field
};
```

**New Utility Function:**
```typescript
/**
 * Determine if a probe side is a network failure (no HTTP response).
 *
 * A network failure occurs when:
 * - The probe result has ok=false AND
 * - There is no HTTP response (only an error object)
 *
 * This is distinct from HTTP error responses (4xx/5xx), which have ok=false
 * but DO have an HTTP response with a status code.
 *
 * @param probe - ProbeOutcomeDiff with both sides' outcomes
 * @param side - 'left' or 'right'
 * @returns true if the specified side is a network failure (no response)
 */
export function isNetworkFailure(probe: ProbeOutcomeDiff, side: "left" | "right"): boolean {
  if (side === "left") {
    // Network failure: has error code AND no response (responsePresent is false or undefined)
    return probe.leftErrorCode !== undefined && !probe.responsePresent;
  } else {
    return probe.rightErrorCode !== undefined && !probe.responsePresent;
  }
}
```

**Usage Pattern:**
```typescript
// Instead of checking for error field presence directly:
const isNetworkFailure = diff.probe.leftErrorCode && !diff.status?.left;

// Now use:
const isNetworkFailure = isNetworkFailure(diff.probe, 'left');
```

**Advantages:**
- Single source of truth for failure classification logic
- Consistent across `diff.ts` and `classify.ts`
- Clear documentation of semantics
- Testable in isolation

---

## 4. Diff Engine Changes

### 4.1 computeDiff() (`src/analysis/diff.ts`)

**Probe Outcome Handling:**

**Before:**
```typescript
// Simple boolean check - any ok=false meant short-circuit
const leftOk = leftEnvelope.result.ok;
const rightOk = rightEnvelope.result.ok;

if (!leftOk || !rightOk) {
  // Return minimal diff regardless of failure type
  return { ..., findings: classify(...) };
}

// Both must have succeeded to compare
const leftResponse = (leftEnvelope.result as ProbeSuccess).response;
const rightResponse = (rightEnvelope.result as ProbeSuccess).response;
```

**After:**
```typescript
// Compile probe outcome using shared utility
const probeOutcomeDiff = compileProbeOutcomeDiff(leftEnvelope as any, rightEnvelope as any);

// Only short-circuit if EITHER has NO response (network failure)
if (!probeOutcomeDiff.responsePresent) {
  const findings = classify({
    schemaVersion: DIFF_SCHEMA_VERSION,
    comparisonId: leftEnvelope.comparisonId,
    leftProbeId: leftEnvelope.probeId,
    rightProbeId: rightEnvelope.probeId,
    probe: probeOutcomeDiff,
    findings: [],
    maxSeverity: "info",
  });
  return { ..., findings };
}

// Both probes completed (have response field); extract responses
// This includes both ProbeSuccess (ok=true) AND ProbeResponseError (ok=false)
const leftResponse = (leftEnvelope.result as ProbeSuccess | ProbeResponseError).response;
const rightResponse = (rightEnvelope.result as ProbeSuccess | ProbeResponseError).response;
```

**Semantic Change:**
- **Before:** Any `ok=false` causes early return (4xx/5xx treated like network errors)
- **After:** Only network failures (no response) cause early return
  - HTTP errors (4xx/5xx) are compared normally: status drift detected, headers diffed, etc.
  - Enables findings like `STATUS_MISMATCH` (200 vs 404)

---

## 5. Classification Engine Changes

### 5.1 classify() (`src/analysis/classify.ts`)

**Probe Failure Detection (Rule Group A):**

**Before:**
```typescript
if (!diff.probe.leftOk && !diff.probe.rightOk) {
  // Both failed: could be both network failures OR both HTTP errors
  // Only emit PROBE_FAILURE if BOTH are network failures (no status codes)
  const leftIsNetworkFailure = diff.probe.leftErrorCode && !diff.status?.left;
  const rightIsNetworkFailure = diff.probe.rightErrorCode && !diff.status?.right;

  if (leftIsNetworkFailure && rightIsNetworkFailure) {
    // Emit PROBE_FAILURE
    return postProcess(findings);
  }
  // Otherwise: fall through (but incorrect logic here)
} else if (diff.probe.leftOk !== diff.probe.rightOk) {
  if (!diff.probe.leftOk) {
    const leftIsNetworkFailure = diff.probe.leftErrorCode && !diff.status?.left;
    if (leftIsNetworkFailure) {
      // Emit PROBE_FAILURE for left
      return postProcess(findings);
    }
  } else {
    const rightIsNetworkFailure = diff.probe.rightErrorCode && !diff.status?.right;
    if (rightIsNetworkFailure) {
      // Emit PROBE_FAILURE for right
      return postProcess(findings);
    }
  }
}
```

**After:**
```typescript
if (!diff.probe.leftOk && !diff.probe.rightOk) {
  // Both probes reported ok=false
  // Only emit PROBE_FAILURE if BOTH are network failures (no responses)
  const leftIsNetworkFailure = isNetworkFailure(diff.probe, "left");
  const rightIsNetworkFailure = isNetworkFailure(diff.probe, "right");

  if (leftIsNetworkFailure && rightIsNetworkFailure) {
    const evidence: DiffEvidence[] = [{ section: "probe" }];
    findings.push({
      id: generateFindingId("PROBE_FAILURE", "probe"),
      code: "PROBE_FAILURE",
      category: "unknown",
      severity: "critical",
      message: "Both probes failed (network-level)",
      evidence,
      left_value: diff.probe.leftErrorCode || "Unknown error",
      right_value: diff.probe.rightErrorCode || "Unknown error",
    });
    return postProcess(findings);
  }
  // Otherwise: both ok=false but both have responses (HTTP errors, e.g., 404 vs 500)
  // Fall through to normal diff rules (STATUS_MISMATCH will be emitted)
} else if (diff.probe.leftOk !== diff.probe.rightOk) {
  // One succeeded, one reported ok=false
  // Only emit PROBE_FAILURE if the failed side is a network failure
  if (!diff.probe.leftOk && isNetworkFailure(diff.probe, "left")) {
    const evidence: DiffEvidence[] = [{ section: "probe", keys: ["left"] }];
    findings.push({
      id: generateFindingId("PROBE_FAILURE", "probe", ["left"]),
      code: "PROBE_FAILURE",
      category: "unknown",
      severity: "critical",
      message: "Left probe failed (network-level); right succeeded",
      evidence,
      left_value: diff.probe.leftErrorCode || "Unknown error",
      right_value: diff.status?.right,
    });
    return postProcess(findings);
  } else if (!diff.probe.rightOk && isNetworkFailure(diff.probe, "right")) {
    const evidence: DiffEvidence[] = [{ section: "probe", keys: ["right"] }];
    findings.push({
      id: generateFindingId("PROBE_FAILURE", "probe", ["right"]),
      code: "PROBE_FAILURE",
      category: "unknown",
      severity: "critical",
      message: "Right probe failed (network-level); left succeeded",
      evidence,
      left_value: diff.status?.left,
      right_value: diff.probe.rightErrorCode || "Unknown error",
    });
    return postProcess(findings);
  }
  // Otherwise: failed side has response (HTTP error), compare normally
}
```

**Key Differences:**
- Uses `isNetworkFailure()` utility for consistent logic
- Clearer comments explaining two distinct failure modes
- Properly handles: both network failures, both HTTP errors, one of each
- HTTP error pairs (e.g., 404 vs 500) now emit `STATUS_MISMATCH` instead of short-circuiting

---

## 6. Test Changes

### 6.1 ActiveProbeProvider Tests (`src/providers/__tests__/activeProbe.test.ts`)

**Pattern Change:**
```typescript
// OLD: Check only for ok=false
if (!envelope.result.ok) {
  expect(envelope.result.error.code).toBe("ssrf_blocked");
}

// NEW: Check for error field explicitly (narrow type)
if (!envelope.result.ok && "error" in envelope.result) {
  expect(envelope.result.error.code).toBe("ssrf_blocked");
}
```

**Applied to:** All 20+ test cases checking network failures
- SSRF validation tests (localhost, private IPs, etc.)
- Timeout tests
- DNS error tests
- TLS error tests
- Fetch error tests (redirect loops, missing headers)

**Impact:**
- Tests now correctly discriminate between failure types
- TypeScript type narrowing works properly
- Error field access is safe from `ProbeResponseError` types

---

## 7. End-to-End Data Flow

### 7.1 HTTP Success (2xx/3xx)
```
Request succeeds with 200
↓
ActiveProbeProvider.probe() → classifyStatusOutcome(200) = true
↓
Returns ProbeSuccess { ok: true, response: {...} }
↓
compileProbeOutcomeDiff() → responsePresent: true
↓
computeDiff() → continues to full comparison
↓
classify() → applies all routing/security/cache rules
↓
Result: May emit findings for headers, cache, routing
```

### 7.2 HTTP Error (4xx/5xx)
```
Request succeeds with 404
↓
ActiveProbeProvider.probe() → classifyStatusOutcome(404) = false
↓
Returns ProbeResponseError { ok: false, response: {...} }
↓
compileProbeOutcomeDiff() → responsePresent: true
↓
computeDiff() → continues to full comparison
↓
classify() → applies all routing/security/cache rules
↓
Result: Emits STATUS_MISMATCH if left status ≠ right status
```

### 7.3 Network Failure (DNS/Timeout)
```
Request fails (DNS error)
↓
ActiveProbeProvider.probe() → throwable error caught
↓
Returns ProbeNetworkFailure { ok: false, error: {...} }
↓
compileProbeOutcomeDiff() → responsePresent: false
↓
computeDiff() → early return with minimal diff
↓
classify() → checks isNetworkFailure(...)
↓
Result: Emits PROBE_FAILURE critical finding, short-circuits
```

### 7.4 Mixed Scenarios
```
Left succeeds (200), Right times out (DNS)
↓
Left: ProbeSuccess { ok: true, response: {...} }
Right: ProbeNetworkFailure { ok: false, error: {...} }
↓
compileProbeOutcomeDiff() → responsePresent: false (one side has no response)
↓
computeDiff() → early return
↓
classify() → calls isNetworkFailure(diff.probe, "right") = true
↓
Result: Emits PROBE_FAILURE for right side only

Left: 404, Right: 500 (both are HTTP errors)
↓
Left: ProbeResponseError { ok: false, response: {status: 404} }
Right: ProbeResponseError { ok: false, response: {status: 500} }
↓
compileProbeOutcomeDiff() → responsePresent: true (both have responses)
↓
computeDiff() → continues to full comparison
↓
classify() → compares status codes
↓
Result: Emits STATUS_MISMATCH finding
```

---

## 8. Architecture Benefits

### 8.1 Type Safety
- **Before:** `ok: false` was ambiguous (network failure or HTTP error?)
- **After:** Discriminant field (`response` vs `error`) makes type narrowing deterministic

### 8.2 Correct Semantics
- **Before:** All `ok: false` cases treated as network failures
- **After:** HTTP error responses (4xx/5xx) properly compared in diffs

### 8.3 Shared Logic
- **Before:** Failure detection logic scattered (diff.ts, classify.ts)
- **After:** Single `isNetworkFailure()` utility ensures consistency

### 8.4 Testability
- Network failure vs HTTP error handling is explicit
- Tests can verify both success and failure paths independently

---

## 9. Files Modified

| File | Role | Changes |
|------|------|---------|
| `shared/signal.ts` | Type definitions | Split `ProbeFailure` → `ProbeResponseError` + `ProbeNetworkFailure` |
| `src/providers/activeProbe.ts` | Signal generation | Added `classifyStatusOutcome()`, classify status code as ok/not ok |
| `src/analysis/probeUtils.ts` | Shared utilities | Added `isNetworkFailure()` type guard and doc |
| `src/analysis/diff.ts` | Diff computation | Use `compileProbeOutcomeDiff()`, check `responsePresent` for early exit |
| `src/analysis/classify.ts` | Classification | Use `isNetworkFailure()` for consistent failure detection |
| `src/providers/__tests__/activeProbe.test.ts` | Tests | Update type guards in all failure test cases |

---

## 10. Testing Verification

**Run tests to verify:**
```bash
npm test -- src/analysis/__tests__/diff.test.ts
npm test -- src/analysis/__tests__/classify.test.ts
npm test -- src/providers/__tests__/activeProbe.test.ts
npm test -- src/analysis/__tests__/probeUtils.test.ts
```

**Key test cases:**
- Both probes network failure → PROBE_FAILURE emitted
- One probe network failure → PROBE_FAILURE for that side only
- Both probes HTTP errors (e.g., 404 vs 500) → STATUS_MISMATCH emitted (no early exit)
- One probe 200, other 404 → STATUS_MISMATCH emitted
- Provider returns `ProbeResponseError` for 4xx/5xx responses

---

## 11. CLAUDE.md Compliance

This change aligns with CLAUDE.md contract requirements:

✅ **1.1 SignalEnvelope:** Extends type system without breaking schema_version
✅ **1.2 EnvDiff:** Diff computation remains deterministic (no AI involvement)
✅ **2.4 Deterministic Diff:** No randomness, same inputs → same output
✅ **3.1 Signal Providers:** Proper normalization to canonical types
✅ **3.2 Diff Engine:** Pure function, deterministic classification
✅ **5.1 URL Validation:** SSRF blocking still uses network failure path

---

## Summary

The HTTP vs Network Failures fix introduces a three-way type system for probe outcomes:

1. **ProbeSuccess** (ok=true) - HTTP 2xx/3xx responses
2. **ProbeResponseError** (ok=false + response) - HTTP 4xx/5xx responses (still compared)
3. **ProbeNetworkFailure** (ok=false + error) - DNS/timeout/SSRF/TLS errors (early exit)

This enables precise classification of environmental drift:
- **Status drift detection** (200 vs 404)
- **Network resilience tracking** (host reachability)
- **Infrastructure health** (DNS/TLS failures)

All downstream logic (diff, classification) now correctly handles both failure modes.
