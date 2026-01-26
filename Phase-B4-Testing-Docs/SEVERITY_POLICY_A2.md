# SEVERITY_POLICY_A2.md - Minimal Severity Policy for URL Drift

**Issue:** Fix A2 - Deterministic and Non-Opinionated Severity Assignment

**Status:** Implementation in progress

**Related:** [HTTP_VS_NETWORK_FAILURES_CHANGES.md](HTTP_VS_NETWORK_FAILURES_CHANGES.md), [CLAUDE.md](CLAUDE.md) §1.2

---

## Overview

The MVP severity assignment policy has been refined to be **minimal, deterministic, and non-opinionated** about environmental differences. Rather than flagging all scheme mismatches as critical, the new policy recognizes that some URL component differences are more significant than others.

**Example:** `http://example.com/` vs `https://example.com/` is now **info** (not critical), as this represents a benign protocol upgrade rather than a breaking change.

---

## Problem Statement

### Old Policy (Aggressive)
- Any scheme difference → **critical**
- Any host difference → **critical**
- Path/query difference → **warn**

**Issue:** Treating HTTP→HTTPS as "critical" is too aggressive for MVP. Many real-world applications auto-redirect HTTP to HTTPS, which is:
- Expected behavior (not a drift)
- Non-breaking (clients follow redirects)
- Infrastructure standard (TLS enforcement)

### New Policy (Minimal)
- Scheme-only difference → **info**
- Host difference → **critical** (unchanged; this IS a real infrastructure difference)
- Path/query difference → **warn** (unchanged)

---

## New Policy: Minimal Severity Rules

Severity assignment is based on **which URL components differ**, not assumptions about correctness:

| Diff Components | Severity | Rationale |
|:---------------:|:--------:|-----------|
| **No differences** | `info` | URLs are identical; no finding generated |
| **Only scheme** (e.g., http vs https) | `info` | Often benign: protocol upgrade, TLS enforcement, load balancer redirect |
| **Host differs** (with or without others) | `critical` | Different server/service; fundamental infrastructure change |
| **Only path** (e.g., /a vs /b) | `warn` | Same destination, different resource; moderate change |
| **Only query** (e.g., ?x=1 vs ?x=2) | `warn` | Same resource, different parameters; moderate change |
| **Scheme + path** (e.g., http://x.com/a vs https://x.com/b) | `warn` | Both components changed, but not host; medium severity |
| **Scheme + query** | `warn` | Both components changed, but not host; medium severity |
| **Path + query** | `warn` | Both path and query changed; medium severity |

### Severity Type Mapping

- `info` = Low severity (minimal impact, informational)
- `warn` = Medium severity (significant change, worth investigating)
- `critical` = High severity (breaking change, immediate attention needed)

---

## Rationale: MVP Neutrality

### Non-Opinionated Design
The system does **not** assume one environment is "correct" or "canonical". Instead:
- **Both environments are equal** — we observe differences, not deviations
- **Severity reflects impact**, not preference — host change = more impact than scheme change
- **No baseline** — no "expected" state to compare against

### Scheme-Only Downgrade
Downgrading scheme-only differences from critical → info reflects:

1. **Real-world patterns**: HTTP→HTTPS redirection is standard practice
2. **Non-breaking behavior**: Clients follow 301/302/307/308 redirects automatically
3. **Infrastructure practices**: TLS enforcement is recommended (not exceptional)
4. **Protocol safety**: HTTPS is a strict upgrade from HTTP, not a breaking change

### Host Remains Critical
Host differences remain critical because:
- **Different infrastructure**: Different hostname = different server/service
- **Functional impact**: URL changes affect routing, DNS, certificates, etc.
- **Not automatic recovery**: Clients don't auto-redirect to different hosts

---

## Implementation

### Location
**File:** [src/analysis/urlUtils.ts](src/analysis/urlUtils.ts)

**Function:** `classifyUrlDrift(left?: string, right?: string): UrlDriftResult`

**Lines modified:** 48-54 (the severity assignment logic)

### Code Change

**Before:**
```typescript
const severity =
  diffTypes.includes("scheme") || diffTypes.includes("host")
    ? "critical"
    : diffTypes.length > 0
    ? "warn"
    : "info";
```

**After:**
```typescript
let severity: Severity;

if (diffTypes.length === 0) {
  // No differences
  severity = "info";
} else if (diffTypes.includes("host")) {
  // Host differs → different server/service (critical)
  severity = "critical";
} else if (diffTypes.includes("scheme") && diffTypes.length === 1) {
  // ONLY scheme differs → often benign (HTTP→HTTPS redirect)
  severity = "info";
} else if (diffTypes.includes("path") || diffTypes.includes("query")) {
  // Path/query differs (not host) → same destination, different resource
  severity = "warn";
} else {
  // Fallback for edge cases (e.g., scheme + path/query but not host)
  severity = "warn";
}
```

### Logic Flow
1. **No diffs**: Return `info` (no finding generated since `changed: false`)
2. **Host differs**: Return `critical` (immediately, regardless of other components)
3. **Only scheme differs**: Return `info` (benign protocol upgrade)
4. **Path or query differs** (without host): Return `warn` (significant but non-breaking)
5. **Fallback** (scheme + path/query but not host): Return `warn` (safety default)

---

## Integration Points

### Affected Code Paths
1. **Diff Generation**: [src/analysis/diff.ts](src/analysis/diff.ts) line 77-80
   - Detects `finalUrl.changed`
   - Calls `classifyUrlDrift()` to determine severity
2. **Finding Classification**: [src/analysis/classify.ts](src/analysis/classify.ts) line 275-291
   - Creates `FINAL_URL_MISMATCH` finding with severity from urlUtils
3. **Max Severity Calculation**: [shared/diff.ts](shared/diff.ts) line 376-388
   - Computes overall diff severity from all findings
   - No changes needed (logic unchanged, just different input values)

### No Changes Needed
- **LLM explanation**: Reads severity as-is; no prompt changes required
- **Frontend rendering**: Displays severity badges normally
- **Schema version**: No bump needed (same severity type: info/warn/critical)

---

## Test Coverage

### Unit Tests
**File:** [src/analysis/__tests__/urlUtils.test.ts](src/analysis/__tests__/urlUtils.test.ts)

**Updated tests:**
- Line 69-76: Scheme differs → expect `info` (was `critical`)
- Line 126-133: Scheme differs (host same) → expect `info` (was `critical`)

**New tests:**
- Scheme + path differs → expect `warn`
- Scheme + query differs → expect `warn`

**Unchanged tests** (still pass):
- Host differs → expect `critical`
- Path-only differs → expect `warn`
- Query-only differs → expect `warn`
- No differences → expect `info`

### Integration Tests
**File:** [src/analysis/__tests__/classify.test.ts](src/analysis/__tests__/classify.test.ts)

**Verify:**
- `FINAL_URL_MISMATCH` finding has correct severity per new rules
- `maxSeverity` reflects the updated finding severities

---

## Compatibility & Risk Assessment

### Low Risk
- **Detection logic unchanged**: `diffTypes` array still captures all component differences
- **Finding structure unchanged**: `id`, `code`, `evidence`, `left_value`, `right_value` unaffected
- **Deterministic output**: Same inputs → same output (verified by tests)
- **No schema changes**: Severity values remain {info, warn, critical}

### No Breaking Changes
- **Backward compatible**: Old severity assignments were overly conservative
  - Lowering severity is not a breaking change (info is less alarming than critical)
- **LLM input unchanged**: Reads severity field normally
- **Frontend rendering unchanged**: Uses existing severity badge styles
- **DO storage unchanged**: No migration needed

### CLAUDE.md Compliance
✅ **§1.2 EnvDiff deterministic**: Severity computation is deterministic (same inputs → same output)
✅ **§3.2 Diff Engine pure function**: No randomness, no external state
✅ **§2.2 No AI involvement**: Severity assignment is rule-based, not LLM-generated
✅ **§5.1 Deterministic finding generation**: Findings conform to DiffFinding schema

---

## Test Verification

### Run Tests
```bash
# Unit tests for URL drift classification
npm test -- src/analysis/__tests__/urlUtils.test.ts

# Integration tests for finding generation
npm test -- src/analysis/__tests__/classify.test.ts

# Full test suite
npm test
```

### Expected Results
```
✅ urlUtils.test.ts
  - Scheme-only difference → info
  - Scheme + path difference → warn
  - Scheme + query difference → warn
  - Host difference → critical
  - Path-only difference → warn
  - Query-only difference → warn
  - No differences → info

✅ classify.test.ts
  - FINAL_URL_MISMATCH severity matches new rules
  - maxSeverity computed correctly from findings

✅ All analysis tests pass
```

### Manual E2E Test
```bash
# Start backend
npm run dev

# In another terminal, trigger comparison
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{"leftUrl": "http://example.com", "rightUrl": "https://example.com"}'

# Copy comparisonId from response, poll for result
curl http://localhost:8787/api/compare/{comparisonId}
```

**Expected response:**
```json
{
  "status": "completed",
  "result": {
    "diff": {
      "findings": [
        {
          "code": "FINAL_URL_MISMATCH",
          "category": "routing",
          "severity": "info",           // ← Changed from "critical"
          "evidence": [{"section": "finalUrl", "keys": ["scheme"]}],
          "left_value": "http://example.com/",
          "right_value": "https://example.com/"
        }
      ],
      "maxSeverity": "info"             // ← Changed from "critical"
    }
  }
}
```

---

## Migration & Rollout

### No Migration Required
- No database changes
- No schema version bump
- No data re-processing needed
- Severity recalculation happens on next comparison run

### For Existing Data
- Old comparisons remain unchanged in DO storage
- New comparisons use updated severity rules
- Frontend can display both old and new comparisons normally (same rendering logic)

---

## Related Issues & PRs

- **HTTP vs Network Failures** ([HTTP_VS_NETWORK_FAILURES_CHANGES.md](HTTP_VS_NETWORK_FAILURES_CHANGES.md)): Distinguishes HTTP errors (4xx/5xx) from network failures (DNS/timeout)
- **CLAUDE.md §1.2**: EnvDiff deterministic output contract

---

## Questions & Discussion

### Q: Why not make scheme → critical if it's with host change?
**A:** Host change already makes it critical. Scheme doesn't add additional breaking-ness. Rule: highest component severity wins.

### Q: What about case-sensitivity in hosts?
**A:** Hosts are already normalized to lowercase by `parseUrlComponents()`. Case differences don't occur.

### Q: Should scheme changes ever be critical?
**A:** In the current policy, no. If a future use case requires it, a new rule can be added. MVP focuses on minimal severity.

### Q: Does this affect other finding types?
**A:** No. Only `FINAL_URL_MISMATCH` uses `classifyUrlDrift()`. Other findings (STATUS_MISMATCH, headers, redirects) use their own classifiers.

---

## References

- [CLAUDE.md](CLAUDE.md) - System rulebook (§1.2 EnvDiff, §3.2 Diff Engine)
- [HTTP_VS_NETWORK_FAILURES_CHANGES.md](HTTP_VS_NETWORK_FAILURES_CHANGES.md) - Related network failure classification
- [src/analysis/urlUtils.ts](src/analysis/urlUtils.ts) - Implementation
- [src/analysis/__tests__/urlUtils.test.ts](src/analysis/__tests__/urlUtils.test.ts) - Test coverage

---

**Last Updated:** 2026-01-25
**Status:** Ready for implementation
