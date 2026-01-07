# Phase B2: Open Design Decision

## CF Context Drift Correlation with Timing

**Status:** 🔴 **BLOCKING** — Must resolve before Rule F1 implementation

---

## The Issue

Phase-B2.md §4.F1 states:

> **F1) CF Context Drift → `CF_CONTEXT_DRIFT`**
>
> **Evidence**
>
> ```tsx
> keys: ["asn", "colo"]
> ```
>
> - `warn` **only if correlated with timing drift**

---

## Ambiguity

What does "**only if correlated**" mean?

### Option A: Hard Correlation (Strict)

**Interpretation:** CF_CONTEXT_DRIFT finding ONLY emitted if TIMING_DRIFT is also present.

```typescript
// Pseudocode
if (cfContextDiffers && timingDriftPresent) {
  emitFinding("CF_CONTEXT_DRIFT", "warn");
}
// If cfContextDiffers but NO timingDrift → omit finding entirely
```

**Pros:**
- Cleaner output (no spurious CF drift findings)
- Assumes CF drift is only meaningful if it correlates with performance impact
- Aligns with "correlation = causal relationship"

**Cons:**
- If CF context differs (different Cloudflare colo/country), shouldn't user know, even without timing impact?
- May miss infrastructure changes that don't (yet) impact timing

---

### Option B: Soft Correlation (Lenient)

**Interpretation:** CF_CONTEXT_DRIFT severity/prominence depends on timing drift presence.

```typescript
// Pseudocode
if (cfContextDiffers) {
  if (timingDriftPresent) {
    emitFinding("CF_CONTEXT_DRIFT", "warn");
  } else {
    emitFinding("CF_CONTEXT_DRIFT", "info"); // or omit
  }
}
// Always show CF drift, but severity depends on timing
```

**Pros:**
- User is always informed of CF context changes
- Severity indicates whether there's a performance impact
- More forgiving; doesn't miss infrastructure signals

**Cons:**
- Output can be noisy (CF context drifts often without timing impact)
- More findings to display in UI

---

### Option C: No Correlation (Independent)

**Interpretation:** Ignore Phase-B2.md language; emit CF_CONTEXT_DRIFT whenever CF context differs, severity always `warn`.

```typescript
// Pseudocode
if (cfContextDiffers) {
  emitFinding("CF_CONTEXT_DRIFT", "warn"); // Always
}
```

**Pros:**
- Simplest to implement
- No timing logic coupling

**Cons:**
- Contradicts Phase-B2.md explicitly
- Likely not intended

---

## Context / Why This Matters

**Scenario 1: Colo changes but no timing difference**
- Left: Probed from AUS colo, 200ms response
- Right: Probed from SJC colo, 200ms response
- CF context differs (colo), timing same
  - **Option A:** No finding (drift isn't "real")
  - **Option B:** Finding with `info` severity (FYI: colo changed)
  - **Option C:** Finding with `warn` severity

**Scenario 2: Timing AND colo differ**
- Left: SGP colo, 100ms response
- Right: SJC colo, 500ms response
- Both CF and timing drift
  - **Option A:** Finding emitted (both present)
  - **Option B:** Finding with `warn` severity (correlated)
  - **Option C:** Finding with `warn` severity

---

## Implementation Implications

### Option A: Hard Correlation
```typescript
// In classify.ts
const cfContextDrifts = /* ... compute ... */;
const hasTimingDrift = findings.some(f => f.code === "TIMING_DRIFT");

if (cfContextDrifts && hasTimingDrift) {
  findings.push({
    code: "CF_CONTEXT_DRIFT",
    severity: "warn",
    // ...
  });
}
```

### Option B: Soft Correlation
```typescript
// In classify.ts
const cfContextDrifts = /* ... compute ... */;
const hasTimingDrift = findings.some(f => f.code === "TIMING_DRIFT");

if (cfContextDrifts) {
  findings.push({
    code: "CF_CONTEXT_DRIFT",
    severity: hasTimingDrift ? "warn" : "info", // or omit if "info"
    // ...
  });
}
```

---

## Recommendation for Team

**Go with Option B (Soft Correlation)** for MVP because:

1. **Balanced informativeness:** Users see CF context changes (useful for infra debugging) without being overwhelmed
2. **Reasonable interpretation:** "Correlated" can mean "shown together" rather than "only together"
3. **Easier to upgrade:** If feedback shows CF drift is too noisy, upgrade to Option A later
4. **Testable:** Easier to write deterministic tests (doesn't depend on finding order)

---

## Next Action

**Choose one of A/B/C and add it to Phase-B2.md §4.F1:**

```markdown
### F1) CF Context Drift → `CF_CONTEXT_DRIFT`

**Evidence**

\`\`\`tsx
keys: ["asn", "colo"]
\`\`\`

- Emitted if CF context (colo/asn/country) differs between probes
- Severity: `warn` if correlated with timing drift, `info` otherwise [Option B]
  (or: Only emitted if correlated with timing drift [Option A])
```

Once decided, update `classify.ts` accordingly.
