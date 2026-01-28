# D2 Test Case Debug Trace — CORS Header Drift Detection Failure

**Test Case:** D2
**URLs Compared:**
```json
{
  "leftUrl": "https://httpbin.org/response-headers?access-control-allow-origin=*",
  "rightUrl": "https://httpbin.org/response-headers?access-control-allow-origin=https://example.com"
}
```

**Expected:** CORS_HEADER_DRIFT finding (critical severity) with evidence pointing to `access-control-allow-origin`
**Actual:** Only FINAL_URL_MISMATCH:finalUrl:query (routing) flag, no header section, no CORS finding

---

## Data Flow Chain (Request → LLM Call)

### 1️⃣ **PROBE PHASE** — ActiveProbeProvider.probe()
**File:** [src/providers/activeProbe.ts](src/providers/activeProbe.ts)

#### Left Probe: `https://httpbin.org/response-headers?access-control-allow-origin=*`
```typescript
// Line 466: filterHeaders(headers) is called
const headerSnapshot = filterHeaders(headers);
// Returns:
{
  core: {
    // (other core headers filtered)
  },
  accessControl: {
    "access-control-allow-origin": "*"  // ✅ Captured
  }
}

// Line 468-472: ResponseMetadata built
const response: ResponseMetadata = {
  status: 200,
  finalUrl: "https://httpbin.org/response-headers?access-control-allow-origin=*",
  headers: headerSnapshot  // ✅ Contains accessControl
};

// Line 491-500: SignalEnvelope returned
return {
  schemaVersion: SIGNAL_SCHEMA_VERSION,
  comparisonId: "unknown",
  probeId: "unknown",
  side: "left",
  requestedUrl: url,
  capturedAt,
  cf: runnerContext,
  result: {
    ok: true,  // ✅ 200 < 400
    response,  // ✅ Has response.headers with accessControl
    redirects: undefined,
    durationMs: tracker.getElapsedMs(),
  },
};
```

#### Right Probe: `https://httpbin.org/response-headers?access-control-allow-origin=https://example.com`
```typescript
// Same flow, headers filtered:
{
  core: { ... },
  accessControl: {
    "access-control-allow-origin": "https://example.com"  // ✅ Different value
  }
}

// SignalEnvelope with response.headers.accessControl set
```

---

### 2️⃣ **DIFF COMPUTATION PHASE** — diff.ts::computeDiff()
**File:** [src/analysis/diff.ts](src/analysis/diff.ts)

#### Extract Responses (Lines 68-69)
```typescript
const leftResponse = (leftEnvelope.result as ProbeSuccess | ProbeResponseError).response;
const rightResponse = (rightEnvelope.result as ProbeSuccess | ProbeResponseError).response;

// leftResponse.headers = { core: {...}, accessControl: { "access-control-allow-origin": "*" } }
// rightResponse.headers = { core: {...}, accessControl: { "access-control-allow-origin": "https://example.com" } }
```

#### Build Final URL Diff (Lines 77-81)
```typescript
const finalUrlDiff: Change<string> =
  leftResponse.finalUrl === rightResponse.finalUrl
    ? unchanged(leftResponse.finalUrl)
    : changed(leftResponse.finalUrl, rightResponse.finalUrl);

// Result (query params differ):
// finalUrlDiff = {
//   left: "https://httpbin.org/response-headers?access-control-allow-origin=*",
//   right: "https://httpbin.org/response-headers?access-control-allow-origin=https://example.com",
//   changed: true
// }
```

#### **⚠️ BUG #1: Header Diff Computation (Lines 108-155)**

```typescript
// Line 105-106: Extract headers
const leftHeaders = leftResponse.headers;
const rightHeaders = rightResponse.headers;

// leftHeaders = {
//   core: {...},
//   accessControl: { "access-control-allow-origin": "*" }
// }
// rightHeaders = {
//   core: {...},
//   accessControl: { "access-control-allow-origin": "https://example.com" }
// }

// Line 108-143: computeHeaderDiff() ONLY processes CORE headers!
const computeHeaderDiff = (...): HeaderDiff<string> => {
  const added: Record<string, string> = {};
  const removed: Record<string, string> = {};
  const changedHeaders: Record<string, Change<string>> = {};
  const unchangedHeaders: Record<string, string> = {};

  const allKeys = new Set<string>();

  // ❌ BUG: Only iterate CORE headers, NEVER accessControl!
  if (leftHeaders.core) {
    Object.keys(leftHeaders.core).forEach((k) => allKeys.add(k));
  }
  if (rightHeaders.core) {
    Object.keys(rightHeaders.core).forEach((k) => allKeys.add(k));
  }

  // ❌ accessControl headers are COMPLETELY IGNORED
  // This loop only compares core headers
  for (const key of allKeys) {
    const leftVal = leftHeaders.core?.[key as keyof typeof leftHeaders.core];
    const rightVal = rightHeaders.core?.[key as keyof typeof rightHeaders.core];
    // ... comparisons only on core ...
  }

  return { added, removed, changed: changedHeaders, unchanged: unchangedHeaders };
  // Result: { added: {}, removed: {}, changed: {}, unchanged: {} }
  // ❌ accessControl diffs are LOST!
};

const headerDiffCore = computeHeaderDiff(leftHeaders, rightHeaders);
// headerDiffCore = { added: {}, removed: {}, changed: {}, unchanged: {} }

// Line 147-155: Build headerDiff
const headerDiff =
  Object.keys(headerDiffCore.added).length > 0 ||
  Object.keys(headerDiffCore.removed).length > 0 ||
  Object.keys(headerDiffCore.changed).length > 0
    ? {
        core: headerDiffCore,
        // ❌ BUG: accessControl is set to EMPTY placeholder
        accessControl: leftHeaders.accessControl || rightHeaders.accessControl
          ? { added: {}, removed: {}, changed: {}, unchanged: {} }  // ← EMPTY!
          : undefined,
      }
    : undefined;

// headerDiff = undefined (because headerDiffCore is all empty)
// ❌ The accessControl diffs are NEVER computed!
```

#### **Root Cause of D2 Failure:**

The `computeHeaderDiff()` function in [src/analysis/diff.ts:108-143](src/analysis/diff.ts#L108-L143) **only compares core headers** and **never compares accessControl headers**. The accessControl headers from the envelopes are discarded.

**Where it should be fixed:**
- The function should iterate over `accessControl` keys SEPARATELY
- It should build a separate `HeaderDiff` for accessControl diffs
- These should be included in the final `HeaderDiff` structure

#### Build Partial EnvDiff (Lines 157-168)
```typescript
const partialEnvDiff: Omit<EnvDiff, "findings" | "maxSeverity"> = {
  schemaVersion: DIFF_SCHEMA_VERSION,
  comparisonId: leftEnvelope.comparisonId,
  leftProbeId: leftEnvelope.probeId,
  rightProbeId: rightEnvelope.probeId,
  probe: probeOutcomeDiff,
  status: statusDiff,
  finalUrl: finalUrlDiff,  // ✅ Has query diff
  redirects: redirectDiff,  // undefined
  headers: headerDiff,  // ❌ undefined or { core: {empty}, accessControl: {empty} }
};
```

---

### 3️⃣ **CLASSIFICATION PHASE** — classify()
**File:** [src/analysis/classify.ts](src/analysis/classify.ts)

#### ROUTING RULES (Lines 255-310)
```typescript
// Rule B3: FINAL_URL_MISMATCH
if (diff.finalUrl?.changed) {  // ✅ TRUE
  const leftUrl = diff.finalUrl.left!;
  const rightUrl = diff.finalUrl.right!;
  const urlDrift = classifyUrlDrift(leftUrl, rightUrl);
  // urlDrift.severity = "info" (query param diff only)

  findings.push({
    id: generateFindingId("FINAL_URL_MISMATCH", "finalUrl", ["query"]),
    code: "FINAL_URL_MISMATCH",
    category: "routing",
    severity: "info",  // ← Only flagged as info!
    message: "Final URL differs after redirects",
    evidence: [{ section: "finalUrl", keys: ["query"] }],
    left_value: leftUrl,
    right_value: rightUrl,
  });
}
```

#### SECURITY RULES (Lines 312-368)
```typescript
// Rule C2: CORS_HEADER_DRIFT
const corsHeaders = getAccessControlHeaderDiffs(diff);  // Line 352
if (corsHeaders.length > 0) {  // ❌ FALSE!
  // This rule is NEVER triggered
  findings.push({
    code: "CORS_HEADER_DRIFT",
    // ...
  });
}
```

#### **getAccessControlHeaderDiffs() helper (Lines 34-44)**
```typescript
function getAccessControlHeaderDiffs(diff: EnvDiff): string[] {
  const acHeaders = diff.headers?.accessControl;  // ❌ undefined or empty!
  if (!acHeaders) return [];  // ← Returns empty array

  const differing = new Set<string>();
  Object.keys(acHeaders.added || {}).forEach((k) => differing.add(k));
  Object.keys(acHeaders.removed || {}).forEach((k) => differing.add(k));
  Object.keys(acHeaders.changed || {}).forEach((k) => differing.add(k));

  return Array.from(differing).sort();  // Returns []
}
```

#### Final Findings Array
```typescript
findings = [
  {
    id: "FINAL_URL_MISMATCH:finalUrl:query",
    code: "FINAL_URL_MISMATCH",
    category: "routing",
    severity: "info",  // ← Only routing issue flagged, not security!
    message: "Final URL differs after redirects",
    evidence: [{ section: "finalUrl", keys: ["query"] }],
    left_value: "https://...-origin=*",
    right_value: "https://...-origin=https://example.com",
  }
  // ❌ NO CORS_HEADER_DRIFT finding
  // ❌ No evidence pointing to access-control-allow-origin header
]
```

---

### 4️⃣ **LLM EXPLANATION PHASE** — explain.ts
**File:** [src/llm/explain.ts](src/llm/explain.ts)

#### Prompt Construction (with incomplete diff)
```typescript
// The LLM receives:
{
  diff: {
    finalUrl: { changed: true, left: "...origin=*", right: "...origin=https://example.com" },
    headers: undefined,  // ❌ No header diffs!
    findings: [
      {
        code: "FINAL_URL_MISMATCH",
        message: "Final URL differs after redirects",
        evidence: [{ section: "finalUrl", keys: ["query"] }]
        // ← LLM sees only routing issue
      }
    ]
  },
  history: [...]
}
```

#### LLM Generates Explanation
```
The LLM sees:
- Final URL differs only in query parameters
- No security findings
- No header analysis

It generates:
{
  summary: "The final URL differs in query parameters, suggesting a routing change.",
  ranked_causes: [
    {
      cause: "Query parameter adjustment in routing configuration",
      confidence: 0.8,
      evidence: ["The access-control-allow-origin query parameter changed from * to https://example.com"]
    }
  ],
  // ❌ Explanation focuses on ROUTING, not SECURITY
  // ❌ No mention of CORS headers (because diff didn't include them)
}
```

---

## Summary: Root Cause Analysis

| Phase | Component | Issue | Impact |
|-------|-----------|-------|--------|
| **1. Probe** | activeProbe.ts | ✅ Correctly captures `accessControl` headers | Headers are available |
| **2. Diff** | diff.ts::computeHeaderDiff() | ❌ **ONLY iterates core headers, ignores accessControl** | ❌ accessControl diffs lost |
| **3. Classify** | classify.ts::getAccessControlHeaderDiffs() | ✅ Correct logic, but receives empty/undefined data | ❌ No findings generated |
| **4. LLM** | explain.ts | ✅ Correct LLM call, but incomplete diff input | ❌ Generates wrong explanation |

---

## The Exact Bug Location

**File:** [src/analysis/diff.ts](src/analysis/diff.ts)
**Lines:** 108-143 (inside `computeDiff()`)

### The Problem Code
```typescript
const computeHeaderDiff = (
  leftHeaders: typeof leftResponse.headers,
  rightHeaders: typeof rightResponse.headers
): HeaderDiff<string> => {
  const added: Record<string, string> = {};
  const removed: Record<string, string> = {};
  const changedHeaders: Record<string, Change<string>> = {};
  const unchangedHeaders: Record<string, string> = {};

  const allKeys = new Set<string>();

  // ❌ ONLY processes core headers
  if (leftHeaders.core) {
    Object.keys(leftHeaders.core).forEach((k) => allKeys.add(k));
  }
  if (rightHeaders.core) {
    Object.keys(rightHeaders.core).forEach((k) => allKeys.add(k));
  }

  for (const key of allKeys) {
    const leftVal = leftHeaders.core?.[key as keyof typeof leftHeaders.core];
    const rightVal = rightHeaders.core?.[key as keyof typeof rightHeaders.core];
    // ... comparison logic ...
  }

  return { added, removed, changed: changedHeaders, unchanged: unchangedHeaders };
};

const headerDiffCore = computeHeaderDiff(leftHeaders, rightHeaders);

// ❌ This creates an EMPTY accessControl diff
const headerDiff =
  Object.keys(headerDiffCore.added).length > 0 ||
  Object.keys(headerDiffCore.removed).length > 0 ||
  Object.keys(headerDiffCore.changed).length > 0
    ? {
        core: headerDiffCore,
        accessControl: leftHeaders.accessControl || rightHeaders.accessControl
          ? { added: {}, removed: {}, changed: {}, unchanged: {} }  // ← EMPTY PLACEHOLDER
          : undefined,
      }
    : undefined;
```

### Why This Fails D2
1. `computeHeaderDiff()` never sees `leftHeaders.accessControl` or `rightHeaders.accessControl`
2. It returns an empty diff (all categories empty)
3. Because `headerDiffCore` is empty, the line 147-155 check makes `headerDiff = undefined`
4. With `headerDiff = undefined`, the `getAccessControlHeaderDiffs()` returns `[]`
5. With no access-control diffs, `CORS_HEADER_DRIFT` is never emitted
6. The LLM only sees `FINAL_URL_MISMATCH` and explains it as a routing issue

---

## Expected Flow (What Should Happen)

```
Probe Phase
  ↓
  Left: { accessControl: { "access-control-allow-origin": "*" } }
  Right: { accessControl: { "access-control-allow-origin": "https://example.com" } }
  ↓
Diff Phase (FIXED)
  ↓
  Should compute accessControl diffs separately:
  - accessControl: {
      added: {},
      removed: {},
      changed: { "access-control-allow-origin": { left: "*", right: "https://example.com", changed: true } },
      unchanged: {}
    }
  ↓
Classify Phase
  ↓
  getAccessControlHeaderDiffs() returns ["access-control-allow-origin"]
  ↓
  CORS_HEADER_DRIFT finding emitted:
  {
    code: "CORS_HEADER_DRIFT",
    severity: "critical",  // ← because hasAllowOriginDiff = true
    evidence: [{ section: "headers", keys: ["access-control-allow-origin"] }]
  }
  ↓
LLM Phase
  ↓
  LLM receives complete diff with CORS finding
  Explains: "CORS policy changed from open (*) to specific origin (https://example.com)"
  ✅ PASS
```

---

## Fix Required

The `computeHeaderDiff()` function must:
1. **Also iterate over accessControl keys** (not just core keys)
2. **Build a separate HeaderDiff for accessControl**
3. **Include both core and accessControl diffs** in the returned `HeaderDiff` structure

Once the diff layer fixes this, the classifier and LLM will automatically work correctly.
