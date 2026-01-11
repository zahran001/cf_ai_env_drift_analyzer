# Chunk 4 Design: Validators Module

**Phase:** B2 (Deterministic Finding Rules)
**Module:** `src/analysis/validators.ts`
**Estimated Effort:** 60 minutes (30 min code + 30 min tests)
**Status:** Design Phase (Ready for Implementation)

---

## 1. Overview

### Purpose

Validate that evidence structures conform to Phase-B2.md §1 (Global Determinism Rules):
- §1.1: Key normalization and sorting
- §1.3: Evidence key vocabulary compliance
- All `evidence.keys` must be lexicographically sorted
- All evidence sections and keys must match predefined vocabulary

### Dependencies (All Available ✅)

| Dependency | Status | Location |
|---|---|---|
| Type: DiffEvidence | ✅ Available | `shared/diff.ts:125–139` |
| Constant: VALID_EVIDENCE_KEYS | ✅ Available | `src/analysis/constants.ts:39–50` |
| Type: Severity, FindingCategory | ✅ Available | `shared/diff.ts:13–22` |

### No Blockers

- No circular dependencies (validators imports only constants + types)
- Constants already exported from Chunk 0
- All utilities from Chunks 1–3 are independent
- Chunk 4 does not depend on any implementation, only types and constants

---

## 2. Evidence Key Vocabulary (From Phase-B2.md §1.3)

This validator must enforce the following canonical vocabulary:

### 2.1 Section: "probe"

**Valid Keys:**
- `undefined`
- `["left"]`
- `["right"]`

**Purpose:** Identify which probe failed or has relevant outcome

**Examples:**
- `{ section: "probe" }` — Both probes failed (§1.1 implied)
- `{ section: "probe", keys: ["left"] }` — Left probe failed
- `{ section: "probe", keys: ["right"] }` — Right probe failed

---

### 2.2 Section: "status"

**Valid Keys:**
- `undefined` (required)

**Purpose:** HTTP status code difference (always implicit, no side specification needed)

**Examples:**
- `{ section: "status" }` — Status mismatch detected

---

### 2.3 Section: "finalUrl"

**Valid Keys:**
- `undefined`
- `["scheme"]`
- `["host"]`
- `["path"]`
- `["query"]`
- `["finalUrl"]`
- **Combinations (must be sorted):** `["host", "path"]`, `["host", "query"]`, `["path", "query"]`, etc.

**Purpose:** Identify which URL component(s) differ

**Examples:**
- `{ section: "finalUrl", keys: ["scheme"] }` — Scheme differ (http vs https)
- `{ section: "finalUrl", keys: ["host", "path"] }` — Both host and path differ (sorted)
- `{ section: "finalUrl" }` — Entire final URL changed

---

### 2.4 Section: "redirects"

**Valid Keys:**
- `undefined`
- `["hopCount"]`
- `["chain"]`
- `["finalHost"]`
- **Combinations (sorted):** `["chain", "hopCount"]`, `["chain", "finalHost"]`, `["finalHost", "hopCount"]`

**Purpose:** Identify which redirect metric changed

**Examples:**
- `{ section: "redirects", keys: ["hopCount"] }` — Number of redirects differ
- `{ section: "redirects", keys: ["chain"] }` — Redirect path/sequence differs
- `{ section: "redirects", keys: ["chain", "hopCount"] }` — Both differ (sorted)

---

### 2.5 Section: "headers"

**Valid Keys:**
- **Any lowercase header name** (e.g., `"cache-control"`, `"content-type"`, `"x-custom-header"`)
- No predefined list; determined by actual diff
- **Must be lowercase**
- **Multiple headers must be sorted** (e.g., `["cache-control", "vary"]`, NOT `["vary", "cache-control"]`)

**Purpose:** Identify which headers differ

**Examples:**
- `{ section: "headers", keys: ["cache-control"] }` — Cache-Control header differ
- `{ section: "headers", keys: ["cache-control", "vary"] }` — Both cache-control and vary differ (sorted)
- `{ section: "headers" }` — Generic header diff (no specific header called out)

**Note:** Unlike other sections, headers do NOT have a predefined vocabulary. Any lowercase header name is valid.

---

### 2.6 Section: "content"

**Valid Keys:**
- `undefined`
- `["body-hash"]`
- `["content-length"]`
- `["content-type"]`
- **Combinations (sorted):** `["body-hash", "content-length"]`, `["body-hash", "content-type"]`, `["content-length", "content-type"]`, all three

**Purpose:** Identify which content field(s) differ

**Examples:**
- `{ section: "content", keys: ["content-type"] }` — Content-Type header value differs
- `{ section: "content", keys: ["body-hash"] }` — Response body content differs
- `{ section: "content", keys: ["body-hash", "content-length"] }` — Both differ (sorted)

---

### 2.7 Section: "timing"

**Valid Keys:**
- `undefined`
- `["duration_ms"]`

**Purpose:** Identify timing field that differs

**Examples:**
- `{ section: "timing", keys: ["duration_ms"] }` — Response duration differs

---

### 2.8 Section: "cf"

**Valid Keys:**
- `undefined`
- `["asn"]`
- `["colo"]`
- `["country"]`
- **Combinations (sorted):** `["asn", "colo"]`, `["asn", "country"]`, `["colo", "country"]`, all three

**Purpose:** Identify which Cloudflare context field(s) differ

**Examples:**
- `{ section: "cf", keys: ["colo"] }` — Colo (data center) differs
- `{ section: "cf", keys: ["asn", "country"] }` — Both ASN and country differ (sorted)

---

## 3. Module Implementation

### 3.1 Type Definition

```typescript
export type ValidEvidenceSection = keyof typeof VALID_EVIDENCE_KEYS;
```

This type extracts the section names (`"probe" | "status" | "finalUrl" | "redirects" | "headers" | "content" | "timing" | "cf"`) from the VALID_EVIDENCE_KEYS constant.

### 3.2 Main Function: `validateEvidenceKeys()`

```typescript
/**
 * Validate evidence array conforms to Phase-B2.md §1.1 & §1.3.
 *
 * Requirements:
 * 1. All `evidence.section` values must be valid section names
 * 2. All `evidence.keys` arrays must contain only valid keys for that section
 * 3. For headers section: any lowercase header name is valid
 * 4. All `evidence.keys` arrays must be lexicographically sorted
 * 5. No duplicate keys within a single evidence item
 *
 * @param evidence - Array of DiffEvidence items to validate
 * @returns true if all evidence is valid, false if any violation found
 */
export function validateEvidenceKeys(evidence: DiffEvidence[]): boolean
```

### 3.3 Validation Algorithm

For each `DiffEvidence` item in the array:

1. **Verify section is valid**
   - Check if `evidence.section` is one of the 8 known sections
   - Return `false` if invalid section name

2. **Verify keys array (if present)**
   - If `evidence.keys` is `undefined` or empty, it's valid (allowed for all sections)
   - If `evidence.keys` has items:

3. **Verify keys are valid for section**
   - For `"headers"` section: accept any lowercase header name
   - For other sections: check if each key is in `VALID_EVIDENCE_KEYS[section]`
   - Return `false` if any key not found

4. **Verify keys are sorted**
   - Check if `evidence.keys` is sorted lexicographically
   - Example: `["cache-control", "vary"]` ✅ | `["vary", "cache-control"]` ❌
   - Use array comparison: `JSON.stringify([...keys].sort()) === JSON.stringify(keys)`

5. **Verify no duplicates**
   - Check if all keys are unique within the array
   - Return `false` if duplicates found

6. **Verify keys are lowercase** (for headers section)
   - All header names must be lowercase
   - Example: `"Cache-Control"` ❌ | `"cache-control"` ✅

**Return:** `true` only if all validations pass, `false` otherwise

---

## 4. Helper Functions (Optional but Recommended)

### 4.1 `isSorted(keys: string[]): boolean`

```typescript
/**
 * Check if array is sorted lexicographically.
 */
function isSorted(keys: string[]): boolean {
  for (let i = 1; i < keys.length; i++) {
    if (keys[i] < keys[i - 1]) {
      return false;
    }
  }
  return true;
}
```

### 4.2 `isValidHeaderName(name: string): boolean`

```typescript
/**
 * Check if header name is valid (lowercase, no uppercase).
 */
function isValidHeaderName(name: string): boolean {
  return name === name.toLowerCase() && /^[a-z0-9\-]+$/.test(name);
}
```

---

## 5. Test Strategy

### Test Coverage: 30+ test cases

**Test Categories:**

#### 5.1 Valid Evidence (Pass Cases) — 12 tests

- `probe` with `["left"]` ✅
- `probe` with `["right"]` ✅
- `probe` with `undefined` ✅
- `status` with `undefined` ✅
- `finalUrl` with single keys (scheme, host, path, query, finalUrl) — 5 tests ✅
- `finalUrl` with multiple sorted keys (`["host", "path"]`) ✅
- `redirects` with all valid keys — 3 tests ✅
- `headers` with lowercase names (`["cache-control"]`) ✅
- `headers` with multiple sorted headers (`["cache-control", "vary"]`) ✅
- `content` with all valid keys — 3 tests ✅
- `timing` with `["duration_ms"]` ✅
- `cf` with all valid keys — 3 tests ✅

#### 5.2 Invalid Section Names (Fail Cases) — 2 tests

- Invalid section: `"unknown_section"` ❌
- Invalid section: `"headers_extra"` ❌

#### 5.3 Invalid Keys for Section (Fail Cases) — 5 tests

- `probe` with invalid key `["center"]` ❌
- `finalUrl` with invalid key `["fragment"]` ❌
- `redirects` with invalid key `["url"]` ❌
- `content` with invalid key `["mime-type"]` ❌
- `timing` with invalid key `["latency_ms"]` ❌
- `cf` with invalid key `["ip_address"]` ❌

#### 5.4 Sorting Violations (Fail Cases) — 4 tests

- `headers` with unsorted keys `["vary", "cache-control"]` ❌
- `finalUrl` with unsorted keys `["query", "path"]` ❌
- `redirects` with unsorted keys `["finalHost", "hopCount"]` ❌
- `content` with unsorted keys `["content-type", "body-hash"]` ❌

#### 5.5 Duplicate Keys (Fail Cases) — 1 test

- Duplicate key in array `["cache-control", "cache-control"]` ❌

#### 5.6 Case Sensitivity (Fail Cases) — 2 tests

- Header with uppercase `["Cache-Control"]` ❌
- Header with mixed case `["Content-Type"]` ❌

#### 5.7 Edge Cases — 3 tests

- Empty evidence array `[]` ✅
- Evidence with `undefined` keys (allowed) ✅
- Multiple evidence items with different sections ✅
- Evidence with special header names `["x-custom-header"]` ✅

#### 5.8 Integration Scenarios — 2 tests

- Realistic evidence from a status drift finding ✅
- Realistic evidence from a cache-control drift finding ✅

---

## 6. Implementation Checklist

### Code Phase

- [ ] Create `src/analysis/validators.ts` (40 lines code + 20 lines JSDoc)
- [ ] Import types: `DiffEvidence` from `shared/diff.ts`
- [ ] Import constants: `VALID_EVIDENCE_KEYS` from `./constants.ts`
- [ ] Implement `ValidEvidenceSection` type
- [ ] Implement `validateEvidenceKeys()` function
- [ ] Implement helper functions (`isSorted`, `isValidHeaderName`)
- [ ] Add JSDoc to all functions
- [ ] Verify no TypeScript errors

### Test Phase

- [ ] Create `src/analysis/__tests__/validators.test.ts` (200 lines)
- [ ] Organize tests into 8 describe blocks (one per section)
- [ ] Write 12 valid evidence tests (should pass)
- [ ] Write 15+ invalid evidence tests (should fail)
- [ ] Write edge case tests
- [ ] Run tests: `npm test -- validators.test.ts`
- [ ] Verify all tests pass
- [ ] Verify 100% line coverage
- [ ] Verify 100% branch coverage

### Quality Assurance

- [ ] No `any` types used
- [ ] All imports properly scoped
- [ ] Deterministic function (same input → same output)
- [ ] No side effects (no logging, no mutations)
- [ ] No external dependencies (only constants + types)
- [ ] Matches Phase-B2.md §1.1 & §1.3 exactly
- [ ] Test descriptions align with Phase-B2.md examples

---

## 7. Key Design Decisions

| Decision | Rationale | Implication |
|----------|-----------|-------------|
| **Return boolean (not exception)** | Validation as pure function, no side effects | Callers decide how to handle invalid evidence |
| **Sort check via direct comparison** | O(n) is sufficient, no need for Set | Simple, deterministic, testable |
| **Accept any lowercase header name** | Headers determined by actual diff, not predefined | More flexible for future headers |
| **Require sorted keys** | Phase-B2.md §1.1 mandate | Prevents ordering ambiguity |
| **Validate lexicographically** | String comparison is standard, deterministic | No custom ordering logic needed |

---

## 8. Acceptance Criteria

### ✅ Functional

- [ ] `validateEvidenceKeys()` accepts valid evidence and returns `true`
- [ ] Returns `false` for invalid section name
- [ ] Returns `false` for keys not in vocabulary
- [ ] Returns `false` for unsorted keys
- [ ] Returns `false` for duplicate keys
- [ ] Headers section accepts any lowercase header name
- [ ] Headers section rejects UPPERCASE header names
- [ ] `undefined` keys allowed for all sections (where valid)
- [ ] Empty evidence array returns `true` (valid)

### ✅ Code Quality

- [ ] JSDoc complete for all functions
- [ ] No `any` types
- [ ] No console.log or debugging code
- [ ] No external dependencies (only constants.ts + shared/diff.ts)
- [ ] Matches Phase-B2.md vocabulary exactly
- [ ] Function is deterministic (same input → same output every time)

### ✅ Testing

- [ ] 30+ test cases (covering all 8 sections)
- [ ] Valid evidence scenarios pass
- [ ] Invalid evidence scenarios fail
- [ ] Edge cases handled
- [ ] 100% line coverage
- [ ] 100% branch coverage
- [ ] No skipped tests

### ✅ Determinism

- [ ] Function output never depends on timestamps, randomness, or state
- [ ] Same evidence array always produces same result
- [ ] No mutations of input arrays
- [ ] Sorting check is idempotent

---

## 9. Related Files

**Upstream Dependencies (All Complete ✅):**
- `src/analysis/constants.ts` — VALID_EVIDENCE_KEYS definition
- `shared/diff.ts` — DiffEvidence, Severity types

**Downstream Dependents (Waiting for Chunk 4 ✅):**
- `src/analysis/classify.ts` (Chunk 5) — Will call `validateEvidenceKeys()` before persistence

**Documentation References:**
- Phase-B2.md §1.1 — Key normalization & sorting
- Phase-B2.md §1.3 — Evidence key vocabulary
- IMPLEMENTATION_CHUNKS.md §4.1 — Chunk 4 specification

---

## 10. Summary

**Chunk 4 is a validation module with clear, deterministic requirements:**

✅ **No ambiguity** — Evidence vocabulary is explicitly defined in Phase-B2.md §1.3
✅ **No blockers** — All dependencies available from Chunk 0
✅ **No complexity** — Pure function, no side effects, no special logic
✅ **High confidence** — Specification is complete and unambiguous

**Estimated completion: 60 minutes (30 min code + 30 min tests)**

**Ready to proceed with implementation.** 🚀

---

**Design Document Status:** ✅ Complete
**Design Version:** 1.0
**Last Updated:** 2026-01-11
**Ready for Implementation:** YES