# D1 Cache-Control Severity — Critique & Adjustment

**Issue:** Current severity classification for cache-control drift is **too aggressive** per MVP test plan.

**Current Behavior:**
- Left: `cache-control: no-store`
- Right: `cache-control: public,max-age=3600`
- Severity: **critical** ❌

**Expected (per test plan):**
- Severity: **warn** (lower than routing/status drift)
- Rationale: Cache policy changes are observable operational drift, not request outcome changes

---

## Analysis

### Current Logic (cacheUtils.ts:105-129)

```typescript
export function classifyCacheControlDrift(left?: string, right?: string): Severity {
  const leftDirectives = parseCacheControl(left);
  const rightDirectives = parseCacheControl(right);

  const leftHasCritical = hasCriticalCacheKeyword(leftDirectives);
  const rightHasCritical = hasCriticalCacheKeyword(rightDirectives);

  // If critical keyword presence differs, it's a critical drift
  if (leftHasCritical !== rightHasCritical) {
    return "critical";  // ❌ TOO AGGRESSIVE
  }

  // If directive sets differ (but no critical keywords), it's a warning drift
  if (!directivesSetsEqual(leftDirectives, rightDirectives)) {
    return "warn";
  }

  return "info";
}
```

**Problem:** The presence of `"no-store"` on one side but not the other triggers **critical** severity.

**Your Critique:** Cache-control changes should be **warn level** (observable drift, not outcome-breaking).

### Test Case Breakdown

**Left:** `"no-store"` → directives = `{"no-store"}`
- Has critical keyword: YES

**Right:** `"public,max-age=3600"` → directives = `{"public", "max-age"}`
- Has critical keyword: NO

**Current verdict:** `leftHasCritical !== rightHasCritical` → **critical**

**Your verdict:** Cache policy drift, not outcome change → **warn**

### Philosophical Difference

| Aspect | Current Logic | Your Proposal |
|--------|---------------|---------------|
| **Definition of "critical"** | Any critical keyword presence mismatch | Findings that break request outcome |
| **Cache-control scope** | Security-adjacent (access control) | Operational policy (caching behavior) |
| **Example: no-store vs public** | Critical (security breach risk) | Warn (policy change, request still succeeds) |
| **Priority vs routing drift** | Same level | Lower priority |

### Arguments FOR Current Implementation

1. **Security-conscious:** `no-store` forbids caching; ignoring it could expose sensitive data
2. **RFC 7234 alignment:** Cache-control has strict semantics; deviation is significant
3. **Compliance risk:** Public cache vs private cache matters in regulated environments

### Arguments FOR Your Proposal

1. **MVP outcome-focused:** Request outcome unchanged (status=200, content identical)
2. **Observability over severity:** It's a detectable drift, but not breaking
3. **Reduces false-positive noise:** Query parameter test-input noise shouldn't elevate severity
4. **Consistent with B3 philosophy:** Hop count changes = warn, final host changes = critical; cache policy changes = warn

---

## Your Specific Concerns

### 1. Cache-Control Severity Should Be Lower

**Current:** critical
**Proposed:** warn

**Justification:** Cache-control drift is policy-level observability, not outcome-level criticality. The request still succeeds (200), headers are returned, response body is received. Only the *caching instructions* differ.

### 2. FINAL_URL_MISMATCH:finalUrl:query Is Test-Input Noise

**Current:**
```json
{
  "code": "FINAL_URL_MISMATCH",
  "severity": "warn",
  "section": "finalUrl",
  "keys": ["query"],
  "left_value": "https://httpbin.org/response-headers?cache-control=no-store",
  "right_value": "https://httpbin.org/response-headers?cache-control=public,max-age=3600"
}
```

**Your observation:** The query parameter difference exists *because* you intentionally set different cache-control values to trigger D1 detection. It's not a natural divergence; it's test-input setup.

**Options:**
1. **Accept:** Keep the finding but understand it's test artifact
2. **Filter:** Add logic to suppress query-only URL diffs when headers compensate
3. **Ignore:** Suppress FINAL_URL_MISMATCH when cache-control is the only change

---

## Recommended Adjustment

### Option 1: Reduce Cache-Control Severity (Simplest)

**Change:** Make cache-control drift always **warn** level, never critical

```typescript
export function classifyCacheControlDrift(
  left?: string,
  right?: string
): Severity {
  const leftDirectives = parseCacheControl(left);
  const rightDirectives = parseCacheControl(right);

  // Any difference in directives = warn (operational policy change)
  if (!directivesSetsEqual(leftDirectives, rightDirectives)) {
    return "warn";  // ✅ Always warn, never critical
  }

  return "info";
}
```

**Effect:**
- `cache-control: no-store` vs `public,max-age=3600` → **warn** ✅
- `cache-control: max-age=3600` vs `max-age=7200` → **warn** ✅
- `cache-control: no-store` vs `no-store` → **info** ✅

**Trade-off:** Loses ability to distinguish "security-critical" drift (no-store lost) from "policy-operational" drift (max-age changed). Both treated as warn.

### Option 2: Nuanced Severity (More Sophisticated)

```typescript
export function classifyCacheControlDrift(
  left?: string,
  right?: string
): Severity {
  const leftDirectives = parseCacheControl(left);
  const rightDirectives = parseCacheControl(right);

  const leftHasCritical = hasCriticalCacheKeyword(leftDirectives);
  const rightHasCritical = hasCriticalCacheKeyword(rightDirectives);

  // LOSS of critical keyword (left had, right doesn't) = critical security concern
  if (leftHasCritical && !rightHasCritical) {
    return "critical";  // Left's no-store is gone → potential exposure
  }

  // GAIN of critical keyword (right has, left doesn't) = warn (became more restrictive)
  if (!leftHasCritical && rightHasCritical) {
    return "warn";  // Right now private/no-store, but wasn't before
  }

  // Any other directive difference = warn (operational policy change)
  if (!directivesSetsEqual(leftDirectives, rightDirectives)) {
    return "warn";
  }

  return "info";
}
```

**Effect:**
- `cache-control: no-store` vs `public,max-age=3600` → **critical** (LOSS of no-store)
- `cache-control: public` vs `no-store` → **warn** (GAIN of no-store, more restrictive)
- `cache-control: max-age=3600` vs `max-age=7200` → **warn** ✅

**Trade-off:** Still distinguishes security concerns (loss of critical keywords) but treats gains as operational.

### Option 3: Accept Current, Change Test Expectations

Keep the logic as-is but acknowledge:
- Cache-control drift IS critical when critical keywords change
- Your D1 test case *is* security-relevant (no-store → public is a control relaxation)
- FINAL_URL_MISMATCH is incidental noise from test setup

---

## Recommendation

**I suggest Option 1: Always warn for cache-control drift**

**Rationale:**
1. **Aligns with your MVP philosophy:** "critical only for outcome changes" (status, host mismatch)
2. **Reduces noise:** FINAL_URL_MISMATCH still emits, but cache-control is warn (not both critical)
3. **Matches B3 precedent:** Hop count changes = warn; cache-control changes = warn
4. **Preserves LLM context:** Findings array contains cache drift reason; explanation can still dig into security implications

**What needs to change:**
1. **cacheUtils.ts line 118-120:** Remove critical keyword check
2. **cacheUtils.test.ts:** Update test expectations for severity levels
3. **classify.test.ts:** Update D1 integration test (expect warn, not critical)

---

## Implementation Steps (if approved)

1. Update `classifyCacheControlDrift()` to always return warn (never critical)
2. Run tests: `npm test -- src/analysis/__tests__/cacheUtils.test.ts`
3. Update classify test: D1 test case expects warn severity
4. Verify final_url and cache-control findings coexist in findings array
5. Document rationale in Phase-D1 spec

---

## Edge Case: FINAL_URL_MISMATCH Noise

If you want to suppress query-only diffs when cache-control is the actual cause:

**New rule in classify.ts (optional):**
```typescript
// If ONLY query differs AND cache-control differs significantly,
// downgrade finalUrl finding to info
if (queryOnlyDiff && cacheHeaderDriftFound) {
  finalUrlFinding.severity = "info";
}
```

**Decision:** Is this worth adding, or accept FINAL_URL_MISMATCH:warn as context?

---

**Your call:** Which approach aligns with your D1 test expectations?