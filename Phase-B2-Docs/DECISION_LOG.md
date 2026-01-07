# Phase B2 Decision Log

## Decision #1: CF Context Drift Correlation Strategy

**Date:** 2026-01-07  
**Status:** ✅ **RESOLVED**  
**Decision:** Option B — Soft Correlation (Recommended)

### What Was Decided

When CF context (colo/ASN/country) differs between probes:
- **Always emit** a `CF_CONTEXT_DRIFT` finding
- **Severity = `warn`** if timing also drifts
- **Severity = `info`** if timing is unchanged

### Why This Option

1. **Infrastructure Visibility:** Users see when Cloudflare infrastructure changes (colo, ASN), even before they impact performance
2. **Actionable Severity:** The severity level indicates whether the change has a performance impact
3. **Better for Debugging:** Infrastructure engineers can correlate colo changes with other issues
4. **Flexible for MVP:** If feedback shows this is too noisy, can easily switch to hard correlation (Option A) in Phase 2

### Contrast with Alternatives

| Option | Approach | Tradeoff |
|--------|----------|----------|
| **A: Hard Correlation** | Only emit if BOTH CF and timing drift | ~~Cleaner output~~ Misses infrastructure-only changes |
| **B: Soft Correlation** ✅ | Always emit CF, severity depends on timing | More informative, potentially noisier |
| **C: Independent** | Always emit CF with `warn` severity | Too simple, ignores timing correlation entirely |

### Documentation Updated

- ✅ `Phase-B2.md` §4.F1 — Rule specification updated
- ✅ `PHASE_B2_OPEN_DECISION.md` — Full decision context preserved (struck-through alternatives)
- ✅ `PHASE_B2_DESIGN_DECISIONS.md` — Decision marked as resolved
- ✅ `PHASE_B2_IMPLEMENTATION_ROADMAP.md` — Blocking item marked complete

### Implementation Notes for classify.ts

```typescript
// In Rule F1 (CF Context Drift)
const cfContextDifts = /* computed from CF diff */;
const hasTimingDrift = findings.some(f => f.code === "TIMING_DRIFT");

if (cfContextDifts) {
  findings.push({
    code: "CF_CONTEXT_DRIFT",
    category: "platform",
    severity: hasTimingDrift ? "warn" : "info",
    message: `CF context differs (${cfContextDifts.keys.join(", ")})`,
    evidence: [{ section: "cf", keys: ["asn", "colo"] }],
  });
}
```

---

## Next Steps

🟢 **UNBLOCKED:** Phase B2 implementation can now proceed with utilities and classify.ts.

All decisions documented and justified. Ready to start building utility modules.
