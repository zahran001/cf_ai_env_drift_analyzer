# Phase B3 Implementation Action Plan

**Status:** Design Complete + All 4 Critiques Integrated ✅
**Ready For:** Development Work
**Target Completion:** Phase B3 ready for Phase B4 integration
**Critique Reference:** See CRITIQUE_EVALUATION.md for detailed assessment

---

## Overview: What You're Building

You are implementing the **Signal Provider Layer** for cf_ai_env_drift_analyzer. This layer:
- Transforms raw HTTP requests into normalized `SignalEnvelope` objects
- Enables the deterministic analysis engine (Phase B2) to work with consistent input
- Is the **production entry point** for all environmental data collection

**Two TypeScript files:**
1. `src/providers/types.ts` — Provider interface + types (75 lines)
2. `src/providers/activeProbe.ts` — ActiveProbeProvider implementation (350-400 lines with critiques)

**One test file:**
3. `src/analysis/__tests__/activeProbe.test.ts` — Comprehensive test suite (400-450 lines with critiques)

**Total implementation:** ~825 lines of TypeScript + tests (includes critique-driven security & reliability improvements)

---

## Critical Design Decisions (Production-Hardened)

### 1. Manual Redirect Handling (Non-Negotiable)

```typescript
// MUST use this:
fetch(url, { redirect: "manual" })

// NEVER use this:
fetch(url, { redirect: "follow" })
```

**Why:** Need to capture exact redirect chain, detect loops, measure duration accurately.

### 2. Timeout Budget: 9 Seconds (Refined)

```typescript
const PROBE_ABORT_TIMEOUT_MS = 9000; // NOT 10000
```

**Why:** Leaves 1-second grace period for provider wrap-up before Workflow step timeout (30s). 9s + 1s provider + 1s DO persistence = 11s total, well under 30s step limit.

### 3. SSRF Validation: 3-Layer (Production-Hardened)

**Layer 1:** Scheme check (http/https only)
**Layer 2:** Hostname blocklist (localhost, localhost.localdomain)
**Layer 3:** IP CIDR validation (use ipaddr.js library)

```typescript
// Stops tricks like:
// - http://2130706433 (decimal 127.0.0.1)
// - http://0x7f000001 (hex 127.0.0.1)
// - http://0177.0.0.1 (octal)
// - http://[::1] (IPv6 loopback)
```

**Dependency:** Add `ipaddr.js` to package.json

### 4. Header Filtering: Sorted Keys (Determinism)

```typescript
// Result MUST always have sorted keys:
{
  "core": {
    "cache-control": "...",
    "content-type": "...",
    "vary": "..."
  }
}

// NOT:
{
  "core": {
    "vary": "...",
    "cache-control": "...",
    "content-type": "..."
  }
}
```

**Why:** Ensures JSON.stringify() produces byte-identical output for same input.

### 5. Runner Context: Safe Fallbacks (Local Dev Support)

```typescript
// Must handle missing request.cf:
extractRunnerContext(request.cf)
// Returns { colo: "SFO", ... } in production
// Returns { colo: "LOCAL", ... } in wrangler dev
```

**Why:** Enables development and testing without crashing on undefined cf.

---

## Implementation Checklist

### Phase B3a: Types & Interface (30 min)

**File:** `src/providers/types.ts`

- [ ] Export `ProviderRunnerContext` type with optional colo/country/asn fields
- [ ] Export `ISignalProvider` interface with `probe()` method
- [ ] Export helper types (ProbeSuccess, ProbeFailure already in shared/signal.ts)
- [ ] Document interface semantics (always returns SignalEnvelope, no throws)

**Code:** ~75 lines

### Phase B3b: Utility Functions (1.5 hours)

**File:** `src/providers/activeProbe.ts` (part 1)

**Critique A (SSRF Validation):**
- [ ] `validateUrlSafety()` — **3-layer SSRF validation with ipaddr.js**
  - Layer 1: Scheme check (http/https only)
  - Layer 2: Hostname blocklist (localhost, localhost.localdomain)
  - Layer 3: IP CIDR validation (IPv4 + IPv6 private ranges, handles decimal/hex/octal)
  - Reference: PHASE_B3_CRITIQUE_REFINEMENT.md §A

**Critique C (request.cf Fallback):**
- [ ] `extractRunnerContext()` — **Safe cf extraction with fallbacks**
  - Returns default { colo: "LOCAL", country: "XX", asn: undefined } if cf unavailable
  - Uses nullish coalescing (??) for partial cf objects
  - Reference: PHASE_B3_CRITIQUE_REFINEMENT.md §C

**Other utilities:**
- [ ] `resolveUrl()` — Relative → absolute URL resolution
- [ ] `classifyFetchError()` — Map fetch errors to stable error codes

**Critique D (Header Determinism):**
- [ ] `filterHeaders()` — Whitelist 6 headers + ac-* prefix **with sorted keys**
  - CRITICAL: Sort all keys alphabetically to ensure byte-identical JSON output
  - Reference: PHASE_B3_CRITIQUE_REFINEMENT.md §D

**Critique B (Timeout Budgeting):**
- [ ] `DurationTracker` class — **Timeout + duration management with budget checks**
  - AbortController timeout: 9000ms (not 10000ms)
  - Add `shouldContinue()` method to check remaining time before each fetch
  - Add `getRemainingMs()` for budget tracking
  - Reference: PHASE_B3_CRITIQUE_REFINEMENT.md §B

**Code:** ~175 lines (was 150)
**Tests:** Parallel unit tests as you go (25-30 test cases, was 15-20)
- SSRF bypass tests (11+ cases): decimal/hex/octal IPs, IPv6, private ranges
- Timeout budget tests (3+ cases): verify 9s abort, grace period behavior
- cf fallback tests (4+ cases): undefined, partial, null, full cf objects
- Header determinism tests (4+ cases): order independence, case normalization, filtering

### Phase B3c: Redirect Algorithm (1.5-2 hours)

**File:** `src/providers/activeProbe.ts` (part 2)

**Critique B Integration (Timeout Budgeting):**
- [ ] `followRedirects()` function with:
  - Manual redirect loop (10 hop max)
  - Visited set for loop detection
  - Location header parsing + relative URL resolution
  - **9s timeout with early-exit checks using DurationTracker** (ref: §B)
  - Check `shouldContinue()` before each fetch to verify remaining budget
  - Comprehensive error handling
  - Duration measurement
  - Returns ProbeSuccess or ProbeFailure

**Code:** ~125-175 lines (was 100-150)
**Tests:** Parallel integration tests (8-10 scenarios, was 6-8)
- Single response (no redirects)
- Redirect chain (2-3 hops)
- Redirect loops
- Missing Location header
- Invalid URLs
- **Timeout at 9s boundary** (critical test from critique)
- DNS failures
- TLS errors
- Early-exit budget check (abort before max redirects if time exhausted)

### Phase B3d: Orchestrator Function (30 min)

**File:** `src/providers/activeProbe.ts` (part 3)

- [ ] `probe()` function that orchestrates:
  - SSRF validation
  - Context extraction
  - Redirect following
  - Header filtering
  - ProbeSuccess response building
  - Error wrapping in ProbeFailure
  - capturedAt ISO 8601 timestamp

**Code:** ~50 lines
**Tests:** 2-3 end-to-end tests

### Phase B3e: Comprehensive Test Suite (2-2.5 hours)

**File:** `src/analysis/__tests__/activeProbe.test.ts`

**Critique A: SSRF Validation Tests (11+ tests):**
- Accept public IPv4 (e.g., 8.8.8.8)
- Accept public IPv6 (e.g., [2606:4700:4700::1111])
- Accept public hostnames (example.com, api.github.com)
- Reject localhost variants (localhost, localhost:8080, localhost.localdomain)
- Reject decimal IP form (2130706433 = 127.0.0.1)
- Reject hex IP form (0x7f000001)
- Reject octal IP form (0177.0.0.1)
- Reject IPv6 loopback ([::1])
- Reject IPv6 link-local ([fe80::1])
- Reject IPv4 private ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
- Reject non-http/https schemes (ftp://, file://, etc.)

**Critique B: Timeout Budgeting Tests (3+ tests):**
- Timeout at 9s AbortController (not 10s)
- Provider completes well before Workflow timeout (30s step limit)
- Early-exit when time budget exhausted mid-redirect-chain

**Critique C: request.cf Fallback Tests (4+ tests):**
- Extract all fields when cf is available
- Provide safe defaults when cf is undefined
- Handle partial cf objects
- Handle null cf gracefully

**Critique D: Header Determinism Tests (4+ tests):**
- Produces identical JSON for same headers in different order
- Normalizes header case to lowercase
- Ignores non-whitelisted headers
- Captures all access-control-* headers
- All keys are alphabetically sorted

**Other unit tests (15-20 tests):**
- URL resolution: relative, absolute, protocol-relative paths
- Error classification: DNS, timeout, TLS, fetch, SSRF blocked
- Duration tracking: time measurement, remaining budget checks

**Integration tests (8-10 tests):**
- Single response (no redirects)
- Redirect chain (2-3 hops with timing measurements)
- Redirect loops with early detection
- Missing Location header handling
- Invalid URLs rejected with clear errors
- DNS failures mapped to "dns_error" code
- TLS errors mapped to "tls_error" code
- SSRF rejection with detailed error message

**Determinism tests (3-5 tests):**
- Same input produces identical JSON (multiple runs byte-identical)
- Sorted headers every time (order-independent)
- Error structure consistent across runs

**Code:** ~400-450 lines (was 300-350)

### Phase B3f: Temporary Test Endpoint (30 min)

**File:** `src/api/routes.ts` (add to existing file)

```typescript
// GET /api/probe?url=https://example.com
// Returns: { schemaVersion, comparisonId, probeId, side, requestedUrl, capturedAt, cf, result }
```

- [ ] Route handler with SSRF validation
- [ ] Context extraction from request.cf
- [ ] Provider invocation
- [ ] JSON response

**Code:** ~50 lines

### Phase B3g: Manual Testing (1.5 hours)

**Critique-Driven Test Scenarios:**

**SSRF Validation (Critique A):**
- [ ] Reject localhost: `http://localhost:8080` → SSRF blocked
- [ ] Reject decimal IP: `http://2130706433` (127.0.0.1) → SSRF blocked
- [ ] Reject private range: `http://192.168.1.1` → SSRF blocked
- [ ] Accept public IP: `https://8.8.8.8` → Success (or fails with network error, not SSRF)

**Timeout Budgeting (Critique B):**
- [ ] Slow URL that takes 8.5s → Completes successfully
- [ ] Slow URL that would take >9.5s → Timeout error (with correct code)
- [ ] Verify timeout error includes duration_ms field for monitoring

**request.cf Fallback (Critique C):**
- [ ] Test with `wrangler dev` (no production cf) → Returns { colo: "LOCAL", country: "XX" }
- [ ] Verify no crashes on missing cf context
- [ ] Log shows "LOCAL" for development environment

**Header Determinism (Critique D):**
- [ ] Run same URL twice → Both envelopes have identically sorted headers
- [ ] Verify `JSON.stringify(envelope1.result) === JSON.stringify(envelope2.result)`
- [ ] Check that only whitelisted headers captured (no Authorization, Set-Cookie, etc.)

**Standard Tests:**
- [ ] Test against real public URLs (example.com, api.github.com)
- [ ] Test redirect chains (verify chain captured correctly)
- [ ] Check duration accuracy (simple request < 100ms, 3-hop redirect < 2s)
- [ ] Verify header filtering (only 6 core + ac-* captured)
- [ ] Test error cases with clear messages (DNS, TLS, timeout)

---

## File Locations & Dependencies

### New Files to Create

```
src/providers/
├── types.ts              ← Provider interface (75 lines)
└── activeProbe.ts        ← Implementation (300-350 lines)

src/analysis/__tests__/
└── activeProbe.test.ts   ← Tests (300-350 lines)
```

### Files to Modify

```
src/api/routes.ts         ← Add /api/probe endpoint (50 lines)
package.json              ← Add ipaddr.js dependency
```

### Reference Files (Read-Only)

```
shared/signal.ts                    ← SignalEnvelope schema
CLAUDE.md                           ← System rules (§3.1, §5.1, §5.2)
PHASE_B3_DESIGN.md                  ← Full architecture
PHASE_B3_CRITIQUE_REFINEMENT.md     ← Production hardening details (4 critiques)
CRITIQUE_EVALUATION.md              ← Assessment & integration guide
```

---

## Dependencies

**New npm package:**
```bash
npm install ipaddr.js
npm install --save-dev @types/ipaddr.js
```

**Why:** Robust IP address validation (handles decimal, hex, octal, IPv6, CIDR ranges)

---

## Testing Strategy

### Run Tests Incrementally

```bash
# As you implement each section:
npm test -- src/providers/__tests__/activeProbe.test.ts

# Full test suite when done:
npm test

# Expect: 350+ tests passing (302 existing + 45-50 new)
```

### Determinism Verification

```typescript
// This test is critical for Phase B2 compatibility:
test("Multiple runs produce byte-identical SignalEnvelopes", async () => {
  const url = "https://example.com";
  const ctx = { colo: "SFO", country: "US" };

  const envelope1 = await activeProbeProvider.probe(url, ctx);
  const envelope2 = await activeProbeProvider.probe(url, ctx);

  // Both should have same structure (capturedAt will differ slightly, so compare result.ok, redirects, status only)
  expect(envelope1.result.ok).toBe(envelope2.result.ok);
  expect(JSON.stringify(envelope1.result)).toBe(JSON.stringify(envelope2.result));
});
```

---

## Key Code Patterns

### Pattern 1: Always Return SignalEnvelope (Never Throw)

```typescript
async function probe(
  url: string,
  context?: ProviderRunnerContext
): Promise<SignalEnvelope> {
  // NEVER throw in provider code
  // Wrap everything in try-catch and return ProbeFailure

  const { safe, reason } = validateUrlSafety(url);
  if (!safe) {
    return {
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      comparisonId: "unknown", // Caller will set this
      probeId: "unknown",      // Caller will set this
      side: "left",            // Caller will set this
      requestedUrl: url,
      capturedAt: new Date().toISOString(),
      cf: context,
      result: {
        ok: false,
        error: {
          code: "invalid_url",
          message: `URL validation failed: ${reason}`,
        },
      },
    };
  }

  // Continue with actual probe...
}
```

### Pattern 2: Deterministic Error Codes

```typescript
type ProbeErrorCode =
  | "invalid_url"
  | "dns_error"
  | "timeout"
  | "tls_error"
  | "ssrf_blocked"
  | "fetch_error"
  | "unknown_error";

// Always use one of these 7 codes (stable for downstream analysis)
```

### Pattern 3: Sorted Headers for Determinism

```typescript
const sortedCoreHeaders: CoreResponseHeaders = {};
for (const key of Object.keys(coreHeaders).sort()) {
  sortedCoreHeaders[key as keyof CoreResponseHeaders] =
    coreHeaders[key as keyof CoreResponseHeaders];
}
// Result is now deterministically ordered
```

### Pattern 4: Safe Context Extraction

```typescript
function extractRunnerContext(
  cfContext?: Record<string, any>
): ProviderRunnerContext {
  if (!cfContext) {
    return {
      colo: "LOCAL",  // Development fallback
      country: "XX",
      asn: undefined,
    };
  }

  return {
    colo: cfContext.colo ?? "UNKNOWN",  // Defensive
    country: cfContext.country ?? "XX",
    asn: cfContext.asn ?? undefined,
  };
}
```

---

## Success Criteria (When to Mark "Done")

✅ **All Files Created:**
- [ ] `src/providers/types.ts` exported
- [ ] `src/providers/activeProbe.ts` fully implemented with all 4 critiques
- [ ] Test file created with 45-50+ passing tests (50-60 with critique tests)
- [ ] Temporary `/api/probe` endpoint works

✅ **All Tests Pass:**
- [ ] `npm test` shows 350+ tests passing (400+ with critiques)
- [ ] No warnings or errors
- [ ] Coverage > 85% for activeProbe.ts

✅ **Design Contracts Met:**
- [ ] Output is always SignalEnvelope (never throws)
- [ ] Deterministic output (byte-identical JSON for same input)
- [ ] **SSRF validation: 3-layer with ipaddr.js** (Critique A)
  - [ ] Blocks all localhost variants (localhost, localhost.localdomain)
  - [ ] Blocks decimal/hex/octal IP representations
  - [ ] Blocks IPv4 private ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
  - [ ] Blocks IPv6 loopback and link-local
- [ ] **Redirect chains captured accurately**
- [ ] **Timeout at 9s with DurationTracker** (Critique B)
  - [ ] AbortController fires at 9000ms
  - [ ] Early-exit checks before each redirect
  - [ ] Budget calculations track remaining time
- [ ] **Headers sorted for determinism** (Critique D)
  - [ ] All keys alphabetically ordered
  - [ ] Byte-identical JSON for same input
- [ ] **Context extracted with fallbacks** (Critique C)
  - [ ] Returns { colo: "LOCAL", country: "XX" } when cf unavailable
  - [ ] Handles partial cf objects gracefully
  - [ ] No crashes in wrangler dev

✅ **Manual Testing Passed (Critique-Specific):**
- [ ] **SSRF tests:** localhost rejected, decimal IP rejected, public IPs accepted
- [ ] **Timeout tests:** Verify abort at 9s, not earlier
- [ ] **Fallback tests:** wrangler dev returns LOCAL context
- [ ] **Determinism tests:** Same URL run twice produces identical JSON
- [ ] `/api/probe?url=https://example.com` works end-to-end
- [ ] Redirect chains visible in output
- [ ] Error cases handled gracefully with deterministic codes
- [ ] Local dev doesn't crash on missing cf

✅ **Documentation:**
- [ ] Code comments explain redirect algorithm
- [ ] Error codes documented (7 deterministic codes)
- [ ] Function signatures clear with examples
- [ ] Examples shown for each error case
- [ ] Timeout behavior documented (9s total, typical <2s)
- [ ] SSRF validation layers documented
- [ ] Determinism requirement emphasized

---

## What Comes Next (After Phase B3)

Once Phase B3 is complete:

1. **Phase B4:** Durable Objects + SQLite storage
   - DO will use SignalEnvelope from provider
   - Will persist probe with deterministic ID

2. **Phase B5:** Workers AI LLM layer
   - Will consume diff from Phase B2
   - Will produce structured explanation

3. **Phase B6:** Workflow orchestration
   - Will call activeProbeProvider.probe()
   - Will save results to DO
   - Will call LLM

4. **Phase B7:** API endpoints
   - Will expose `/api/compare` endpoint
   - Will use provider layer indirectly (via Workflow)

---

## Common Pitfalls to Avoid

❌ **Mistake 1:** Using `fetch(..., { redirect: "follow" })`
✅ **Correct:** Use `fetch(..., { redirect: "manual" })`

❌ **Mistake 2:** Throwing exceptions in provider
✅ **Correct:** Always return SignalEnvelope with error in result

❌ **Mistake 3:** Timeout at 10s
✅ **Correct:** Timeout at 9s (leave grace period)

❌ **Mistake 4:** SSRF validation by hostname only
✅ **Correct:** Use ipaddr.js for IP CIDR validation

❌ **Mistake 5:** Headers in random order
✅ **Correct:** Sort keys before returning

❌ **Mistake 6:** Crashing on missing request.cf
✅ **Correct:** Provide safe fallbacks

❌ **Mistake 7:** Not testing determinism
✅ **Correct:** Verify byte-identical output for same input

---

## Estimated Effort

| Section | Time | Lines | Critique Changes |
|---------|------|-------|------------------|
| B3a: Types | 0.5h | 75 | None |
| B3b: Utilities | 1.5h | 175 | +0.5h (SSRF, cf fallback, header sorting, DurationTracker) |
| B3c: Redirect Algorithm | 1.5-2h | 150 | Early-exit budget checks |
| B3d: Orchestrator | 0.5h | 50 | None |
| B3e: Test Suite | 2-2.5h | 450 | +0.5-1h (25+ new test cases from 4 critiques) |
| B3f: Test Endpoint | 0.5h | 50 | None |
| B3g: Manual Testing | 1.5h | 0 | +0.5h (SSRF, timeout, cf, determinism tests) |
| **Total** | **8.5-10h** | **825** | **+1.5-2h for critiques** |

**Breakdown by Critique:**
- **Critique A (SSRF):** +30 min (implementation) + 30 min (tests) = 1h
- **Critique B (Timeout):** +20 min (DurationTracker) + 20 min (tests) = 40 min
- **Critique C (cf Fallback):** +15 min (implementation) + 15 min (tests) = 30 min
- **Critique D (Headers):** +10 min (implementation) + 20 min (tests) = 30 min

**Realistic:** 9-11 hours (includes debugging, edge cases, polishing)

---

## Questions Clarified by Critique Evaluation

✅ **1. ipaddr.js dependency:** **APPROVED** (CRITIQUE_EVALUATION.md, Critique A)
- Well-maintained, no security issues
- Handles all IP parsing edge cases (decimal/hex/octal)
- ~6KB impact acceptable for production security

✅ **2. Error codes:** **Use custom codes** (Critique Pattern 2)
- 7 deterministic codes: invalid_url, dns_error, timeout, tls_error, ssrf_blocked, fetch_error, unknown_error
- Stable for Phase B2 diff analysis

✅ **3. Probe ID assignment:** **Caller generates** (Confirmed)
- Workflow assigns `${comparisonId}:${side}` for idempotency

✅ **4. Temporary test endpoint:** **Keep for debugging** (Phase B7+)
- Useful for manual validation and monitoring

✅ **5. Local dev fallback:** **`colo: "LOCAL"` is acceptable** (Critique C, CRITIQUE_EVALUATION.md)
- Clear indication of development environment
- Document in README for clarity

---

## Ready to Start?

✅ **You have:**
- Complete design architecture (PHASE_B3_DESIGN.md)
- Production hardening critiques (PHASE_B3_CRITIQUE_REFINEMENT.md)
- **Critique evaluation & integration guide (CRITIQUE_EVALUATION.md)** ⭐ NEW
- This action plan with code patterns (including all 4 critiques)
- Clear success criteria (expanded with critique requirements)
- Estimated effort (8.5-10 hours, includes critiques)

✅ **All 4 Critiques Integrated:**
- **Critique A (SSRF Validation):** 3-layer validation with ipaddr.js ✅
- **Critique B (Timeout Budgeting):** 9s timeout with DurationTracker ✅
- **Critique C (request.cf Fallback):** Safe extraction with defaults ✅
- **Critique D (Header Determinism):** Sorted keys for byte-identical output ✅

✅ **Next step:** Start with Phase B3a (types.ts), then B3b (utilities), then B3c (redirect algorithm)

**Implementation sequence:**
1. B3a: Types & interface (30 min)
2. B3b: Utilities with all 4 critiques integrated (1.5h)
3. B3c: Redirect algorithm with timeout budgeting (1.5-2h)
4. B3d: Orchestrator function (30 min)
5. B3e: Comprehensive test suite with 50-60 tests (2-2.5h)
6. B3f: Temporary test endpoint (30 min)
7. B3g: Manual testing including critique scenarios (1.5h)

**All files should be implemented sequentially with tests as you go.**

---

**Document Version:** 2.0 (Critiques Fully Integrated)
**Status:** Ready for Development
**Created:** 2026-01-13
**Updated:** 2026-01-13 (Integrated CRITIQUE_EVALUATION.md findings)
