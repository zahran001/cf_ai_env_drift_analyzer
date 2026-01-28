# Fix Design: AccessControl Header Diff Computation

## Problem Statement

The `computeHeaderDiff()` function in [src/analysis/diff.ts:108-143](src/analysis/diff.ts#L108-L143) **only compares core headers** and ignores accessControl headers. This causes CORS header diffs to never be detected.

**Impact:** Test D2 fails because `access-control-allow-origin` drift is invisible to the classifier.

---

## Current Code Structure

### Current EnvDiff Type (shared/diff.ts:284-287)
```typescript
headers?: {
  core: HeaderDiff<CoreHeaderKey>;
  accessControl?: HeaderDiff<string>;  // ← Already defined in type, but never populated!
};
```

**The type already supports accessControl diffs.** The problem is that `computeDiff()` never populates them.

---

## Design Decision: Two-Step Diff Computation

### Option A: Single computeHeaderDiff() With Two Iterations ❌ (Complex)
- Iterate core keys once, accessControl keys once
- Mix in a single function
- **Problem:** Function becomes complex, mixing two different diff types
- **Problem:** Type inference gets messy

### Option B: Separate Functions (Clean Separation) ✅ **RECOMMENDED**
- Create `computeCoreHeaderDiff()` for core headers
- Create `computeAccessControlHeaderDiff()` for accessControl headers
- Call both from `computeDiff()`
- **Benefit:** Each function has single responsibility
- **Benefit:** Mirrors the two-category architecture
- **Benefit:** Easy to test independently

---

## Detailed Fix Design (Option B)

### Step 1: Create Two Specialized Functions

**File:** [src/analysis/diff.ts](src/analysis/diff.ts)

#### New Function 1: `computeCoreHeaderDiff()`
```typescript
/**
 * Compute diff for core headers only.
 *
 * @param leftHeaders - Left response headers (with .core property)
 * @param rightHeaders - Right response headers (with .core property)
 * @returns HeaderDiff for core headers (may be empty)
 *
 * @example
 * const diff = computeCoreHeaderDiff(
 *   { core: { "cache-control": "public" } },
 *   { core: { "cache-control": "no-cache" } }
 * );
 * // Returns: { added: {}, removed: {}, changed: { "cache-control": { ... } }, unchanged: {} }
 */
function computeCoreHeaderDiff(
  leftHeaders: typeof leftResponse.headers,
  rightHeaders: typeof rightResponse.headers
): HeaderDiff<CoreHeaderKey> {
  const added: Record<string, string> = {};
  const removed: Record<string, string> = {};
  const changedHeaders: Record<string, Change<string>> = {};
  const unchangedHeaders: Record<string, string> = {};

  const allKeys = new Set<string>();

  // Collect all keys from CORE headers
  if (leftHeaders.core) {
    Object.keys(leftHeaders.core).forEach((k) => allKeys.add(k));
  }
  if (rightHeaders.core) {
    Object.keys(rightHeaders.core).forEach((k) => allKeys.add(k));
  }

  // Classify each key
  for (const key of allKeys) {
    const leftVal = leftHeaders.core?.[key as keyof typeof leftHeaders.core];
    const rightVal = rightHeaders.core?.[key as keyof typeof rightHeaders.core];

    if (leftVal === undefined && rightVal !== undefined) {
      added[key] = rightVal;
    } else if (leftVal !== undefined && rightVal === undefined) {
      removed[key] = leftVal;
    } else if (leftVal !== rightVal) {
      changedHeaders[key] = changed(leftVal!, rightVal!);
    } else {
      unchangedHeaders[key] = leftVal!;
    }
  }

  return {
    added,
    removed,
    changed: changedHeaders,
    unchanged: unchangedHeaders,
  };
}
```

#### New Function 2: `computeAccessControlHeaderDiff()`
```typescript
/**
 * Compute diff for access-control-* headers only.
 *
 * @param leftHeaders - Left response headers (with .accessControl property)
 * @param rightHeaders - Right response headers (with .accessControl property)
 * @returns HeaderDiff for access-control headers (undefined if none present)
 *
 * @example
 * const diff = computeAccessControlHeaderDiff(
 *   { accessControl: { "access-control-allow-origin": "*" } },
 *   { accessControl: { "access-control-allow-origin": "https://example.com" } }
 * );
 * // Returns: { added: {}, removed: {}, changed: { "access-control-allow-origin": { ... } }, unchanged: {} }
 */
function computeAccessControlHeaderDiff(
  leftHeaders: typeof leftResponse.headers,
  rightHeaders: typeof rightResponse.headers
): HeaderDiff<string> | undefined {
  // Early exit if neither side has access-control headers
  if (!leftHeaders.accessControl && !rightHeaders.accessControl) {
    return undefined;
  }

  const added: Record<string, string> = {};
  const removed: Record<string, string> = {};
  const changedHeaders: Record<string, Change<string>> = {};
  const unchangedHeaders: Record<string, string> = {};

  const allKeys = new Set<string>();

  // Collect all keys from ACCESS-CONTROL headers
  if (leftHeaders.accessControl) {
    Object.keys(leftHeaders.accessControl).forEach((k) => allKeys.add(k));
  }
  if (rightHeaders.accessControl) {
    Object.keys(rightHeaders.accessControl).forEach((k) => allKeys.add(k));
  }

  // Classify each key
  for (const key of allKeys) {
    const leftVal = leftHeaders.accessControl?.[key];
    const rightVal = rightHeaders.accessControl?.[key];

    if (leftVal === undefined && rightVal !== undefined) {
      added[key] = rightVal;
    } else if (leftVal !== undefined && rightVal === undefined) {
      removed[key] = leftVal;
    } else if (leftVal !== rightVal) {
      changedHeaders[key] = changed(leftVal!, rightVal!);
    } else {
      unchangedHeaders[key] = leftVal!;
    }
  }

  // Return undefined if no changes detected (optimization for empty diffs)
  const hasChanges =
    Object.keys(added).length > 0 ||
    Object.keys(removed).length > 0 ||
    Object.keys(changedHeaders).length > 0;

  return hasChanges
    ? {
        added,
        removed,
        changed: changedHeaders,
        unchanged: unchangedHeaders,
      }
    : undefined;
}
```

### Step 2: Update `computeDiff()` to Use Both Functions

**Current Code (Lines 104-155):**
```typescript
// Build header diff
const leftHeaders = leftResponse.headers;
const rightHeaders = rightResponse.headers;

const computeHeaderDiff = (...): HeaderDiff<string> => {
  // ❌ OLD: Only core headers
  // ...
};

const headerDiffCore = computeHeaderDiff(leftHeaders, rightHeaders);

const headerDiff =
  Object.keys(headerDiffCore.added).length > 0 ||
  Object.keys(headerDiffCore.removed).length > 0 ||
  Object.keys(headerDiffCore.changed).length > 0
    ? {
        core: headerDiffCore,
        accessControl: leftHeaders.accessControl || rightHeaders.accessControl ? { added: {}, removed: {}, changed: {}, unchanged: {} } : undefined,
      }
    : undefined;
```

**New Code:**
```typescript
// Build header diff
const leftHeaders = leftResponse.headers;
const rightHeaders = rightResponse.headers;

// Compute core and accessControl diffs separately
const coreHeaderDiff = computeCoreHeaderDiff(leftHeaders, rightHeaders);
const accessControlHeaderDiff = computeAccessControlHeaderDiff(leftHeaders, rightHeaders);

// Only include headers section if either group has changes
const headerDiff = Object.keys(coreHeaderDiff.added).length > 0 ||
  Object.keys(coreHeaderDiff.removed).length > 0 ||
  Object.keys(coreHeaderDiff.changed).length > 0 ||
  accessControlHeaderDiff
  ? {
      core: coreHeaderDiff,
      accessControl: accessControlHeaderDiff,
    }
  : undefined;
```

---

## Test Case Walkthrough: D2 (CORS Header Drift)

### Input
```typescript
leftEnvelope = {
  result: {
    ok: true,
    response: {
      headers: {
        core: { "cache-control": "public" },
        accessControl: { "access-control-allow-origin": "*" }
      }
    }
  }
}

rightEnvelope = {
  result: {
    ok: true,
    response: {
      headers: {
        core: { "cache-control": "public" },
        accessControl: { "access-control-allow-origin": "https://example.com" }
      }
    }
  }
}
```

### After Fix (Step 1: Diff Computation)

```typescript
// Core headers diff
const coreHeaderDiff = computeCoreHeaderDiff(leftHeaders, rightHeaders);
// Result: { added: {}, removed: {}, changed: {}, unchanged: { "cache-control": "public" } }

// AccessControl headers diff
const accessControlHeaderDiff = computeAccessControlHeaderDiff(leftHeaders, rightHeaders);
// Result: {
//   added: {},
//   removed: {},
//   changed: {
//     "access-control-allow-origin": {
//       left: "*",
//       right: "https://example.com",
//       changed: true
//     }
//   },
//   unchanged: {}
// }

// Final headerDiff
const headerDiff = {
  core: { added: {}, removed: {}, changed: {}, unchanged: { "cache-control": "public" } },
  accessControl: {
    added: {},
    removed: {},
    changed: { "access-control-allow-origin": { left: "*", right: "https://example.com", changed: true } },
    unchanged: {}
  }
};
```

### After Fix (Step 2: Classification)

In `classify()` (Lines 352-368):
```typescript
// Rule C2: CORS_HEADER_DRIFT
const corsHeaders = getAccessControlHeaderDiffs(diff);
// ✅ NOW WORKS: diff.headers.accessControl contains the diffs
// corsHeaders = ["access-control-allow-origin"]

if (corsHeaders.length > 0) {  // ✅ TRUE
  const hasAllowOriginDiff = corsHeaders.some((h) => h === "access-control-allow-origin");
  // ✅ hasAllowOriginDiff = true

  const severity: Severity = hasAllowOriginDiff ? "critical" : "warn";
  // ✅ severity = "critical"

  findings.push({
    id: generateFindingId("CORS_HEADER_DRIFT", "headers", corsHeaders),
    code: "CORS_HEADER_DRIFT",
    category: "security",
    severity: "critical",  // ✅ Correct
    message: "CORS headers differ",
    evidence: [{ section: "headers", keys: ["access-control-allow-origin"] }],
    left_value: { corsHeaders },
    right_value: { corsHeaders },
  });
}
```

### After Fix (Step 3: LLM)

The LLM now receives:
```typescript
{
  diff: {
    findings: [
      {
        code: "CORS_HEADER_DRIFT",
        category: "security",
        severity: "critical",
        evidence: [{ section: "headers", keys: ["access-control-allow-origin"] }]
      },
      {
        code: "FINAL_URL_MISMATCH",
        category: "routing",
        severity: "info"
      }
    ]
  }
}
```

The LLM generates:
```json
{
  "summary": "CORS policy changed from permissive (*) to specific origin (https://example.com). This is a security-relevant configuration change.",
  "ranked_causes": [
    {
      "cause": "CORS policy enforcement change",
      "confidence": 0.95,
      "evidence": ["access-control-allow-origin header changed from '*' to 'https://example.com'"]
    }
  ],
  "actions": [
    {
      "action": "Review CORS configuration change",
      "why": "This restricts which origins can access the resource"
    }
  ]
}
```

✅ **D2 Test Passes**

---

## Implementation Checklist

### Code Changes Required

- [ ] **[src/analysis/diff.ts](src/analysis/diff.ts)**
  - [ ] Remove inline `computeHeaderDiff()` function (lines 108-143)
  - [ ] Add `computeCoreHeaderDiff()` function
  - [ ] Add `computeAccessControlHeaderDiff()` function
  - [ ] Update `computeDiff()` to call both functions (lines 104-155)

### Tests to Update

- [ ] **[src/analysis/__tests__/diff.test.ts](src/analysis/__tests__/diff.test.ts)**
  - [ ] Add unit test: `computeCoreHeaderDiff()` with various scenarios
  - [ ] Add unit test: `computeAccessControlHeaderDiff()` with various scenarios
  - [ ] Update existing `computeDiff()` tests to verify both core and accessControl are included
  - [ ] Add integration test for D2 scenario (CORS header drift detection)

### No Changes Needed

- ✅ [shared/diff.ts](shared/diff.ts) - EnvDiff type already has `accessControl?: HeaderDiff<string>` at lines 284-287
- ✅ [src/analysis/classify.ts](src/analysis/classify.ts) - `getAccessControlHeaderDiffs()` already works correctly
- ✅ [src/analysis/headerDiff.ts](src/analysis/headerDiff.ts) - Standalone utility, not used in diff.ts path

---

## Implementation Steps

### 1. Remove Old Code (lines 108-155)
Delete the inline `computeHeaderDiff()` function and the logic that builds headerDiff.

### 2. Add New Functions
Insert the two new specialized functions before the main logic in `computeDiff()`.

### 3. Update computeDiff() Call Site
Replace lines 145-155 with the new code that calls both functions.

### 4. Verify Type Inference
- `coreHeaderDiff` should be `HeaderDiff<CoreHeaderKey>` ✓
- `accessControlHeaderDiff` should be `HeaderDiff<string> | undefined` ✓
- Final `headerDiff` should be `{ core: HeaderDiff<CoreHeaderKey>; accessControl?: HeaderDiff<string> } | undefined` ✓

### 5. Run Tests
```bash
npm run type-check  # Verify types
npm test            # Run all tests, especially diff and classify tests
```

---

## Edge Cases Handled

### Edge Case 1: No Headers at All
```typescript
leftHeaders = { core: {}, accessControl: undefined }
rightHeaders = { core: {}, accessControl: undefined }

coreHeaderDiff = { added: {}, removed: {}, changed: {}, unchanged: {} }
accessControlHeaderDiff = undefined
headerDiff = undefined  // ← Both are empty, so headerDiff is omitted
```

### Edge Case 2: Only Core Headers Differ
```typescript
leftHeaders = { core: { "cache-control": "public" }, accessControl: undefined }
rightHeaders = { core: { "cache-control": "no-cache" }, accessControl: undefined }

coreHeaderDiff = { added: {}, removed: {}, changed: { "cache-control": { ... } }, unchanged: {} }
accessControlHeaderDiff = undefined
headerDiff = { core: coreHeaderDiff, accessControl: undefined }
```

### Edge Case 3: Only AccessControl Headers Differ ⭐ **D2 Case**
```typescript
leftHeaders = { core: { "cache-control": "public" }, accessControl: { "access-control-allow-origin": "*" } }
rightHeaders = { core: { "cache-control": "public" }, accessControl: { "access-control-allow-origin": "https://example.com" } }

coreHeaderDiff = { added: {}, removed: {}, changed: {}, unchanged: { "cache-control": "public" } }
accessControlHeaderDiff = { added: {}, removed: {}, changed: { "access-control-allow-origin": { ... } }, unchanged: {} }
headerDiff = { core: coreHeaderDiff, accessControl: accessControlHeaderDiff }  // ✅ Both included
```

### Edge Case 4: AccessControl Header Added
```typescript
leftHeaders = { core: {}, accessControl: undefined }
rightHeaders = { core: {}, accessControl: { "access-control-allow-origin": "*" } }

coreHeaderDiff = { added: {}, removed: {}, changed: {}, unchanged: {} }
accessControlHeaderDiff = { added: { "access-control-allow-origin": "*" }, removed: {}, changed: {}, unchanged: {} }
headerDiff = { core: coreHeaderDiff, accessControl: accessControlHeaderDiff }
```

---

## Code Review Checklist

Before merging:

- [ ] Both `computeCoreHeaderDiff()` and `computeAccessControlHeaderDiff()` have JSDoc comments
- [ ] Types are correct: `CoreHeaderKey` for core, `string` for accessControl
- [ ] Early exit optimization in `computeAccessControlHeaderDiff()` returns `undefined` when no changes
- [ ] `computeDiff()` calls both functions and includes both in result
- [ ] No regression: core header diffs still work as before
- [ ] D2 test passes: CORS header drift is detected with critical severity
- [ ] All existing diff tests pass
- [ ] No new TypeScript errors
- [ ] Code follows existing style (function names, spacing, etc.)

---

## Summary

**Change Type:** Bug fix in diff computation layer

**Scope:** Single file ([src/analysis/diff.ts](src/analysis/diff.ts))

**Breaking Changes:** None (type-compatible, only adds missing data to diff output)

**Risk:** Low (isolated change, well-tested)

**Impact:** Enables detection of CORS header drift (security-critical)

**Files Modified:** 1 (src/analysis/diff.ts)

**Files Test:** 1 (src/analysis/__tests__/diff.test.ts)

**Effort:** ~30 mins implementation + ~15 mins testing
