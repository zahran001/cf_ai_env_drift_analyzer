# Phase B2 Implementation Roadmap

**Purpose:** Concrete, ordered steps before writing any Phase B2 code

---

## Pre-Implementation Setup (Do First)

### ✅ 1. Resolve Ambiguity: CF Context Drift Correlation — COMPLETED
**Decision (2026-01-07):** Option B — Soft Correlation

- ✅ **Decided:** CF_CONTEXT_DRIFT uses **soft correlation** (lower severity if no timing drift)
- ✅ **Documented** in Phase-B2.md §4.F1
- ✅ **Ready for:** classify.ts Rule F1 implementation

**Implementation Rule:**
```typescript
if (cfContextDiffers) {
  severity = hasTimingDrift ? "warn" : "info";
}
```

**Rationale:** Infrastructure visibility; users see colo/ASN changes even if timing unaffected (yet).

---

## Phase B2 Utility Modules (Build These First)

All modules in `src/analysis/` unless noted otherwise.

### 🔴 Critical Path (Required for Core Logic)

#### 1. Probe Utils → `probeUtils.ts`
**Purpose:** Convert two SignalEnvelopes → ProbeOutcomeDiff
- [ ] Implement `compileProbeOutcomeDiff(left, right): ProbeOutcomeDiff`
- [ ] Extract `leftOk`, `rightOk`, error codes, `outcomeChanged`
- [ ] **Tests:** Verify both-failed, one-failed, both-succeeded scenarios

**Blocks:** Rules A1, A2 (probe failure detection)

---

#### 2. URL Utils → `urlUtils.ts`
**Purpose:** Parse URLs and classify drift severity
- [ ] Implement `parseUrlComponents(url): { scheme, host, path, query }`
- [ ] Implement `classifyUrlDrift(left, right): { severity, diffType: string[] }`
- [ ] Extract scheme/host vs path/query difference logic
- [ ] **Tests:** Verify scheme-differs = critical, path-differs = warn

**Blocks:** Rule B2 (FINAL_URL_MISMATCH)

---

#### 3. Status Classifier → `classifiers.ts`
**Purpose:** Classify HTTP status code differences
- [ ] Implement `classifyStatusDrift(left, right): Severity`
- [ ] Logic: 2xx vs 4xx/5xx = critical, 3xx vs non-3xx = critical, else = warn
- [ ] **Tests:** Test all combinations against Phase-B2.md §4.B1

**Blocks:** Rule B1 (STATUS_MISMATCH)

---

#### 4. Header Diff Compiler → `headerDiff.ts`
**Purpose:** Normalize headers, enforce whitelist, compute added/removed/changed
- [ ] Implement `computeHeaderDiff(leftHeaders, rightHeaders): { core, accessControl }`
- [ ] Enforce whitelist: only capture `cache-control`, `content-type`, `vary`, `www-authenticate`, `location`, `access-control-*`
- [ ] Normalize all keys to lowercase
- [ ] Compute HeaderDiff<K> with added/removed/changed/unchanged
- [ ] **Tests:** Verify whitelist enforcement, case-insensitivity, categorization

**Blocks:** Rules C1, C2, D1, D2, D3, G1 (header-based findings)

---

#### 5. Content Utils → `contentUtils.ts`
**Purpose:** Handle content-type normalization and content-length severity
- [ ] Implement `normalizeContentType(ct): string`
- [ ] Normalize: `split(";")[0].trim().toLowerCase()`
- [ ] Implement `classifyContentTypeDrift(left, right): Severity`
- [ ] Logic: text/html vs application/json = critical, else = warn
- [ ] Implement `classifyContentLengthDrift(left, right, statusChanged): Severity`
- [ ] Logic: delta >= 2000 && !statusChanged = critical, delta >= 200 = warn, else = info
- [ ] **Tests:** Verify normalization, major-type detection, byte thresholds

**Blocks:** Rules D3, D5 (content-type and content-length)

---

#### 6. Redirect Utils → `redirectUtils.ts`
**Purpose:** Compare redirect chains and classify drift
- [ ] Implement `compareRedirectChains(left, right): { chainChanged, hopCountDelta, finalHostChanged, severity }`
- [ ] Compare hop counts (delta >= 2 = critical)
- [ ] Extract final host and compare (differs = critical)
- [ ] **Tests:** Verify hop count delta, final host comparison

**Blocks:** Rule B3 (REDIRECT_CHAIN_CHANGED)

---

#### 7. Cache Utils → `cacheUtils.ts`
**Purpose:** Parse cache-control directives
- [ ] Implement `hasCacheControlKeyword(header, keyword): boolean`
- [ ] Detect `no-store` and `private` keywords
- [ ] Implement `classifyCacheControlDrift(left, right): Severity`
- [ ] Logic: presence of no-store or private differs = critical, else = warn
- [ ] **Tests:** Verify keyword detection with various formats

**Blocks:** Rule D1 (CACHE_HEADER_DRIFT)

---

#### 8. Validators → `validators.ts`
**Purpose:** Validate evidence against Phase-B2.md vocabulary
- [ ] Implement `isValidEvidenceKey(section, key): boolean`
- [ ] Reference table for each section's allowed keys (from Phase-B2.md §1.3)
- [ ] Implement `validateDiffEvidence(evidence): boolean`
- [ ] **Tests:** Verify all valid/invalid key combinations

**Used By:** Error checking during classify.ts development

---

#### 9. Sorting Utils → shared/diff.ts or `sorting.ts`
**Purpose:** Sort findings deterministically
- [ ] Implement `sortFindings(findings): DiffFinding[]`
- [ ] Sort by: severity (critical > warn > info), code (lex), message (lex)
- [ ] Export `SEVERITY_ORDER` map
- [ ] **Tests:** Verify stable sort order

**Used By:** Final step in `classifyDiff()`

---

### 🟡 High Priority (Needed for classify.ts)

#### 10. Constants → `src/analysis/constants.ts`
**Purpose:** Centralize Phase-B2.md constants
- [ ] Export `TIMING_DRIFT_THRESHOLDS` (MIN_TIMING_LEFT_MS, ABS_DELTA_WARN_MS, etc.)
- [ ] Export `FINDING_RULE_MAP` lightweight registry
- [ ] **Tests:** Verify all constants are populated

**Used By:** Timing and other threshold-based logic

---

#### 11. Shared Diff Helpers → `shared/diff.ts`
**Purpose:** Add deduplication and ID generation helpers
- [ ] Implement `computeFindingDeduplicateKey(code, section, keys): string`
- [ ] Format: `${code}:${section}:${sortedKeys.join(",")}`
- [ ] Implement `computeFindingId(code, evidence): string`
- [ ] **Tests:** Verify stable key generation

**Used By:** Deduplication logic in classify.ts

---

## Core classify.ts Implementation

### Architecture

```
computeEnvDiff(left: SignalEnvelope, right: SignalEnvelope): EnvDiff
  ├─ 1. Compile probe outcome → ProbeOutcomeDiff
  ├─ 2. Extract structured diffs (status, finalUrl, headers, redirects, content, timing, cf)
  ├─ 3. Emit findings in Phase-B2.md order (Rules A1/A2, B1–B3, C1–C2, D1–D5, E1, F1, G1)
  ├─ 4. Deduplicate findings
  ├─ 5. Sort findings
  └─ 6. Compute maxSeverity & return EnvDiff

emitFinding(code, category, severity, message, evidence, values?): DiffFinding
  ├─ Generate id via computeFindingId()
  ├─ Populate left_value / right_value if provided
  └─ Return structured finding
```

### Implementation Order

1. **Skeleton:** `export function computeEnvDiff(left: SignalEnvelope, right: SignalEnvelope): EnvDiff { ... }`
2. **Step 1:** Probe outcome (Rule A1/A2)
3. **Step 2:** Status diff (Rule B1)
4. **Step 3:** Final URL diff (Rule B2)
5. **Step 4:** Redirect chain diff (Rule B3)
6. **Step 5:** Auth challenges (Rule C1)
7. **Step 6:** CORS headers (Rule C2)
8. **Step 7:** Cache headers (Rule D1)
9. **Step 8:** Vary headers (Rule D2)
10. **Step 9:** Content-type diff (Rule D3)
11. **Step 10:** Body hash (Rule D4)
12. **Step 11:** Content length (Rule D5)
13. **Step 12:** Timing drift (Rule E1)
14. **Step 13:** CF context (Rule F1)
15. **Step 14:** Remaining headers (Rule G1)
16. **Post-process:** Deduplicate, sort, maxSeverity

---

## Testing Strategy

### Unit Tests (Per Utility)

Each utility module gets a `*.test.ts` file:

```
src/analysis/
├─ probeUtils.ts
├─ probeUtils.test.ts
├─ classifiers.ts
├─ classifiers.test.ts
└─ ...
```

### Integration Test (classify.ts)

Create **snapshot tests** with known inputs from Phase-B2.md examples:

```typescript
describe("classifyDiff - Phase B2 Integration", () => {
  it("A1: Both probes failed", () => {
    const left = { ...mockEnvelope, result: { ok: false, error: { code: "timeout" } } };
    const right = { ...mockEnvelope, result: { ok: false, error: { code: "dns_error" } } };
    const diff = computeEnvDiff(left, right);
    expect(diff.findings).toMatchSnapshot();
  });

  it("B1: Status mismatch critical", () => {
    const left = { ...mockEnvelope, result: { ok: true, response: { status: 200, ... } } };
    const right = { ...mockEnvelope, result: { ok: true, response: { status: 500, ... } } };
    const diff = computeEnvDiff(left, right);
    expect(diff.findings[0]).toMatchObject({
      code: "STATUS_MISMATCH",
      severity: "critical"
    });
  });

  // ... etc for all 14 rule groups
});
```

---

## Blocking Dependencies

```
Phase B2 Implementation
├─ Requires: All 🔴 Critical modules
├─ Requires: Constants (🟡)
├─ Requires: Shared diff helpers (🟡)
├─ Requires: Testing setup
└─ Blocked By: CF context correlation clarification (§15)
```

---

## Deliverables Checklist

### Before classify.ts is Written

- [ ] All 11 utility modules implemented and tested
- [ ] `TIMING_DRIFT_THRESHOLDS` in code
- [ ] `FINDING_RULE_MAP` registry created
- [ ] Shared diff helpers (`computeFindingDeduplicateKey`, etc.)
- [ ] Evidence validator implemented
- [ ] Sorting logic finalized
- [ ] CF context correlation decision documented

### During classify.ts Implementation

- [ ] `computeEnvDiff()` orchestrates all utilities
- [ ] All 14 rule groups implemented
- [ ] Every finding has correct code, category, severity, evidence
- [ ] Deduplication applied
- [ ] Findings sorted by (severity, code, message)
- [ ] maxSeverity computed

### After classify.ts Implementation

- [ ] All snapshot tests pass
- [ ] Output matches Phase-B2.md examples byte-for-byte
- [ ] Evidence keys validated against Phase-B2.md §1.3
- [ ] Code review checklist complete (CLAUDE.md §15)

---

## Timeline Estimate

| Phase | Tasks | Est. | Notes |
|-------|-------|------|-------|
| Setup | Clarify CF context, create file structure | 0.5h | Parallel with team |
| Utilities | Build 11 modules + tests | 4–6h | Most is straightforward logic |
| classify.ts | Orchestrate rules + dedup + sort | 2–3h | Follow Phase-B2.md order exactly |
| Testing | Snapshot tests, edge cases | 2–3h | Most effort is validating examples |
| **Total** | | **9–13h** | Assumes no major blockers |

---

## Next Action

1. **Copy this roadmap to PHASE_B2_DESIGN_DECISIONS.md**
2. **Create directory structure:**
   ```
   src/analysis/
   ├─ probeUtils.ts
   ├─ urlUtils.ts
   ├─ classifiers.ts
   ├─ headerDiff.ts
   ├─ contentUtils.ts
   ├─ redirectUtils.ts
   ├─ cacheUtils.ts
   ├─ validators.ts
   ├─ constants.ts
   ├─ classify.ts (main orchestrator)
   └─ diff.ts (compute diff, TBD)
   ```
3. **Resolve CF context ambiguity**
4. **Start with utility modules in order (🔴 first, then 🟡)**
5. **Write tests in parallel**
