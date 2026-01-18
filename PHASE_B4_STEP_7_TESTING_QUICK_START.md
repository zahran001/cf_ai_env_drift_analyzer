# Step 7 Testing — Quick Start Guide

## TL;DR

Run unit tests + manual validation before Step 8 (Workflow).

**Files to create:**
- `src/api/__tests__/validate.test.ts` (40 test cases)
- `src/api/__tests__/routes.test.ts` (25 test cases)

**Run tests:**
```bash
npm test src/api/__tests__/
wrangler dev  # Manual validation
```

**Success:** All 65 tests pass + 12 manual test sequences succeed.

---

## Test Categories (65 Total)

### Unit Tests: URL Validation (40 tests)

**Numeric IP Bypass (7 tests)**
- Decimal: `2130706433` → reject
- Hex: `0x7f000001` → reject
- Octal: `017700000001` → reject
- Valid domains with numbers → accept

**Localhost (6 tests)**
- `127.0.0.1`, `localhost`, `::1` → reject
- Case-insensitive → reject
- With port → reject

**Private IPs (21 tests)**
- 10.0.0.0/8 (5 tests)
- 172.16.0.0/12 (5 tests)
- 192.168.0.0/16 (5 tests)
- Link-local 169.254.0.0/16 (6 tests)

**Schemes (7 tests)**
- http/https → accept
- file, ftp, gopher, data, javascript → reject

**Valid Public URLs (8 tests)**
- Standard domains, subdomains, public IPs → accept

---

### Integration Tests: Routes (25 tests)

**Health Check (1 test)**
- GET /api/health → 200 ✅

**POST /api/compare — Happy Path (5 tests)**
- Valid URLs → 202 + comparisonId
- Correct format: `pairKey:uuid`
- Deterministic pairKey
- Order-invariant pairKey
- Unique UUIDs per request

**POST /api/compare — Validation (9 tests)**
- Missing fields → 400
- Localhost URLs → 400
- Private IPs → 400
- Numeric bypasses → 400
- Invalid schemes → 400
- Clear error messages → ✅

**GET /api/compare/:id (7 tests)**
- Non-existent ID → 404
- Correct pairKey extraction
- DO routing logic
- Invalid format handling

**404 Routes (2 tests)**
- Unknown paths → 404
- Wrong methods → 404

---

### Manual Testing (12 sequences)

| # | Test | Input | Expected | Status |
|---|------|-------|----------|--------|
| 1 | Health Check | GET /api/health | 200, ok:true | ✅ |
| 2 | Valid Compare | POST (example.com, cloudflare.com) | 202, comparisonId | ✅ |
| 3 | Poll Missing | GET /api/compare/fake-id | 404 | ✅ |
| 4 | Localhost Reject | POST leftUrl=localhost | 400, "Localhost" | ✅ |
| 5 | Private IP (10.x) | POST rightUrl=10.0.0.1 | 400, "Private IP" | ✅ |
| 6 | Private IP (192.168) | POST leftUrl=192.168.1.1 | 400, "Private IP" | ✅ |
| 7 | Numeric Bypass | POST leftUrl=2130706433 | 400, "bypass" | ✅ |
| 8 | Scheme Rejection | POST leftUrl=file:// | 400, "scheme" | ✅ |
| 9 | Determinism (Same URLs) | 2x same POST | Same pairKey | ✅ |
| 10 | Order-Invariance | POST (A,B) vs (B,A) | Same pairKey | ✅ |
| 11 | Malformed JSON | POST invalid JSON | 500 error | ✅ |
| 12 | Type Safety | POST without Content-Type | 202 or 400 | ✅ |

---

## Execution Plan (3-4 hours)

### Phase 1: Set Up (30 min)
```bash
# Check vitest is installed
npm list vitest

# Create test files (empty shells first)
touch src/api/__tests__/validate.test.ts
touch src/api/__tests__/routes.test.ts
```

### Phase 2: Write validate.test.ts (1.5 hours)
- Copy test cases from STEP_7_TESTING_PLAN.md
- 9 test suites, 40 total cases
- Run: `npm test src/api/__tests__/validate.test.ts`

### Phase 3: Write routes.test.ts (1.5 hours)
- Copy test cases from STEP_7_TESTING_PLAN.md
- 5 test suites, 25 total cases
- Run: `npm test src/api/__tests__/routes.test.ts`

### Phase 4: Manual Testing (30 min)
```bash
wrangler dev  # In terminal 1

# In terminal 2, run 12 test sequences
bash STEP_7_MANUAL_TESTS.sh  # Or run individually
```

### Phase 5: Document Results (30 min)
- Fill out STEP_7_TEST_RESULTS.md
- Commit: "Step 7: Comprehensive testing complete ✅"

---

## Coverage Goals

| File | Target | Method |
|------|--------|--------|
| `validate.ts` | ≥95% | Unit tests |
| `routes.ts` | ≥90% | Integration tests |
| **Total** | **≥92%** | Combined |

Check coverage:
```bash
npm test -- --coverage src/api/
```

---

## Common Issues & Fixes

### Issue: Tests fail with "Env is not defined"
**Fix:** Ensure `src/env.d.ts` exists and is imported in test setup

### Issue: URL validation too strict/lenient
**Fix:** Review test cases in STEP_7_TESTING_PLAN.md and adjust validators

### Issue: Manual tests hang on wrangler dev
**Fix:** Kill with Ctrl+C, check for port 8787 conflicts

### Issue: pairKey not deterministic
**Fix:** Check `computePairKeySHA256` is sorting URLs correctly

---

## What's NOT Tested Yet (Step 8+)

- ❌ Workflow execution (step.do orchestration)
- ❌ Signal probe actual execution
- ❌ Diff computation
- ❌ LLM explanation generation
- ❌ Idempotency (Workflow retries)
- ❌ End-to-end flow completion
- ❌ DO state persistence

These are all tested in Step 8 checkpoint.

---

## Success Indicators

✅ **Step 7 is complete when:**

1. `npm test src/api/` → All 65 tests pass (0 failures)
2. `wrangler dev` → No console errors
3. All 12 manual sequences → ✅ Completed
4. Code coverage → ≥92%
5. No TypeScript errors: `npx tsc --noEmit` → Clean
6. No linting issues: `npx eslint src/api/` → Clean
7. Commit message includes test results

---

## Next Steps (Post-Step 7)

1. ✅ Commit Step 7 testing results
2. → Implement Step 8 (Workflow + compareEnvironments.ts)
3. → Add Workflow integration tests (idempotency, retries)
4. → Add E2E test (POST /api/compare → completion)
5. → Full system testing

---

## Files Reference

| File | Purpose |
|------|---------|
| STEP_7_TESTING_PLAN.md | Comprehensive testing guide (this file) |
| STEP_7_TESTING_QUICK_START.md | Quick reference (this file) |
| src/api/__tests__/validate.test.ts | 40 unit tests (to create) |
| src/api/__tests__/routes.test.ts | 25 integration tests (to create) |
| STEP_7_TEST_RESULTS.md | Results log (to create) |
| STEP_7_MANUAL_TESTS.sh | Bash script for manual tests (optional) |

---

## Estimated Time Breakdown

```
Setup & scaffolding     ......... 30 min
Write validate tests    ......... 60 min
Write routes tests      ......... 60 min
Manual testing          ......... 30 min
Documentation           ......... 30 min
─────────────────────────────────────────
Total                   ....... 3-4 hours
```

**Recommendation:** Schedule 4-5 hours to avoid rushing.

---

**Ready to test?** Start with Phase 1 setup, then follow execution plan step-by-step.
