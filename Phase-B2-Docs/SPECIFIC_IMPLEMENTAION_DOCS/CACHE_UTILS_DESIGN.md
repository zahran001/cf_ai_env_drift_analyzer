# cacheUtils.ts Design & Requirements Analysis

**Status:** Design Phase
**Chunk:** 3.3 (Phase B2 Implementation)
**Dependencies:** Chunk 0 (constants.ts) ✅
**Blockers for:** Chunk 5 (classify.ts)

---

## 1. Context & Purpose

`cacheUtils.ts` implements **Rule D1 (Cache-Control Drift)** from Phase-B2.md §4.D1.

**Rule D1 specification:**
```
Cache-Control Drift → CACHE_HEADER_DRIFT
- critical if 'no-store' or 'private' appears on only one side
```

This module analyzes cache control directives to detect when critical caching constraints are added or removed between two HTTP responses.

---

## 2. Specification Analysis

### 2.1 Input Requirements

**Source:** HTTP `cache-control` header value (string)

**Format:** RFC 7234 cache-control header
```
cache-control: directive1, directive2, directive3=value, ...
```

**Examples:**
- `"public, max-age=3600"` — public cache, 1-hour TTL
- `"private, no-store"` — private only, never cache
- `"no-cache, must-revalidate"` — revalidation required
- `"public, max-age=3600, s-maxage=7200"` — public with different maxes
- `undefined` / `""` — missing header

**Critical Keywords (per constants.ts):**
```typescript
CACHE_CRITICAL_KEYWORDS = ["no-store", "private"]
```

### 2.2 Processing Logic

**Phase-B2.md § Rule D1 requirement:**
```
Critical if 'no-store' or 'private' appears on only one side
```

**Interpretation:**
- If left has `no-store` or `private` but right doesn't → **drift detected** → critical
- If right has `no-store` or `private` but left doesn't → **drift detected** → critical
- If both have same critical status → **no drift**
- If both lack critical keywords → **no drift** (even if other directives differ)

### 2.3 Edge Cases

| Scenario | Left | Right | Expected | Reason |
|----------|------|-------|----------|--------|
| Missing on both | `undefined` | `undefined` | No drift | No critical keyword on either |
| Missing on left | `undefined` | `"private"` | Drift | Right has critical keyword |
| Missing on right | `"no-store"` | `undefined` | Drift | Left has critical keyword |
| Both have critical | `"no-store"` | `"private"` | No drift | Both have critical keyword |
| Neither has critical | `"public"` | `"max-age=3600"` | No drift | Neither has critical keyword |
| Same value | `"no-store"` | `"no-store"` | No drift | Identical |
| Different non-critical | `"public"` | `"private"` | **Drift** | private appears only on right |

### 2.4 Return Type Decision: `Severity` (FINAL)

**Question:** Should `classifyCacheControlDrift()` return `Severity` or `boolean`?

**Decision: Use `Severity`** ✅

**Rationale:**

1. **Pattern Consistency** — All other classification functions return `Severity`:
   - `classifyStatusDrift(left, right): Severity` (Rule B1)
   - `classifyContentTypeDrift(left, right): Severity` (Rule D3)
   - `classifyContentLengthDrift(left, right, statusChanged): Severity` (Rule D5)
   - `classifyCacheControlDrift(left, right): Severity` (Rule D1) ← **This module**

2. **Downstream Integration** — In `classify.ts` Rule D1 handler:
   ```typescript
   // With Severity return: Direct, clean, consistent
   const severity = classifyCacheControlDrift(left, right);
   if (severity !== "info") {
     findings.push({
       code: "CACHE_HEADER_DRIFT",
       severity,  // ← Directly use returned value
       // ...
     });
   }

   // With boolean return: Requires conversion logic
   const hasDrift = classifyCacheControlDrift(left, right);
   if (hasDrift) {
     findings.push({
       code: "CACHE_HEADER_DRIFT",
       severity: "critical",  // ← Hardcoded! Breaks if spec changes
       // ...
     });
   }
   ```

3. **Extensibility** — If Rule D1 logic changes (e.g., to return `"warn"` for certain cases), only this function needs updating. Downstream code automatically benefits.

4. **Semantic Clarity** — Return value self-documents:
   - `"info"` = no drift
   - `"critical"` = drift detected

   vs boolean:
   - `true` = drift? (requires reading implementation to understand)
   - `false` = no drift?

**Note:** IMPLEMENTATION_CHUNKS.md (line 707) shows `boolean` as a scaffold/guideline, not the authoritative source. Phase-B2.md §4.D1 specifies the output severity requirement, and this design aligns with established patterns across all other rules.

---

## 3. Module Structure

### 3.1 Function 1: `parseCacheControl()`

**Purpose:** Parse cache-control header into normalized directives

**Signature:**
```typescript
export function parseCacheControl(cacheControl?: string): Set<string>
```

**Logic:**
1. If undefined or empty → return empty Set
2. Split by comma (directive separator in HTTP header)
3. For each directive:
   - Trim whitespace
   - Split on `=` and take first part (directive name only, ignore values)
   - Convert to lowercase
4. Return Set of directive names

**Example:**
```typescript
parseCacheControl("public, max-age=3600, no-store")
// Returns: Set { "public", "max-age", "no-store" }

parseCacheControl("  no-cache  ,  must-revalidate=true  ")
// Returns: Set { "no-cache", "must-revalidate" }

parseCacheControl(undefined)
// Returns: Set { }
```

**Tests needed:**
- Simple case: single directive
- Multiple directives separated by comma
- Directives with values (key=value)
- Whitespace handling (before, after, around comma)
- Case-insensitive handling (TEXT, NoStore, etc.)
- Undefined/empty string input
- Edge case: empty directive (consecutive commas)

### 3.2 Function 2: `hasCriticalCacheKeyword()`

**Purpose:** Check if a set of directives contains critical keywords

**Signature:**
```typescript
export function hasCriticalCacheKeyword(directives: Set<string>): boolean
```

**Logic:**
1. Check if any directive in set matches CACHE_CRITICAL_KEYWORDS
2. Use `some()` for early exit

**Constants referenced:**
```typescript
CACHE_CRITICAL_KEYWORDS = ["no-store", "private"]
```

**Example:**
```typescript
hasCriticalCacheKeyword(new Set(["public", "max-age", "no-store"]))
// Returns: true (contains "no-store")

hasCriticalCacheKeyword(new Set(["public", "max-age=3600"]))
// Returns: false (no critical keywords)

hasCriticalCacheKeyword(new Set(["private"]))
// Returns: true (contains "private")

hasCriticalCacheKeyword(new Set([]))
// Returns: false (empty set)
```

**Tests needed:**
- Set with critical keyword present
- Set with multiple critical keywords
- Set with no critical keywords
- Empty set
- Set with mixed keywords

### 3.3 Function 3: `classifyCacheControlDrift()`

**Purpose:** Classify severity of cache-control drift between two responses

**Signature:**
```typescript
export function classifyCacheControlDrift(
  left?: string,
  right?: string
): Severity
```

**Logic:**
1. If both are identical (same string) → return `"info"` (no drift)
2. Parse both into directive sets
3. Check if critical keyword presence differs:
   - `leftHasCritical = hasCriticalCacheKeyword(leftDirs)`
   - `rightHasCritical = hasCriticalCacheKeyword(rightDirs)`
4. If presence differs → return `"critical"` (Rule D1 triggered)
5. Otherwise → return `"info"` (no drift)

**Examples:**
```typescript
classifyCacheControlDrift("public", "private")
// Returns: "critical" (left has no critical, right has "private")

classifyCacheControlDrift("no-store", "no-store")
// Returns: "info" (identical)

classifyCacheControlDrift("public, max-age=3600", "private, max-age=7200")
// Returns: "critical" (left: no critical, right: has "private")

classifyCacheControlDrift("public", "public, max-age=3600")
// Returns: "info" (neither has critical keyword)

classifyCacheControlDrift(undefined, "private")
// Returns: "critical" (left: no critical, right: has "private")

classifyCacheControlDrift(undefined, undefined)
// Returns: "info" (both missing)
```

**Tests needed:**
- Both identical (string)
- Both missing (undefined)
- Only left missing
- Only right missing
- Left has critical, right doesn't
- Right has critical, left doesn't
- Both have critical keywords (even if different)
- Neither has critical (even if other directives differ)
- Multiple critical keywords on same side

---

## 4. Implementation Details

### 4.1 Edge Cases & Decisions

**Directive Parsing - Whitespace:**
```typescript
"  no-cache  ,  must-revalidate  "
// Split by comma: ["  no-cache  ", "  must-revalidate  "]
// Trim each: ["no-cache", "must-revalidate"]
// Result: Set { "no-cache", "must-revalidate" }
```

**Directive Values (key=value):**
```typescript
"max-age=3600, no-store"
// Split by comma: ["max-age=3600", "no-store"]
// For "max-age=3600": split on "=", take [0] → "max-age"
// For "no-store": split on "=" returns ["no-store"], take [0] → "no-store"
// Result: Set { "max-age", "no-store" }
```

**Case Sensitivity:**
```typescript
"NO-STORE, Private"
// After lowercase: "no-store", "private"
// Matches CACHE_CRITICAL_KEYWORDS exactly ✅
```

**Empty Directives (edge case):**
```typescript
"public,,private"
// Split by comma: ["public", "", "private"]
// After trim: ["public", "", "private"]
// Empty string after split on "=" → ""
// Filter out empties: ["public", "private"]
// OR include empty: Set { "public", "", "private" }
// Decision: Filter out empties (more defensive)
```

### 4.2 Type Signature Comparison

**Current spec (IMPLEMENTATION_CHUNKS.md:707):**
```typescript
classifyCacheControlDrift(left?: string, right?: string): boolean
```

**Proposed (aligned with contentUtils pattern):**
```typescript
classifyCacheControlDrift(left?: string, right?: string): Severity
```

**Rationale:**
- `contentUtils` functions return `Severity`
- `classifiers` functions return `Severity`
- Makes orchestration in `classify.ts` consistent
- Upstream conversion boolean → Severity is simple
- `classify.ts` expects `Severity` return type

---

## 5. Documentation Style

### Pattern (from contentUtils.ts)

```typescript
/**
 * [One-liner describing what this does]
 *
 * [Detailed explanation of logic, steps, or decision]
 *
 * [Per Phase-B2.md or reference]
 *
 * @param [paramName] - [Description]
 * @returns [Return type and description]
 */
export function functionName(...): ReturnType {
  // Implementation
}
```

### Example for cacheUtils

```typescript
/**
 * Parse cache-control header into normalized directives.
 *
 * Process:
 * 1. If undefined or empty string, return empty Set
 * 2. Split on comma (directive separator)
 * 3. For each directive: trim, split on "=", take first part (directive name)
 * 4. Convert all to lowercase
 * 5. Return Set of normalized directive names
 *
 * Example:
 * - "public, max-age=3600" → Set { "public", "max-age" }
 * - "NO-STORE, Private" → Set { "no-store", "private" }
 * - undefined → Set { }
 *
 * @param cacheControl - Raw cache-control header value
 * @returns Set of normalized directive names (or empty Set if missing)
 */
export function parseCacheControl(cacheControl?: string): Set<string> {
  // Implementation
}
```

---

## 6. Test Strategy

### 6.1 Test Structure

**File:** `src/analysis/__tests__/cacheUtils.test.ts`

**Organization:**
```typescript
describe("cacheUtils", () => {
  describe("parseCacheControl", () => {
    // 8-10 test cases
  });

  describe("hasCriticalCacheKeyword", () => {
    // 5-6 test cases
  });

  describe("classifyCacheControlDrift", () => {
    // 10-12 test cases
  });

  describe("Integration: realistic cache scenarios", () => {
    // 4-5 integration test cases
  });
});
```

### 6.2 Test Cases by Function

**parseCacheControl:**
1. ✅ Parse single directive
2. ✅ Parse multiple directives (comma-separated)
3. ✅ Parse directive with value (key=value)
4. ✅ Parse multiple directives with mixed values
5. ✅ Trim whitespace around directives
6. ✅ Convert to lowercase
7. ✅ Handle undefined input
8. ✅ Handle empty string input
9. ✅ Handle whitespace-only input

**hasCriticalCacheKeyword:**
1. ✅ Detect "no-store" present
2. ✅ Detect "private" present
3. ✅ Detect both present
4. ✅ No critical keywords (empty set)
5. ✅ No critical keywords (non-critical directives only)
6. ✅ Mixed critical and non-critical

**classifyCacheControlDrift:**
1. ✅ Identical values → "info"
2. ✅ Both undefined → "info"
3. ✅ Both have same critical keyword → "info"
4. ✅ Left has no-store, right doesn't → "critical"
5. ✅ Right has private, left doesn't → "critical"
6. ✅ Left has private, right doesn't → "critical"
7. ✅ Only left missing (undefined), right has critical → "critical"
8. ✅ Only right missing (undefined), left has critical → "critical"
9. ✅ Neither has critical (different directives) → "info"
10. ✅ Left: empty, right: "public, max-age" → "info"
11. ✅ Both missing → "info"
12. ✅ Both have different critical keywords → "info"

**Integration:**
1. ✅ Real scenario: cdn cache → no-store (security change)
2. ✅ Real scenario: max-age changes (non-critical)
3. ✅ Real scenario: private added (access restriction)
4. ✅ Real scenario: cache-control removed entirely

### 6.3 Coverage Goals

- **Line coverage:** 100%
- **Branch coverage:** 100%
- **Function coverage:** 100%
- **Edge cases:** All documented cases covered

---

## 7. Acceptance Criteria

### ✅ Functional

- [ ] `parseCacheControl()` correctly parses all RFC 7234 variants
  - Splits on comma, extracts directive names (ignores values), lowercases, returns Set
- [ ] `hasCriticalCacheKeyword()` detects both "no-store" and "private"
  - Uses CACHE_CRITICAL_KEYWORDS constant from constants.ts
- [ ] `classifyCacheControlDrift()` returns `Severity` type (not boolean)
  - Returns `"critical"` when critical keyword presence differs between left and right
  - Returns `"info"` when both sides have same critical keyword status (both have or both lack)
  - Returns `"info"` when neither side has critical keywords (even if other directives differ)
- [ ] All functions handle undefined/empty inputs gracefully
  - `undefined` → equivalent to empty set (no critical keywords)
  - Empty string → equivalent to undefined
  - Whitespace-only → filtered out, equivalent to empty
- [ ] All functions are deterministic (same input → same output every time)
  - No timestamps, randomness, or external state
  - Set iteration order doesn't matter (membership testing only)

### ✅ Code Quality

- [ ] JSDoc documentation complete for all functions
- [ ] No `any` types (use `string | undefined` explicitly)
- [ ] All imports from `constants.ts` ✅
- [ ] Imports match pattern: `import type { Severity } from "@shared/diff"`
- [ ] No TypeScript errors or warnings

### ✅ Testing

- [ ] All 25-30 test cases pass
- [ ] Edge cases covered (undefined, empty, whitespace)
- [ ] Integration tests demonstrate Rule D1 compliance
- [ ] No skipped or pending tests

### ✅ Spec Compliance

- [ ] Implements Rule D1 exactly: "critical if no-store or private appears on only one side"
- [ ] Follows Phase-B2.md §4.D1 specification
- [ ] Uses constants from `constants.ts` (CACHE_CRITICAL_KEYWORDS)
- [ ] Return type matches downstream expectations (Severity)

---

## 8. Estimated Implementation Effort

| Task | Estimate |
|------|----------|
| Implement `parseCacheControl()` | 10 min |
| Implement `hasCriticalCacheKeyword()` | 5 min |
| Implement `classifyCacheControlDrift()` | 10 min |
| Write 25-30 tests | 20 min |
| Review & polish | 5 min |
| **Total** | **50 minutes** |

---

## 9. Dependencies & Downstream

### Upstream Dependencies ✅
- `constants.ts` (CACHE_CRITICAL_KEYWORDS) ✅ Available

### Downstream Dependents
- `classify.ts` (Chunk 5) — Will call `classifyCacheControlDrift()` in Rule D1 handler
- Cannot start Chunk 5 until this module is complete

---

## 10. Key Design Decisions Summary

| Decision | Rationale | Implication |
|----------|-----------|-------------|
| **Return `Severity` (not `boolean`)** | ✅ Matches ALL other classification functions (Rules B1, D3, D5). Phase-B2.md specifies output severity; IMPLEMENTATION_CHUNKS.md is scaffold only. | Direct integration with `classify.ts` Rule D1 handler; no conversion logic needed; extensible if spec changes |
| Parse to `Set<string>` | Fast lookup O(1), deduplicates directives, fits RFC 7234 | More efficient than array; idiomatic for membership testing |
| Case-insensitive comparison | HTTP header directive names are case-insensitive (RFC 7234) | Correct per RFC spec; handles "NO-STORE", "no-store", "No-Store" identically |
| Filter empty directives | Defensive against malformed input (e.g., "public,,private") | More robust parsing; prevents false positives on empty strings |
| "critical" only when presence differs | Spec: "if 'no-store' or 'private' appears on only one side" (Phase-B2.md §4.D1) | Precise Rule D1 implementation; both sides constrained = no drift |

---

**Design Document Version:** 1.1 (Updated: Decision on Severity return type finalized)
**Phase:** B2 (Cache Utils, Chunk 3.3)
**Status:** ✅ Ready for Implementation
**Key Decision:** Return type is `Severity` (final, aligns with Rules B1/D3/D5)