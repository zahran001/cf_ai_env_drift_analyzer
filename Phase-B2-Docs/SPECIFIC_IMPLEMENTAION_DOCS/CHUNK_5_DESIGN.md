# Chunk 5 Design: Classify Module (Rule Orchestrator)

**Phase:** B2 (Deterministic Finding Rules)
**Module:** `src/analysis/classify.ts`
**Estimated Effort:** 90 minutes (45 min code + 45 min tests)
**Status:** Design Phase (Ready for Implementation)

---

## 1. Overview

### Purpose

Orchestrate all 14 Phase-B2.md rules to generate deterministic `DiffFinding[]` from a `EnvDiff`.

**Responsibilities:**
- Evaluate probe outcome rules (A1, A2)
- Evaluate routing rules (B1, B2, B3)
- Evaluate security rules (C1, C2)
- Evaluate cache/content rules (D1, D2, D3, D4, D5)
- Evaluate timing rules (E1)
- Evaluate platform rules (F1)
- Evaluate catch-all header rule (G1)
- Apply global determinism rules (sort, deduplicate, validate)
- Return sorted, validated findings array

### Key Principle

**Same EnvDiff → Same DiffFinding[] (Every Time)**

The classifier must be **100% deterministic**, with:
- No randomness, no timestamps
- Identical output for identical input
- All rules applied in mandatory sequence
- All findings sorted, deduplicated, validated
- Evidence validated via `validateEvidenceKeys()` (Chunk 4)

### Dependencies (All Available ✅)

| Dependency | Status | Location |
|---|---|---|
| Type: EnvDiff | ✅ Available | `shared/diff.ts:64–100` |
| Type: DiffFinding | ✅ Available | `shared/diff.ts:103–114` |
| Type: Severity, FindingCategory | ✅ Available | `shared/diff.ts:13–22` |
| Function: validateEvidenceKeys() | ✅ Implemented | `src/analysis/validators.ts` |
| Constants: Timing thresholds | ✅ Available | `src/analysis/constants.ts` |
| Function: classifyCacheControlDrift() | ✅ Implemented | `src/analysis/cacheUtils.ts` |
| Function: getContentTypeSeverity() | ✅ Implemented | `src/analysis/contentUtils.ts` |
| Function: classifyBodyHashDrift() | ✅ Implemented | `src/analysis/contentUtils.ts` |
| Function: classifyContentLengthDrift() | ✅ Implemented | `src/analysis/contentUtils.ts` |
| Function: getHeaderDiffsMap() | ✅ Implemented | `src/analysis/headerDiff.ts` |
| Function: classifyUrlDrift() | ✅ Implemented | `src/analysis/urlUtils.ts` |
| Function: classifyRedirectDrift() | ✅ Implemented | `src/analysis/redirectUtils.ts` |
| Function: classifyTimingDrift() | ✅ Implemented | `src/analysis/classifiers.ts` |

### No Blockers

- All utilities (Chunks 0–3) are implemented and tested
- All types are exported from shared/diff.ts
- All constants are defined in constants.ts
- Validators (Chunk 4) are ready for use

---

## 2. Rule Evaluation Sequence (Mandatory Order)

Rules **MUST** be evaluated in this exact order:

```
PROBE RULES (A1, A2)
  ↓ (if probe failure, remaining rules may not apply)
ROUTING RULES (B1, B2, B3)
  ↓
SECURITY RULES (C1, C2)
  ↓
CACHE/CONTENT RULES (D1, D2, D3, D4, D5)
  ↓
TIMING RULES (E1)
  ↓
PLATFORM RULES (F1)
  ↓
CATCH-ALL RULES (G1)
  ↓
POST-PROCESSING
  → Validate all evidence via validateEvidenceKeys()
  → Deduplicate findings (same code + section + keys)
  → Sort findings (severity → code → message)
  → Return final array
```

---

## 3. Rule Specifications

### 3.1 Rule Group A: Probe Outcome Rules

#### Rule A1: PROBE_FAILURE (Both Probes Failed)

**Trigger:** `leftProbeOk === false AND rightProbeOk === false`

**Output:**
```typescript
{
  code: "PROBE_FAILURE",
  category: "unknown",
  severity: "critical",
  message: "Both probes failed",
  evidence: [{ section: "probe" }],
  left_value: leftProbe?.error || "Unknown error",
  right_value: rightProbe?.error || "Unknown error",
}
```

---

#### Rule A2: PROBE_FAILURE (One Probe Failed)

**Trigger:** `leftProbeOk XOR rightProbeOk` (one succeeded, one failed)

**Output (Left Failed):**
```typescript
{
  code: "PROBE_FAILURE",
  category: "unknown",
  severity: "critical",
  message: "Left probe failed; right succeeded",
  evidence: [{ section: "probe", keys: ["left"] }],
  left_value: leftProbe?.error || "Unknown error",
  right_value: rightProbe?.status,
}
```

**Output (Right Failed):** Analogous with keys: `["right"]`

---

### 3.2 Rule Group B: Routing Rules

#### Rule B1: STATUS_MISMATCH

**Trigger:** `leftStatus !== rightStatus`

**Severity Logic:**
```
critical = (leftStatus is 2xx AND rightStatus is 4xx/5xx) OR vice versa
         OR (leftStatus is 3xx AND rightStatus is not 3xx) OR vice versa
warn = all other mismatches
```

**Output:**
```typescript
{
  code: "STATUS_MISMATCH",
  category: "routing",
  severity: classifyStatusDrift(leftStatus, rightStatus),
  message: `Status differs: ${leftStatus} vs ${rightStatus}`,
  evidence: [{ section: "status" }],
  left_value: leftStatus,
  right_value: rightStatus,
}
```

---

#### Rule B2: FINAL_URL_MISMATCH

**Trigger:** `leftFinalUrl !== rightFinalUrl`

**Evidence Calculation:**
- Compare URL components: scheme, host, path, query
- Include in keys only those that differ (sorted)
- If all components differ: keys = `undefined` or `["finalUrl"]`

**Severity Logic:**
```
critical = scheme differs OR host differs
warn = only path or query differs
```

**Output:**
```typescript
{
  code: "FINAL_URL_MISMATCH",
  category: "routing",
  severity: classifyUrlDrift(leftFinalUrl, rightFinalUrl),
  message: `Final URL differs after redirects`,
  evidence: [{ section: "finalUrl", keys: [...diffingComponents] }],
  left_value: leftFinalUrl,
  right_value: rightFinalUrl,
}
```

---

#### Rule B3: REDIRECT_CHAIN_CHANGED

**Trigger:** `leftRedirectChain !== rightRedirectChain`

**Evidence Calculation:**
- Detect what changed: chain order, hop count, final host
- Include in keys only those that differ (sorted)

**Severity Logic:**
```
critical = hopCount differs by ≥2 OR finalHost differs
warn = chain differs but hopCount ≤1 difference
```

**Output:**
```typescript
{
  code: "REDIRECT_CHAIN_CHANGED",
  category: "routing",
  severity: classifyRedirectDrift(leftChain, rightChain),
  message: `Redirect chain differs`,
  evidence: [{ section: "redirects", keys: [...diffingComponents] }],
  left_value: leftChain,
  right_value: rightChain,
}
```

---

### 3.3 Rule Group C: Security Rules

#### Rule C1: AUTH_CHALLENGE_PRESENT

**Trigger:** `leftWwwAuth !== rightWwwAuth` (header differs)

**Severity Logic:**
```
critical = present on exactly one side
warn = present on both sides but value differs
```

**Output (Critical):**
```typescript
{
  code: "AUTH_CHALLENGE_PRESENT",
  category: "security",
  severity: "critical",
  message: `www-authenticate header present on one side only`,
  evidence: [{ section: "headers", keys: ["www-authenticate"] }],
  left_value: leftWwwAuth,
  right_value: rightWwwAuth,
}
```

---

#### Rule C2: CORS_HEADER_DRIFT

**Trigger:** Any `access-control-*` header differs

**Severity Logic:**
```
critical = access-control-allow-origin differs
warn = other access-control headers differ
```

**Evidence Calculation:**
- Collect all differing `access-control-*` headers
- Lowercase all header names
- Sort lexicographically

**Output:**
```typescript
{
  code: "CORS_HEADER_DRIFT",
  category: "security",
  severity: "critical" | "warn",
  message: `CORS headers differ`,
  evidence: [{ section: "headers", keys: ["access-control-allow-origin", "access-control-allow-credentials", ...] }],
  left_value: corsHeadersLeft,
  right_value: corsHeadersRight,
}
```

---

### 3.4 Rule Group D: Cache & Content Rules

#### Rule D1: CACHE_HEADER_DRIFT

**Trigger:** `leftCacheControl !== rightCacheControl`

**Use classifyCacheControlDrift() from cacheUtils.ts:**
```typescript
const severity = classifyCacheControlDrift(leftCacheControl, rightCacheControl);
```

**Output:**
```typescript
{
  code: "CACHE_HEADER_DRIFT",
  category: "cache",
  severity: severity,  // "critical" | "info"
  message: `Cache-control header differs`,
  evidence: [{ section: "headers", keys: ["cache-control"] }],
  left_value: leftCacheControl,
  right_value: rightCacheControl,
}
```

---

#### Rule D2: VARY_DRIFT

**Trigger:** `leftVary !== rightVary`

**Output:**
```typescript
{
  code: "UNKNOWN_DRIFT",
  category: "unknown",
  severity: "warn",
  message: `Vary header differs`,
  evidence: [{ section: "headers", keys: ["vary"] }],
  left_value: leftVary,
  right_value: rightVary,
}
```

---

#### Rule D3: CONTENT_TYPE_DRIFT

**Trigger:** `normalize(leftContentType) !== normalize(rightContentType)`

where `normalize(v) = v?.split(";")[0].trim().toLowerCase() || ""`

**Use getContentTypeSeverity() from contentUtils.ts:**
```typescript
const severity = getContentTypeSeverity(leftContentType, rightContentType);
```

**Output:**
```typescript
{
  code: "CONTENT_TYPE_DRIFT",
  category: "content",
  severity: severity,  // "critical" | "warn"
  message: `Content-Type differs`,
  evidence: [{ section: "headers", keys: ["content-type"] }],
  left_value: leftContentType,
  right_value: rightContentType,
}
```

---

#### Rule D4: BODY_HASH_DRIFT

**Trigger:** `leftBodyHash !== rightBodyHash AND leftStatus === rightStatus AND normalizedContentType(left) === normalizedContentType(right)`

**Use classifyBodyHashDrift() from contentUtils.ts:**
```typescript
const severity = classifyBodyHashDrift(leftBodyHash, rightBodyHash);
```

**Output:**
```typescript
{
  code: "BODY_HASH_DRIFT",
  category: "content",
  severity: "critical",
  message: `Response body content differs`,
  evidence: [{ section: "content", keys: ["body-hash"] }],
  left_value: leftBodyHash,
  right_value: rightBodyHash,
}
```

---

#### Rule D5: CONTENT_LENGTH_DRIFT

**Trigger:** `leftContentLength !== rightContentLength`

**Use classifyContentLengthDrift() from contentUtils.ts:**
```typescript
const severity = classifyContentLengthDrift(
  leftContentLength,
  rightContentLength,
  leftStatus === rightStatus
);
```

**Output:**
```typescript
{
  code: "CONTENT_LENGTH_DRIFT",
  category: "content",
  severity: severity,  // "info" | "warn" | "critical"
  message: `Content-Length differs by ${delta} bytes`,
  evidence: [{ section: "content", keys: ["content-length"] }],
  left_value: leftContentLength,
  right_value: rightContentLength,
}
```

---

### 3.5 Rule Group E: Timing Rules

#### Rule E1: TIMING_DRIFT

**Trigger:** `leftDuration_ms !== rightDuration_ms AND max(left, right) >= 50`

**Use classifyTimingDrift() from classifiers.ts:**
```typescript
const severity = classifyTimingDrift(leftDuration_ms, rightDuration_ms);
```

**Output:**
```typescript
{
  code: "TIMING_DRIFT",
  category: "timing",
  severity: severity,  // "info" | "warn" | "critical"
  message: `Response duration differs: ${leftDuration}ms vs ${rightDuration}ms`,
  evidence: [{ section: "timing", keys: ["duration_ms"] }],
  left_value: leftDuration_ms,
  right_value: rightDuration_ms,
}
```

---

### 3.6 Rule Group F: Platform Rules

#### Rule F1: CF_CONTEXT_DRIFT

**Trigger:** `leftColo !== rightColo OR leftAsn !== rightAsn OR leftCountry !== rightCountry`

**Severity Logic (Soft Correlation):**
```
Determine if timing drift is also present (check findings array)
If timing drift exists: severity = "warn"
If no timing drift: severity = "info"
```

**Evidence Calculation:**
- Collect differing CF fields: colo, asn, country
- Sort lexicographically

**Output:**
```typescript
{
  code: "CF_CONTEXT_DRIFT",
  category: "platform",
  severity: timingDriftPresent ? "warn" : "info",
  message: `Cloudflare context differs (colo/asn/country)`,
  evidence: [{ section: "cf", keys: ["asn", "colo"] }],  // sorted
  left_value: { colo, asn, country },
  right_value: { colo, asn, country },
}
```

---

### 3.7 Rule Group G: Catch-All Header Rule

#### Rule G1: UNKNOWN_DRIFT (Remaining Headers)

**Trigger:** Any allowlisted header differs and is NOT claimed by earlier rules (C1, C2, D1, D2, D3)

**Use getHeaderDiffsMap() from headerDiff.ts to get all header diffs**

**Exclusions (Don't include in evidence):**
- `www-authenticate` (claimed by C1)
- `access-control-*` (claimed by C2)
- `cache-control` (claimed by D1)
- `vary` (claimed by D2)
- `content-type` (claimed by D3)

**Severity Logic:**
```
warn = ≥3 unclaimed headers differ
info = <3 unclaimed headers differ
```

**Output:**
```typescript
{
  code: "UNKNOWN_DRIFT",
  category: "unknown",
  severity: unclaimedHeaders.length >= 3 ? "warn" : "info",
  message: `${unclaimedHeaders.length} header(s) differ: ${unclaimedHeaders.join(", ")}`,
  evidence: [{ section: "headers", keys: [...unclaimedHeaders] }],  // sorted
  left_value: headerDiffsMap,
  right_value: headerDiffsMap,
}
```

---

## 4. Module Implementation

### 4.1 Type Definition

```typescript
export type ClassifyFunction = (diff: EnvDiff) => DiffFinding[];
```

### 4.2 Main Function: `classify()`

```typescript
/**
 * Classify EnvDiff and generate deterministic findings.
 *
 * Per Phase-B2.md §5, evaluates all 14 rules in mandatory sequence:
 * A1/A2 (probe) → B1/B2/B3 (routing) → C1/C2 (security) → D1/D2/D3/D4/D5 (cache/content)
 * → E1 (timing) → F1 (platform) → G1 (headers catch-all)
 *
 * Then applies global determinism rules:
 * - Validate all evidence via validateEvidenceKeys()
 * - Deduplicate findings (same code + section + keys)
 * - Sort by severity (critical > warn > info), then code, then message
 *
 * @param diff - EnvDiff from probe comparison
 * @returns Array of DiffFinding items, sorted and deduplicated
 */
export function classify(diff: EnvDiff): DiffFinding[]
```

### 4.3 Helper Functions (Optional but Recommended)

```typescript
/**
 * Generate finding ID from code, section, and keys.
 * Format: "${code}:${section}:${sortedKeys.join(',')}"
 */
function generateFindingId(
  code: DiffFindingCode,
  section: string,
  keys?: string[]
): string

/**
 * Deduplicate findings by ID.
 * Keep first occurrence, discard subsequent duplicates.
 */
function deduplicateFindings(findings: DiffFinding[]): DiffFinding[]

/**
 * Sort findings by severity (critical > warn > info), then code, then message.
 */
function sortFindings(findings: DiffFinding[]): DiffFinding[]

/**
 * Validate all findings' evidence via validateEvidenceKeys().
 * Throw if any evidence is invalid.
 */
function validateAllEvidence(findings: DiffFinding[]): void
```

### 4.4 Evaluation Algorithm (Pseudo-code)

```
findings = []

// A. Probe Rules
if (leftProbeOk === false AND rightProbeOk === false)
  findings.push(PROBE_FAILURE_BOTH)
else if (leftProbeOk XOR rightProbeOk)
  findings.push(PROBE_FAILURE_ONE)

// B. Routing Rules (only if probes succeeded)
if (leftProbeOk AND rightProbeOk)
  if (leftStatus !== rightStatus)
    findings.push(STATUS_MISMATCH)
  if (leftFinalUrl !== rightFinalUrl)
    findings.push(FINAL_URL_MISMATCH)
  if (leftRedirectChain !== rightRedirectChain)
    findings.push(REDIRECT_CHAIN_CHANGED)

// C. Security Rules
if (leftWwwAuth !== rightWwwAuth)
  findings.push(AUTH_CHALLENGE_PRESENT)
if (corsHeadersDiffer(left, right))
  findings.push(CORS_HEADER_DRIFT)

// D. Cache/Content Rules
if (leftCacheControl !== rightCacheControl)
  findings.push(CACHE_HEADER_DRIFT)
if (leftVary !== rightVary)
  findings.push(VARY_DRIFT)
if (normalizedContentType(left) !== normalizedContentType(right))
  findings.push(CONTENT_TYPE_DRIFT)
if (bodyHashShouldTrigger(left, right))
  findings.push(BODY_HASH_DRIFT)
if (leftContentLength !== rightContentLength)
  findings.push(CONTENT_LENGTH_DRIFT)

// E. Timing Rules
if (timingDriftDetected(left, right))
  findings.push(TIMING_DRIFT)

// F. Platform Rules
if (cfContextDiffers(left, right))
  timingDriftPresent = findingExists("TIMING_DRIFT", findings)
  findings.push(CF_CONTEXT_DRIFT with severity = timingDriftPresent ? "warn" : "info")

// G. Catch-All Rules
unclaimedHeaders = getUnclaimedHeaderDiffs(left, right, findings)
if (unclaimedHeaders.length > 0)
  findings.push(UNKNOWN_DRIFT)

// Post-Processing
validateAllEvidence(findings)
findings = deduplicateFindings(findings)
findings = sortFindings(findings)

return findings
```

---

## 5. Test Strategy

### Test Coverage: 60+ test cases

**Test Categories:**

#### 5.1 Probe Rules (6 tests)
- Both probes failed
- Left probe failed, right succeeded
- Right probe failed, left succeeded
- Both probes succeeded (no finding)
- Probe with error details preserved
- Probe finding includes correct evidence

#### 5.2 Status Rules (6 tests)
- 2xx vs 5xx → critical
- 3xx vs 2xx → critical
- 200 vs 201 → warn
- Matching status → no finding
- Evidence correctly identifies status section
- Message contains both status codes

#### 5.3 URL Rules (8 tests)
- Host differs → critical
- Scheme differs → critical
- Path differs → warn
- Query differs → warn
- Multiple components differ → evidence includes all
- Evidence keys are sorted
- URL comparison is case-sensitive (URLs preserve case)

#### 5.4 Redirect Rules (6 tests)
- Hop count differs by ≥2 → critical
- Final host differs → critical
- Chain differs but hop count ≤1 → warn
- No change → no finding
- Evidence identifies changed components
- Evidence keys are sorted

#### 5.5 Auth Rules (4 tests)
- www-authenticate present on one side only → critical
- www-authenticate present on both but differs → warn
- No change → no finding
- Evidence is lowercased

#### 5.6 CORS Rules (6 tests)
- access-control-allow-origin differs → critical
- Other access-control headers differ → warn
- Multiple CORS headers differ → all included in evidence
- Evidence keys are sorted and lowercased
- No change → no finding
- Non-CORS headers not included

#### 5.7 Cache Rules (6 tests)
- no-store appears on one side → critical
- private appears on one side → critical
- Both sides have no-store → info
- cache-control removed (non-critical) → info
- cache-control removed (critical) → critical
- Evidence identifies cache-control section

#### 5.8 Vary Rules (2 tests)
- Vary header differs → "UNKNOWN_DRIFT", warn
- No change → no finding

#### 5.9 Content-Type Rules (6 tests)
- text/html vs application/json → critical
- text/plain vs text/html → warn
- Both same (normalize charset away) → no finding
- Charset parameter ignored in comparison
- Evidence identifies content-type section
- Content-Type case-insensitive comparison

#### 5.10 Body Hash Rules (4 tests)
- Body hash differs, same status, same content-type → critical
- Body hash differs but status changed → no finding (status change explains it)
- Body hash differs but content-type changed → no finding
- Evidence identifies body-hash section

#### 5.11 Content-Length Rules (6 tests)
- Delta < 200B → info
- Delta 200-2000B → warn
- Delta ≥2000B, status same → critical
- Delta ≥2000B, status changed → warn
- No change → no finding
- Evidence identifies content-length section

#### 5.12 Timing Rules (6 tests)
- Duration differs, ratio ≥2.5 → critical
- Duration differs, delta ≥1000ms → critical
- Duration differs, ratio 1.5-2.5 → warn
- Duration differs, delta 300-1000ms → warn
- Max duration < 50ms → info (or no finding)
- Evidence identifies duration_ms section

#### 5.13 Platform Rules (6 tests)
- CF context differs, no timing drift → info
- CF context differs, timing drift present → warn
- Evidence includes differing components (sorted)
- Multiple CF components differ → all in evidence
- No change → no finding

#### 5.14 Catch-All Header Rules (6 tests)
- 3+ unclaimed headers differ → warn
- <3 unclaimed headers differ → info
- Excluded headers (www-authenticate, etc.) not included
- Evidence keys are sorted and lowercased
- No unclaimed headers → no finding

#### 5.15 Post-Processing (8 tests)
- Deduplication: identical findings collapsed
- Sorting: severity > code > message order verified
- Evidence validation: all evidence passes validateEvidenceKeys()
- Determinism: same input → same output
- Empty findings returned if no rules triggered
- Finding IDs are unique and stable
- Evidence note (optional) preserved if present
- Findings preserve left_value and right_value

#### 5.16 Integration Tests (4 tests)
- Complex multi-rule scenario (status + headers + timing)
- Rule precedence: earlier rules triggered before later rules
- Evidence deduplication with multiple sections
- Realistic EnvDiff from actual probes

---

## 6. Implementation Checklist

### Code Phase

- [ ] Create `src/analysis/classify.ts` (150 lines code + 40 lines JSDoc)
- [ ] Import all utilities from Chunks 0–3
- [ ] Import validators from Chunk 4
- [ ] Implement `classify()` main function
- [ ] Implement rule functions (A1, A2, B1, B2, B3, C1, C2, D1, D2, D3, D4, D5, E1, F1, G1)
- [ ] Implement helper functions (dedup, sort, validate)
- [ ] Add JSDoc to all functions
- [ ] Verify no TypeScript errors
- [ ] Verify determinism (test with byte-hashing input/output)

### Test Phase

- [ ] Create `src/analysis/__tests__/classify.test.ts` (400 lines)
- [ ] Organize tests into 16 describe blocks (one per rule group + post-processing)
- [ ] Write 6+ tests per rule group (60+ total)
- [ ] Write integration tests
- [ ] Run tests: `npm test -- classify.test.ts`
- [ ] Verify all tests pass
- [ ] Verify 100% line coverage
- [ ] Verify 100% branch coverage
- [ ] Verify determinism tests pass

### Quality Assurance

- [ ] No `any` types used
- [ ] All imports properly scoped
- [ ] Deterministic function (same input → same output)
- [ ] No side effects (no logging, no mutations)
- [ ] No external dependencies (only chunks 0–3 + validators)
- [ ] Matches Phase-B2.md §5 exactly
- [ ] Test descriptions align with Phase-B2.md examples
- [ ] Evidence always validated before return
- [ ] All findings include evidence and message

---

## 7. Key Design Decisions

| Decision | Rationale | Implication |
|----------|-----------|-------------|
| **Evaluate rules in mandatory sequence** | Phase-B2.md §5 specifies order | Rules must not be reordered or evaluated in parallel |
| **Return DiffFinding[], not throw** | Deterministic output, no exceptions | Callers handle unexpected findings gracefully |
| **Deduplicate before return** | Phase-B2.md §1.4 mandate | Same evidence + code cannot appear twice |
| **Sort findings by severity→code→message** | Phase-B2.md §1.4 mandate | Output is stable and predictable |
| **Validate all evidence before return** | Phase-B2.md §1.1–1.3 mandate | Findings are never persisted with invalid evidence |
| **F1 severity depends on E1 presence** | Soft correlation design | CF context drift severity varies by timing drift |
| **G1 excludes earlier-claimed headers** | Prevent duplicate findings | Same header not emitted by C1, C2, D1, D2, D3 AND G1 |
| **Evidence keys always sorted** | Phase-B2.md §1.1 mandate | No ordering ambiguity in evidence |
| **Normalize URL/ContentType before compare** | RFC 7230/7231 compliance | Case-insensitive header names, URL scheme/host |

---

## 8. Acceptance Criteria

### ✅ Functional (Per Phase-B2.md §5)

- [ ] Rule A1 triggers when both probes failed
- [ ] Rule A2 triggers when one probe failed
- [ ] Rule B1 triggers on status mismatch with correct severity
- [ ] Rule B2 triggers on URL mismatch with correct severity and evidence
- [ ] Rule B3 triggers on redirect chain mismatch with correct severity
- [ ] Rule C1 triggers on www-authenticate mismatch with correct severity
- [ ] Rule C2 triggers on CORS header mismatch with correct severity
- [ ] Rule D1 triggers on cache-control mismatch with correct severity
- [ ] Rule D2 triggers on vary mismatch with severity = warn
- [ ] Rule D3 triggers on content-type mismatch with correct severity
- [ ] Rule D4 triggers only when conditions met (status/type unchanged)
- [ ] Rule D5 triggers on content-length mismatch with correct severity
- [ ] Rule E1 triggers on timing drift with correct severity
- [ ] Rule F1 triggers on CF context drift with severity = warn/info based on timing
- [ ] Rule G1 triggers on unclaimed header diffs with correct severity

### ✅ Code Quality

- [ ] JSDoc complete for all functions
- [ ] No `any` types
- [ ] No console.log or debugging code
- [ ] No external dependencies (only chunks 0–3 + validators + constants)
- [ ] Matches Phase-B2.md exactly
- [ ] Function is deterministic (same input → same output every time)

### ✅ Testing

- [ ] 60+ test cases (covering all 14 rules + post-processing)
- [ ] Valid scenarios trigger correct findings
- [ ] Invalid scenarios don't trigger findings
- [ ] Edge cases handled
- [ ] 100% line coverage
- [ ] 100% branch coverage
- [ ] No skipped tests

### ✅ Determinism

- [ ] Function output never depends on timestamps, randomness, or state
- [ ] Same EnvDiff always produces same DiffFinding[]
- [ ] No mutations of input diff
- [ ] Findings array is always sorted identically
- [ ] Evidence is always sorted identically

---

## 9. Related Files

**Upstream Dependencies (All Complete ✅):**
- `src/analysis/cacheUtils.ts` — classifyCacheControlDrift()
- `src/analysis/contentUtils.ts` — getContentTypeSeverity(), classifyBodyHashDrift(), classifyContentLengthDrift()
- `src/analysis/headerDiff.ts` — getHeaderDiffsMap()
- `src/analysis/urlUtils.ts` — classifyUrlDrift()
- `src/analysis/redirectUtils.ts` — classifyRedirectDrift()
- `src/analysis/classifiers.ts` — classifyTimingDrift()
- `src/analysis/validators.ts` — validateEvidenceKeys()
- `src/analysis/constants.ts` — TIMING_CONSTANTS, CONTENT_THRESHOLDS, CACHE_CRITICAL_KEYWORDS

**Downstream Dependents (Will use Chunk 5):**
- Workflow orchestration (future integration)
- Frontend result display
- Comparison persistence in DO

**Documentation References:**
- Phase-B2.md §5 — All 14 rules
- Phase-B2.md §1 — Global determinism rules
- IMPLEMENTATION_CHUNKS.md §5 — Chunk 5 specification

---

## 10. Summary

**Chunk 5 is the final orchestrator, combining all utilities into deterministic finding generation:**

✅ **No ambiguity** — All 14 rules explicitly defined in Phase-B2.md §5
✅ **No blockers** — All utilities and validators available from Chunks 0–4
✅ **High confidence** — Specification is complete and unambiguous
✅ **Determinism guaranteed** — Same EnvDiff → Same DiffFinding[] every time

**Estimated completion: 90 minutes (45 min code + 45 min tests)**

**Ready to proceed with implementation.** 🚀

---

**Design Document Status:** ✅ Complete
**Design Version:** 1.0
**Last Updated:** 2026-01-11
**Ready for Implementation:** YES