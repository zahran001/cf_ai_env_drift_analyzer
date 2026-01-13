# Phase B3 Implementation Action Plan

**Status:** Design Complete + Critiques Integrated
**Ready For:** Development Work
**Target Completion:** Phase B3 ready for Phase B4 integration

---

## Overview: What You're Building

You are implementing the **Signal Provider Layer** for cf_ai_env_drift_analyzer. This layer:
- Transforms raw HTTP requests into normalized `SignalEnvelope` objects
- Enables the deterministic analysis engine (Phase B2) to work with consistent input
- Is the **production entry point** for all environmental data collection

**Two TypeScript files:**
1. `src/providers/types.ts` — Provider interface + types (75 lines)
2. `src/providers/activeProbe.ts` — ActiveProbeProvider implementation (300-350 lines)

**One test file:**
3. `src/analysis/__tests__/activeProbe.test.ts` — Comprehensive test suite (250-350 lines)

**Total implementation:** ~600-700 lines of TypeScript + tests

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

### Phase B3b: Utility Functions (1 hour)

**File:** `src/providers/activeProbe.ts` (part 1)

- [ ] `validateUrlSafety()` — 3-layer SSRF validation with ipaddr.js
- [ ] `extractRunnerContext()` — Safe cf extraction with fallbacks
- [ ] `resolveUrl()` — Relative → absolute URL resolution
- [ ] `classifyFetchError()` — Map fetch errors to stable error codes
- [ ] `filterHeaders()` — Whitelist 6 headers + ac-* prefix with sorted keys
- [ ] `DurationTracker` class — Timeout + duration management

**Code:** ~150 lines
**Tests:** Parallel unit tests as you go (15-20 test cases)

### Phase B3c: Redirect Algorithm (1-2 hours)

**File:** `src/providers/activeProbe.ts` (part 2)

- [ ] `followRedirects()` function with:
  - Manual redirect loop (10 hop max)
  - Visited set for loop detection
  - Location header parsing + relative URL resolution
  - 9s timeout with early-exit checks
  - Comprehensive error handling
  - Duration measurement
  - Returns ProbeSuccess or ProbeFailure

**Code:** ~100-150 lines
**Tests:** Parallel integration tests (6-8 scenarios)

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

### Phase B3e: Comprehensive Test Suite (2 hours)

**File:** `src/analysis/__tests__/activeProbe.test.ts`

**Unit tests (20-25 tests):**
- SSRF validation: accept public, reject localhost variants, reject IP forms (decimal/hex/octal), reject private ranges, reject IPv6 loopback
- URL resolution: relative, absolute, protocol-relative paths
- Error classification: DNS, timeout, TLS, fetch
- Header filtering: whitelist 6 core, capture ac-*, ignore sensitive, sorted output
- Duration tracking: time measurement, timeout enforcement

**Integration tests (10-15 tests):**
- Single response (no redirects)
- Redirect chain (2-3 hops)
- Redirect loops
- Missing Location header
- Invalid URLs
- Timeouts (AbortController fires at 9s)
- DNS failures
- TLS errors
- SSRF rejection
- Header filtering

**Determinism tests (3-5 tests):**
- Same input produces identical JSON
- Multiple runs byte-identical
- Sorted headers every time

**Code:** ~300-350 lines

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

### Phase B3g: Manual Testing (1 hour)

- [ ] Test against real public URLs (example.com, api.github.com)
- [ ] Test redirect chains (verify chain captured correctly)
- [ ] Test error cases (unreachable domain, timeout, SSRF block)
- [ ] Check duration accuracy (simple request < 100ms, 3-hop redirect < 2s)
- [ ] Verify header filtering (only 6 core + ac-* captured)
- [ ] Test local dev with wrangler dev (cf fallback behavior)

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
shared/signal.ts          ← SignalEnvelope schema
CLAUDE.md                 ← System rules (§3.1, §5.1, §5.2)
PHASE_B3_DESIGN.md        ← Full architecture
PHASE_B3_CRITIQUE_REFINEMENT.md ← Production hardening details
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
- [ ] `src/providers/activeProbe.ts` fully implemented
- [ ] Test file created with 45-50 passing tests
- [ ] Temporary `/api/probe` endpoint works

✅ **All Tests Pass:**
- [ ] `npm test` shows 350+ tests passing
- [ ] No warnings or errors
- [ ] Coverage > 85% for activeProbe.ts

✅ **Design Contracts Met:**
- [ ] Output is always SignalEnvelope (never throws)
- [ ] Deterministic output (byte-identical JSON for same input)
- [ ] SSRF validation blocks private IPs
- [ ] Redirect chains captured accurately
- [ ] Timeout at 9s (grace period for wrap-up)
- [ ] Headers sorted for determinism
- [ ] Context extracted with fallbacks

✅ **Manual Testing Passed:**
- [ ] `/api/probe?url=https://example.com` works
- [ ] Redirect chains visible in output
- [ ] Error cases handled gracefully
- [ ] Local dev (wrangler dev) doesn't crash on missing cf

✅ **Documentation:**
- [ ] Code comments explain redirect algorithm
- [ ] Error codes documented
- [ ] Function signatures clear
- [ ] Examples shown for each error case

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

| Section | Time | Lines |
|---------|------|-------|
| B3a: Types | 0.5h | 75 |
| B3b: Utilities | 1h | 150 |
| B3c: Redirect Algorithm | 1.5h | 150 |
| B3d: Orchestrator | 0.5h | 50 |
| B3e: Test Suite | 2h | 350 |
| B3f: Test Endpoint | 0.5h | 50 |
| B3g: Manual Testing | 1h | 0 |
| **Total** | **7h** | **825** |

**Realistic:** 8-10 hours (includes debugging, edge cases, polishing)

---

## Questions to Clarify Before Starting

1. **ipaddr.js dependency:** OK to add? (6KB, well-maintained, no security issues)
2. **Error codes:** Should custom codes (as shown) or map to HTTP status codes?
3. **Probe ID assignment:** Should provider generate ID or caller?
   - **Current design:** Caller generates (Workflow assigns `${comparisonId}:${side}`)
4. **Temporary test endpoint:** Remove after Phase B3 or keep for debugging?
5. **Local dev fallback:** Is `colo: "LOCAL"` acceptable or should be `colo: "DEVELOPMENT"`?

---

## Ready to Start?

✅ **You have:**
- Complete design architecture (PHASE_B3_DESIGN.md)
- Production hardening critiques (PHASE_B3_CRITIQUE_REFINEMENT.md)
- This action plan with code patterns
- Clear success criteria
- Estimated effort (7-10 hours)

✅ **Next step:** Start with Phase B3a (types.ts), then B3b (utilities), then B3c (redirect algorithm)

**All files should be implemented sequentially with tests as you go.**

---

**Document Version:** 1.0 (Action-Ready)
**Status:** Ready for Development
**Created:** 2026-01-13
