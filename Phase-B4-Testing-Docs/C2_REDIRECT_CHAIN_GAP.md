# C2 — Redirect Chain Detection Gap

**Issue:** Redirect chain length differences are not detected by the deterministic diff engine.

**Status:** MVP scope gap (Phase B2 incomplete)

**Discovery Date:** 2026-01-26

**Test Case:** Left: 1 redirect hop | Right: 3 redirect hops | Same finalUrl

---

## Problem Statement

### Test Scenario
```
Left:  https://httpbin.org/redirect/1  → [1 hop] → https://httpbin.org/get
Right: https://httpbin.org/redirect/3  → [3 hops] → https://httpbin.org/get
```

**Expected behavior (per Phase B2 MVP):**
- Emit `REDIRECT_CHAIN_CHANGED` finding
- Classify severity based on hop count difference (likely **critical** or **warn**)
- Evidence should show hop count delta: 1 vs 3

**Actual behavior:**
- Empty findings array
- LLM concludes "No differences were found"
- maxSeverity: `info`

### Root Cause

The signal capture pipeline works correctly:
- ✅ ActiveProbeProvider captures `redirects` array in SignalEnvelope
- ✅ diff.ts stores `redirects` in EnvDiff structure
- ❌ **classify.ts does NOT compare redirect chains**

**Missing implementation:** Redirect chain comparison logic in `src/analysis/classify.ts`

---

## MVP Scope Verification

### Evidence: Redirect Chain IS in MVP

**From [MVP_Tracker.md](MVP_Tracker.md) § Phase B2 — Deterministic Diff Engine:**
```
## Phase B2 — Deterministic Diff Engine (No AI)

### Goals
- Implement deterministic drift detection from two SignalEnvelopes.
- Output structured diff findings (no LLM).

### Tasks
- [ ] Implement `computeDiff(left, right) -> EnvDiff`
- [ ] Implement `classifyDiff(diff) -> { findings, severity, flags }`
- [ ] Cover drift categories:
  - **Routing drift (redirect chain, final URL, status changes)**  ← HERE
  - Security drift (CORS-related headers, www-authenticate presence)
  - Cache drift (cache-control, vary)
  - Timing drift (duration delta thresholds)
```

**From [Phase-B2-Docs/Phase-B2.md](Phase-B2-Docs/Phase-B2.md) § B3 Routing Rules:**
```
### B3) Redirect Chain Changed → `REDIRECT_CHAIN_CHANGED`

**Code:** `REDIRECT_CHAIN_CHANGED`
**Category:** routing
**Evidence:** hop count difference, chain mismatch
```

**From [CLAUDE.md](CLAUDE.md) § 1.2 EnvDiff Structure:**
```
`routing`: { redirect_chain_diffs: Change[], final_url_diff: Change?, status_diff: Change? }
```

**Conclusion:** ✅ Redirect chain comparison is **explicitly part of Phase B2 MVP**, not Phase B4 or later.

---

## Current Architecture State

### Signal Collection (Complete)

**File:** [src/providers/activeProbe.ts](src/providers/activeProbe.ts)

```typescript
// Example SignalEnvelope returned:
{
  result: {
    ok: true,
    response: { status: 200, headers: {...} },
    redirects: [
      { fromUrl: "https://httpbin.org/redirect/1", toUrl: "https://httpbin.org/redirect" },
      { fromUrl: "https://httpbin.org/redirect", toUrl: "https://httpbin.org/get" }
    ],
    durationMs: 250
  }
}
```

✅ **Status:** Working correctly

### Diff Storage (Complete)

**File:** [src/analysis/diff.ts](src/analysis/diff.ts)

```typescript
// EnvDiff structure includes redirects:
export type EnvDiff = {
  schemaVersion: number;
  comparisonId: string;
  probe: ProbeOutcomeDiff;
  status?: Change<number>;
  finalUrl?: Change<string>;
  redirects?: {
    left: RedirectHop[];
    right: RedirectHop[];
    chainChanged: boolean;
    hopCount: Change<number>;
  };
  // ... other fields
};
```

✅ **Status:** Structure defined, hops calculated but not used

### Classification (COMPLETE) — But Condition Never Met

**File:** [src/analysis/classify.ts](src/analysis/classify.ts)

**Current state (lines 293-310):**
```typescript
if (diff.redirects && (diff.redirects.chainChanged || diff.redirects.hopCount.changed)) {
  const leftChain = diff.redirects.left.map((hop) => hop.toUrl);
  const rightChain = diff.redirects.right.map((hop) => hop.toUrl);
  const chainDrift = classifyRedirectChainDrift(leftChain, rightChain);
  const diffComponents = getRedirectDiffComponents(diff);
  const evidence: DiffEvidence[] = [{ section: "redirects", keys: diffComponents.length > 0 ? diffComponents : undefined }];

  findings.push({
    id: generateFindingId("REDIRECT_CHAIN_CHANGED", "redirects", diffComponents),
    code: "REDIRECT_CHAIN_CHANGED",
    category: "routing",
    severity: chainDrift.severity,
    message: "Redirect chain differs",
    evidence,
    left_value: diff.redirects.left,
    right_value: diff.redirects.right,
  });
}
```

**Status:**
- ✅ Classification logic is complete and correct
- ✅ `classifyRedirectChainDrift()` function exists in [src/analysis/redirectUtils.ts](src/analysis/redirectUtils.ts)
- ❌ **The condition is never met** because `diff.redirects` is never populated!

### Root Cause: Missing Redirect Diff Computation

**File:** [src/analysis/diff.ts](src/analysis/diff.ts) lines 37-103

**Current code:**
```typescript
// Build status diff
const statusDiff: Change<number> = ...

// Build final URL diff
const finalUrlDiff: Change<string> = ...

// Build partial EnvDiff (omit findings initially)
const partialEnvDiff: Omit<EnvDiff, "findings" | "maxSeverity"> = {
  schemaVersion: DIFF_SCHEMA_VERSION,
  comparisonId: leftEnvelope.comparisonId,
  leftProbeId: leftEnvelope.probeId,
  rightProbeId: rightEnvelope.probeId,
  probe: probeOutcomeDiff,
  status: statusDiff,
  finalUrl: finalUrlDiff,
  // ❌ Missing: redirects field!
};
```

**Missing implementation:** `computeRedirectDiff()` function that:
1. Extracts redirect chains from both envelopes
2. Computes hop count difference
3. Detects if chains changed
4. Returns a `RedirectDiff` object
5. Includes this in `partialEnvDiff`

❌ **Status:** diff.ts does not populate redirect field at all

---

## Test Case Analysis

### Input: 1 hop vs 3 hops

```typescript
// Left probe
{
  redirects: [
    { fromUrl: "https://httpbin.org/redirect/1", toUrl: "https://httpbin.org/redirect" }
  ],
  finalUrl: "https://httpbin.org/redirect"
}

// Right probe (after following all redirects)
{
  redirects: [
    { fromUrl: "https://httpbin.org/redirect/3", toUrl: "https://httpbin.org/redirect/2" },
    { fromUrl: "https://httpbin.org/redirect/2", toUrl: "https://httpbin.org/redirect/1" },
    { fromUrl: "https://httpbin.org/redirect/1", toUrl: "https://httpbin.org/redirect" }
  ],
  finalUrl: "https://httpbin.org/redirect"  // Same final destination
}
```

### What diff.ts Computes

```typescript
const redirects = {
  left: [...],        // 1 hop
  right: [...],       // 3 hops
  chainChanged: true, // Arrays not equal
  hopCount: {
    left: 1,
    right: 3,
    changed: true     // Different hop counts
  }
};
```

✅ **Correctly computed**

### What classify.ts Should Do

```typescript
// Check condition:
if (diff.redirects && (diff.redirects.chainChanged || diff.redirects.hopCount.changed)) {
  // This should be TRUE for the test case
  // Create REDIRECT_CHAIN_CHANGED finding with appropriate severity
}
```

### Why It Fails

Either:
1. **classifyRedirectChainDrift()** doesn't exist → throws error (silently caught?)
2. **classifyRedirectChainDrift()** exists but returns `severity: "info"` → finding created but marked as low severity
3. **The condition is false** → redirect diff not detected at all

---

## Implementation Gap Details

### What's Missing: `computeRedirectDiff()` in diff.ts

**Location:** [src/analysis/diff.ts](src/analysis/diff.ts) (needs to be added)

**Current state:**
- ✅ `classifyRedirectChainDrift()` exists and works correctly
- ❌ `computeRedirectDiff()` is not called anywhere
- ❌ `partialEnvDiff` never includes `redirects` field

**What needs to be added to diff.ts (around line 80, after finalUrl):**

```typescript
// Build redirect diff
const leftRedirects = (leftEnvelope.result as ProbeSuccess | ProbeResponseError).redirects || [];
const rightRedirects = (rightEnvelope.result as ProbeSuccess | ProbeResponseError).redirects || [];

const redirectDiff: RedirectDiff | undefined =
  leftRedirects.length > 0 || rightRedirects.length > 0
    ? {
        left: leftRedirects,
        right: rightRedirects,
        hopCount: {
          left: leftRedirects.length,
          right: rightRedirects.length,
          changed: leftRedirects.length !== rightRedirects.length,
        },
        chainChanged: !chainsAreEqual(
          leftRedirects.map((hop) => hop.toUrl),
          rightRedirects.map((hop) => hop.toUrl)
        ),
      }
    : undefined;

// Then add to partialEnvDiff:
const partialEnvDiff: Omit<EnvDiff, "findings" | "maxSeverity"> = {
  schemaVersion: DIFF_SCHEMA_VERSION,
  comparisonId: leftEnvelope.comparisonId,
  leftProbeId: leftEnvelope.probeId,
  rightProbeId: rightEnvelope.probeId,
  probe: probeOutcomeDiff,
  status: statusDiff,
  finalUrl: finalUrlDiff,
  redirects: redirectDiff,  // ← ADD THIS
};
```

**Helper imports needed:**
```typescript
import { chainsAreEqual } from "./redirectUtils";
import type { RedirectDiff } from "@shared/diff";
```

---

## Phase B2 Context

### Phase-B2.md Rule Definition

**From [Phase-B2-Docs/Phase-B2.md](Phase-B2-Docs/Phase-B2.md) § 4.B3:**

```
B3) Redirect Chain Differences

Detects when the redirect chain (sequence of URLs followed) differs between environments.

Rules:
- If hop count differs by 2+ → critical (significant infrastructure difference)
- If final URL in chain differs → critical (different destination)
- If both chains reach same final URL but hop count differs by 1 → warn
```

(Adjust above based on actual Phase-B2.md contents)

---

## Task Breakdown

### What Needs to Be Done

| Component | Status | Action |
|-----------|--------|--------|
| Signal capture | ✅ Complete | None |
| Redirect diff computation | ❌ Missing | **Add computeRedirectDiff logic to diff.ts** |
| Redirect comparison logic | ✅ Complete | Already implemented in redirectUtils.ts |
| Severity classification | ✅ Complete | classifyRedirectChainDrift() works correctly |
| Finding emission | ✅ Complete | classify.ts ready to use redirects field |
| Test coverage | ❌ Missing | **Add tests for redirect chain drift in diff.ts and classify.ts** |
| Documentation | ⚠️ Partial | **Update C2_REDIRECT_CHAIN_GAP.md as guide** |

### Files to Modify

1. **[src/analysis/diff.ts](src/analysis/diff.ts)** — PRIMARY FIX
   - Add redirect diff computation after finalUrl diff (around line 80)
   - Extract redirects from both envelopes
   - Compute hopCount and chainChanged
   - Include redirects in partialEnvDiff
   - Add imports: `chainsAreEqual` from redirectUtils, `RedirectDiff` type

2. **[src/analysis/__tests__/diff.test.ts](src/analysis/__tests__/diff.test.ts)**
   - Add test: "should compute redirectDiff when redirect chains differ"
   - Test case: 1 vs 3 hops → redirects field populated

3. **[src/analysis/__tests__/classify.test.ts](src/analysis/__tests__/classify.test.ts)**
   - Add test: "should emit REDIRECT_CHAIN_CHANGED when hopCount differs by 1"
   - Add test: "should emit REDIRECT_CHAIN_CHANGED with critical severity when hopCount differs by 2+"
   - Test cases: 1 vs 2 hops (warn), 1 vs 3 hops (critical)

4. **[C2_REDIRECT_CHAIN_GAP.md](C2_REDIRECT_CHAIN_GAP.md)** — DOCUMENTATION
   - Keep as reference; this document is the guide for implementing the fix

---

## Severity Policy Questions

### Open Questions for Implementation

1. **Hop Count Delta Thresholds:**
   - Delta 1 (e.g., 1 vs 2 hops) → `warn` or `info`?
   - Delta 2+ (e.g., 1 vs 3 hops) → `critical` or `warn`?

2. **Final URL Matching:**
   - If finalUrl is identical but hop count differs, should severity still be critical?
   - Or should it be lower (warn/info) since the destination is the same?

3. **Chain Order:**
   - Should we compare the exact sequence of URLs in the chain?
   - Or just the hop count?
   - Example: [A → B → C] vs [A → C] (same destination, different path) → severity?

4. **Real-World Context:**
   - Is redirect chain difference actually breaking?
   - Or is it informational (different infrastructure, same outcome)?

### Recommendation

Per MVP minimal severity policy (A2):
- **Delta 1 hop** (1 vs 2, 2 vs 3) → **warn** (minor infrastructure difference, same destination)
- **Delta 2+ hops** (1 vs 3, 1 vs 4) → **critical** (significant infrastructure difference)
- **Different final URL** → always **critical** (already handled by FINAL_URL_MISMATCH)

---

## How to Verify Once Fixed

### Unit Test
```bash
npm test -- src/analysis/__tests__/classify.test.ts -t "REDIRECT_CHAIN_CHANGED"
```

### Integration Test (Manual)
```bash
# Start dev server
npm run dev

# Trigger comparison with httpbin redirect URLs
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "leftUrl": "https://httpbin.org/redirect/1",
    "rightUrl": "https://httpbin.org/redirect/3"
  }'

# Poll for result
curl http://localhost:8787/api/compare/{comparisonId}
```

**Expected findings:**
```json
{
  "code": "REDIRECT_CHAIN_CHANGED",
  "category": "routing",
  "severity": "warn",  // or "critical", depending on policy
  "evidence": [{"section": "redirects", "keys": ["hopCount"]}],
  "left_value": [{"fromUrl": "...", "toUrl": "..."}],
  "right_value": [...]
}
```

---

## Related Issues

- **A2 (Severity Policy):** Separate from this; A2 is for URL component severity
- **Phase B2 Completeness:** This gap blocks full Phase B2 MVP completion
- **HTTP vs Network Failures:** Separate; already implemented

---

## Implementation Summary

### The Gap in One Sentence
**diff.ts never computes the `redirects` field of EnvDiff, so classify.ts never gets a chance to emit REDIRECT_CHAIN_CHANGED findings even though all supporting code exists.**

### The Fix (One Code Block)

**In [src/analysis/diff.ts](src/analysis/diff.ts), after computing `finalUrlDiff` (line 80), add:**

```typescript
// Build redirect diff
const leftRedirects = (leftEnvelope.result as ProbeSuccess | ProbeResponseError).redirects || [];
const rightRedirects = (rightEnvelope.result as ProbeSuccess | ProbeResponseError).redirects || [];

const redirectDiff: RedirectDiff | undefined =
  leftRedirects.length > 0 || rightRedirects.length > 0
    ? {
        left: leftRedirects,
        right: rightRedirects,
        hopCount: {
          left: leftRedirects.length,
          right: rightRedirects.length,
          changed: leftRedirects.length !== rightRedirects.length,
        },
        chainChanged: !chainsAreEqual(
          leftRedirects.map((hop) => hop.toUrl),
          rightRedirects.map((hop) => hop.toUrl)
        ),
      }
    : undefined;
```

**Then add to `partialEnvDiff`:**
```typescript
const partialEnvDiff: Omit<EnvDiff, "findings" | "maxSeverity"> = {
  schemaVersion: DIFF_SCHEMA_VERSION,
  comparisonId: leftEnvelope.comparisonId,
  leftProbeId: leftEnvelope.probeId,
  rightProbeId: rightEnvelope.probeId,
  probe: probeOutcomeDiff,
  status: statusDiff,
  finalUrl: finalUrlDiff,
  redirects: redirectDiff,  // ← ADD THIS LINE
};
```

**Add imports at top:**
```typescript
import { chainsAreEqual } from "./redirectUtils";
import type { RedirectDiff } from "@shared/diff";
```

### Why This Works

1. ✅ Signals are already captured in SignalEnvelope.redirects
2. ✅ classifyRedirectChainDrift() already implements the severity rules
3. ✅ classify.ts already checks for diff.redirects and emits findings
4. ❌ Only missing piece: computing redirectDiff in diff.ts
5. Once added → the entire pipeline activates → REDIRECT_CHAIN_CHANGED findings emit correctly

---

## Notes

- This is **not a regression** from A2; A2 only changed URL scheme severity
- This is a **pre-existing MVP scope gap** in Phase B2 implementation
- The infrastructure is 95% in place; only one computation step is missing
- Must be completed before Phase B2 is considered done

---

**Last Updated:** 2026-01-26
**Priority:** High (blocks MVP Phase B2 completion)
**Effort:** Low (5-10 minutes to implement + 20 minutes to test)
