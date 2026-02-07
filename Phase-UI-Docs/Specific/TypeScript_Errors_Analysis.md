# TypeScript Errors Analysis — 2026-02-06

## Summary

**Total Errors:** 18 TypeScript errors
- **16 errors** in `useComparisonPoll.test.ts` (Phase 3B) — Type incompatibility in mock responses
- **2 errors** in `usePairHistory.ts` (Phase 3A) — Missing Vite type definitions

**Build Status:** ❌ Fails (18 errors block compilation)
**All Tests Pass:** ✅ 119 tests passing (jest ignores TypeScript errors)
**Phase 3E Impact:** ❌ Phase 3E files have zero errors, but build fails due to Phase 3A/3B errors

---

## Error Categories

### Category 1: useComparisonPoll.test.ts (16 errors)

**File:** `pages/src/hooks/useComparisonPoll.test.ts`
**Root Cause:** Mock response objects don't match the strict `CompareStatusResponse` type

**Type Definition (from shared/api.ts):**
```typescript
export type CompareStatusResponse<ResultT = CompareResult> = {
  status: CompareStatus;
  result?: ResultT;    // Optional, undefined when not present
  error?: CompareError; // Optional, undefined when not present
};

export type CompareError = {
  code: CompareErrorCode;
  message: string;
  details?: Record<string, unknown>;
};
```

**Problem:** The tests use **`null`** for absent optional fields, but TypeScript strict mode requires **`undefined`** (or absence).

#### Specific Errors:

**Lines 43, 62, 105, 121-122, 126, 162, 214, 248, 283, 313, 352, 387, 410 (14 errors total):**
```
error TS2322: Type 'null' is not assignable to type 'CompareError | undefined'
```

**Example (Line 43):**
```typescript
mockGetCompareStatus.mockResolvedValue({
  status: "running",
  result: null,  // ❌ Should be: undefined or omitted
  error: null,   // ❌ Should be: undefined or omitted
});
```

**Correct Approach:**
```typescript
mockGetCompareStatus.mockResolvedValue({
  status: "running",
  // Omit result and error entirely, or:
  result: undefined,
  error: undefined,
});
```

**Lines 53, 423 (2 errors total):**
```
error TS2322: Type 'string' is not assignable to type 'null'
error TS2322: Type 'null' is not assignable to type 'string'
```

**Example (Line 53):**
```typescript
rerender({ id: "cmp-123" });  // ❌ Expects { id: string | null } but "cmp-123" is a string
```

This appears to be a test setup issue where the prop type should accept `string | null` but is being passed a string.

---

### Category 2: usePairHistory.ts (2 errors)

**File:** `pages/src/hooks/usePairHistory.ts`
**Root Cause:** Missing Vite client type definitions

**Lines 60, 197:**
```
error TS2339: Property 'env' does not exist on type 'ImportMeta'
```

**Example (Line 60):**
```typescript
if (import.meta.env.DEV) {
  console.warn("[usePairHistory] Failed to persist to localStorage:", err);
}
```

**Root Cause Analysis:**

The `import.meta.env` object is provided by Vite but requires the type definitions from `vite/client`. Currently, `tsconfig.app.json` includes `vite/client` in the types array:

```json
"types": ["vite/client", "node"]
```

However, the `import.meta.env` access is failing. This suggests:
1. The Vite types may not be loaded correctly for runtime code
2. Or the types are only available during the Vite build, not during TypeScript compilation

**Solution Options:**

**Option A: Add `/// <reference types="vite/client" />` to usePairHistory.ts**
```typescript
/// <reference types="vite/client" />

if (import.meta.env.DEV) { ... }
```

**Option B: Use `as any` with comment (NOT recommended)**
```typescript
// ❌ Bad - defeats type safety
if ((import.meta as any).env.DEV) { ... }
```

**Option C: Check tsconfig.app.json and ensure proper augmentation**

Currently working in the app build but not in type-check phase. The issue is that during the build step (`tsc -b && vite build`), Vite types ARE available, but the pure TypeScript check may not have them.

---

## Impact Assessment

### Phase 3E Files (ZERO Errors) ✅
- FindingsList.tsx
- FindingItem.tsx
- CategoryGroup.tsx
- App.tsx
- FindingsList.test.tsx
- All supporting CSS Modules and .d.ts files

### Phase 3D Files (Status Unknown - Need Check)
- ExplanationPanel.tsx and tests

### Phase 3C Files (ZERO Errors, Per Memory) ✅
- SummaryStrip.tsx
- SeverityBadge.tsx
- StatusCodeBadge.tsx
- All tests passing (15 tests)

### Phase 3B Files (16 Errors) ❌
- useComparisonPoll.test.ts — Mock type mismatches

### Phase 3A Files (2 Errors) ❌
- usePairHistory.ts — Missing Vite type reference

---

## Fix Priority

### 🔴 Critical (Blocks Build)
1. **usePairHistory.ts** (Lines 60, 197)
   - Effort: 5 minutes
   - Impact: Unblocks build
   - Solution: Add `/// <reference types="vite/client" />` at top of file

2. **useComparisonPoll.test.ts** (Lines 43, 53, 62, 105, 121-122, 126, 162, 214, 248, 283, 313, 352, 387, 410, 423)
   - Effort: 30-45 minutes
   - Impact: Fixes build
   - Solution: Replace all `null` with `undefined` or omit optional fields; review rerender test case

---

## Recommended Fix Order

### Step 1: Fix usePairHistory.ts (Quickest Win)
Add Vite client type reference at the very top of the file (before any imports):

```typescript
/// <reference types="vite/client" />

import { useCallback, useEffect, useState } from "react";
// ... rest of file
```

**Why:** This tells TypeScript compiler about Vite's `import.meta.env` type augmentation.

### Step 2: Fix useComparisonPoll.test.ts (Comprehensive)

Search-and-replace approach:
1. Replace all `error: null,` with `error: undefined,` (or delete the field)
2. Replace all `result: null,` with `result: undefined,` (or delete the field)
3. Fix the rerender test case to handle string | null prop correctly

Example fix for lines 40-44:
```typescript
// BEFORE
mockGetCompareStatus.mockResolvedValue({
  status: "running",
  result: null,
  error: null,
});

// AFTER
mockGetCompareStatus.mockResolvedValue({
  status: "running",
  result: undefined,
  error: undefined,
});
// OR simply omit them (since they're optional):
mockGetCompareStatus.mockResolvedValue({
  status: "running",
});
```

---

## Testing After Fixes

```bash
# Step 1: Verify type-check passes
cd pages
npx tsc -b --noEmit

# Step 2: Run tests
npm test

# Step 3: Build
npm run build

# Step 4: From root
npm run type-check
npm run verify
```

---

## Notes for Future Development

### TypeScript Strict Mode Requires Clarity
- `null` ≠ `undefined` in strict mode
- Optional fields should be omitted or explicitly `undefined`, never `null`
- This is intentional TypeScript behavior to prevent null-coalescing bugs

### Vite Client Types
- Must be referenced in tsconfig (already done) AND in files that use `import.meta.env`
- The triple-slash reference (`/// <reference types="vite/client" />`) is the idiomatic way to apply types to a file
- Alternative: Configure tsconfig to apply types globally (more complex)

### Test Mock Pattern
When mocking API responses with optional fields:
```typescript
// ✅ Good: Omit optional fields entirely
mockApi.mockResolvedValue({ status: "completed" });

// ✅ Also good: Explicitly undefined
mockApi.mockResolvedValue({ status: "completed", error: undefined });

// ❌ Bad: Use null for optional fields
mockApi.mockResolvedValue({ status: "completed", error: null });
```

---

## Phase Readiness

- **Phase 3E:** ✅ Production-ready (zero TypeScript errors)
- **Phase 3D:** ⚠️ Depends on ExplanationPanel — check if it has errors
- **Phase 3C:** ✅ Complete (zero TypeScript errors)
- **Phase 3A/3B:** ❌ Blocked by 18 TypeScript errors (build fails)

---

## Blockers to Moving Forward

| Blocker | Severity | Status |
|---------|----------|--------|
| 18 TypeScript errors | 🔴 CRITICAL | Can be fixed in ~45 minutes |
| Build fails | 🔴 CRITICAL | Dependent on above |
| npm run verify fails | 🔴 CRITICAL | Dependent on above |
| Testing in CI/CD | 🔴 CRITICAL | Blocked until fixed |

Once Phase 3A/3B errors are fixed, the codebase will be fully type-safe and ready for:
- PR merging to main
- CI/CD pipeline
- Phase 3F (Finding Detail View) implementation
- Backend integration testing
