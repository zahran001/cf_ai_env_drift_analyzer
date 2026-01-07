# Phase B2 — Final Summary & MVP-First Approach

**Status:** ✅ **READY FOR IMPLEMENTATION**
**Date:** 2026-01-07
**Your Decision:** CF Context Drift → Soft Correlation (Option B) ✅ RESOLVED

---

## 📍 Document Organization

### Where Are Design Decisions Documented?

**NOT in Phase-B2.md** (by design) — Phase-B2.md is the **authoritative rulebook**, not a design journal.

**Instead, design decisions are in separate, dedicated documents:**

| Document | Purpose | Location |
|----------|---------|----------|
| **Phase-B2.md** | Authoritative rules (14 rule groups, constants, evidence vocab) | Phase-B2-Docs/ |
| **PHASE_B2_DESIGN_DECISIONS.md** | WHY each decision was made (15 decisions with rationale + code) | Phase-B2-Docs/ |
| **PHASE_B2_IMPLEMENTATION_ROADMAP.md** | HOW to implement (ordered steps, dependencies, timeline) | Phase-B2-Docs/ |
| **PHASE_B2_QUICK_REFERENCE.md** | WHAT to reference while coding (1-page card) | Phase-B2-Docs/ |
| **PHASE_B2_OPEN_DECISION.md** | Decision history (options preserved with strike-throughs) | Phase-B2-Docs/ |
| **DECISION_LOG.md** | Decision journal (formal record of choice + rationale) | Phase-B2-Docs/ |

### Why This Structure?

Phase-B2.md must remain **clean and authoritative**. It's the contract.

Design decisions belong in separate docs so you can:
- See the reasoning (PHASE_B2_DESIGN_DECISIONS.md)
- Review alternatives (PHASE_B2_OPEN_DECISION.md)
- Follow implementation order (PHASE_B2_IMPLEMENTATION_ROADMAP.md)
- Quick-lookup while coding (PHASE_B2_QUICK_REFERENCE.md)

---

## 🚀 MVP-First Approach (Recommended)

### What This Means

**MVP = Minimal Viable Phase B2:** Implement only the critical path to get deterministic diff working. Skip fancy optimizations.

### Critical Path (Must Have)

```
Input: Two SignalEnvelopes
  ↓
1. Compile ProbeOutcomeDiff       (Rule A: probe success/failure)
2. Extract structural diffs        (Status, URL, headers, timing, etc.)
3. Emit findings in strict order   (Phase-B2.md §5: A1→A2→B1...→G1)
4. Deduplicate findings            (By code, section, sorted keys)
5. Sort findings                   (By severity, code, message)
6. Compute maxSeverity
  ↓
Output: EnvDiff with deterministic findings[]
```

### Non-Critical (Phase 2+)

- ~~Rich UI integration hints~~ (findings are just JSON)
- ~~Configurable constants~~ (hardcoded per Phase-B2.md)
- ~~Multiple LLM explanations~~ (Phase B5, not B2)
- ~~Caching or optimization~~ (Determinism > Speed)
- ~~Historical analysis~~ (Findings are stateless)

### MVP Utilities (9 Total)

| # | Module | Lines | Time | Type |
|---|--------|-------|------|------|
| 1 | probeUtils.ts | ~30 | 0.5h | 🔴 Must Have |
| 2 | classifiers.ts | ~40 | 0.25h | 🔴 Must Have |
| 3 | urlUtils.ts | ~50 | 0.5h | 🔴 Must Have |
| 4 | headerDiff.ts | ~100 | 1h | 🔴 Must Have |
| 5 | contentUtils.ts | ~60 | 0.5h | 🔴 Must Have |
| 6 | redirectUtils.ts | ~60 | 0.5h | 🔴 Must Have |
| 7 | cacheUtils.ts | ~40 | 0.25h | 🟡 Nice to Have |
| 8 | validators.ts | ~50 | 0.5h | 🟡 Nice to Have (but needed for tests) |
| 9 | constants.ts | ~30 | 0.25h | 🟡 Nice to Have |
| — | classify.ts | ~300 | 2–3h | 🔴 Must Have |
| — | Tests | ~400 | 2–3h | 🔴 Must Have |
| — | **Total** | ~1100 | **9–13h** | |

---

## ✅ Your Decision (CF Context Drift)

**You Chose:** Soft Correlation (Option B)

**What This Means:**
```typescript
// In Rule F1 (CF Context Drift)
if (cfContextDiffers) {
  severity = hasTimingDrift ? "warn" : "info";
}
// Always emit CF_CONTEXT_DRIFT, but severity depends on timing
```

**Why:**
- Infrastructure visibility: Users see colo/ASN changes
- Actionable severity: Indicates performance impact
- Flexible: Can refine in Phase 2 if needed

**Documented in:**
- Phase-B2.md §4.F1 (updated)
- DECISION_LOG.md (formal record)
- PHASE_B2_OPEN_DECISION.md (full decision context)

---

## 🎯 Quick Start (MVP-First)

### Step 1: Understand the Vocabulary (5 min)
```bash
cat Phase-B2-Docs/PHASE_B2_QUICK_REFERENCE.md
```
Learn: 13 finding codes, evidence vocabulary, constants.

### Step 2: Create Directory Structure (2 min)
```bash
mkdir -p src/analysis/__tests__
touch src/analysis/{probeUtils,classifiers,urlUtils,headerDiff,contentUtils,redirectUtils,cacheUtils,validators,constants,classify}.ts
```

### Step 3: Start with probeUtils.ts (30 min)
**Why first?** No dependencies, simplest logic.

Reference:
- Phase-B2.md §4.A (Rule A1/A2)
- PHASE_B2_DESIGN_DECISIONS.md #13
- PHASE_B2_QUICK_REFERENCE.md (ProbeOutcomeDiff structure)

Implementation:
```typescript
// src/analysis/probeUtils.ts
import type { SignalEnvelope, ProbeOutcomeDiff } from "../../shared/diff";

export function compileProbeOutcomeDiff(
  leftEnvelope: SignalEnvelope,
  rightEnvelope: SignalEnvelope
): ProbeOutcomeDiff {
  const leftOk = leftEnvelope.result.ok;
  const rightOk = rightEnvelope.result.ok;

  return {
    leftOk,
    rightOk,
    leftErrorCode: !leftOk ? (leftEnvelope.result as any).error?.code : undefined,
    rightErrorCode: !rightOk ? (rightEnvelope.result as any).error?.code : undefined,
    outcomeChanged: leftOk !== rightOk,
  };
}
```

### Step 4: Write Tests (30 min)
```typescript
// src/analysis/__tests__/probeUtils.test.ts
import { compileProbeOutcomeDiff } from "../probeUtils";

describe("probeUtils", () => {
  it("A1: Both probes failed", () => {
    const left = { result: { ok: false, error: { code: "timeout" } } };
    const right = { result: { ok: false, error: { code: "dns" } } };
    const diff = compileProbeOutcomeDiff(left, right);
    expect(diff).toEqual({
      leftOk: false,
      rightOk: false,
      leftErrorCode: "timeout",
      rightErrorCode: "dns",
      outcomeChanged: false,
    });
  });

  it("A2: One probe failed", () => {
    const left = { result: { ok: true, ... } };
    const right = { result: { ok: false, error: { code: "timeout" } } };
    const diff = compileProbeOutcomeDiff(left, right);
    expect(diff.outcomeChanged).toBe(true);
  });
});
```

### Step 5: Iterate Through Utilities (4–6 hours)
Build in order:
1. probeUtils.ts ✓
2. classifiers.ts
3. urlUtils.ts
4. headerDiff.ts
5. contentUtils.ts
6. redirectUtils.ts
7. (optional) cacheUtils.ts, validators.ts, constants.ts

**MVP rule:** Implement only what's needed for the 14 rule groups. Skip perfection.

### Step 6: Implement classify.ts (2–3 hours)
Orchestrate all utilities following Phase-B2.md §5 rule order:

```typescript
// src/analysis/classify.ts
import type { SignalEnvelope, EnvDiff, DiffFinding } from "../../shared/diff";
import { compileProbeOutcomeDiff } from "./probeUtils";
import { classifyStatusDrift } from "./classifiers";
import { classifyUrlDrift } from "./urlUtils";
// ... import all utilities

export function computeEnvDiff(
  left: SignalEnvelope,
  right: SignalEnvelope
): EnvDiff {
  const findings: DiffFinding[] = [];

  // Rule A1/A2: Probe outcomes
  const probeDiff = compileProbeOutcomeDiff(left, right);
  if (!probeDiff.leftOk && !probeDiff.rightOk) {
    findings.push({
      id: "PROBE_FAILURE:probe:",
      code: "PROBE_FAILURE",
      category: "unknown",
      severity: "critical",
      message: "Both probes failed",
      evidence: [{ section: "probe" }],
    });
  } else if (probeDiff.outcomeChanged) {
    findings.push({
      id: `PROBE_FAILURE:probe:${probeDiff.leftOk ? "right" : "left"}`,
      code: "PROBE_FAILURE",
      category: "unknown",
      severity: "critical",
      message: `${probeDiff.leftOk ? "Right" : "Left"} probe failed`,
      evidence: [{ section: "probe", keys: [probeDiff.leftOk ? "right" : "left"] }],
    });
  }

  // Rule B1: Status mismatch
  if (left.result.ok && right.result.ok) {
    const leftStatus = (left.result as any).response.status;
    const rightStatus = (right.result as any).response.status;
    if (leftStatus !== rightStatus) {
      const severity = classifyStatusDrift(leftStatus, rightStatus);
      findings.push({
        id: `STATUS_MISMATCH:status:`,
        code: "STATUS_MISMATCH",
        category: "routing",
        severity,
        message: `Status: ${leftStatus} vs ${rightStatus}`,
        evidence: [{ section: "status" }],
        left_value: leftStatus,
        right_value: rightStatus,
      });
    }
  }

  // ... Continue for all 14 rule groups (B2, B3, C1, C2, D1–D5, E1, F1, G1)

  // Deduplicate + Sort + Compute maxSeverity
  const uniqueFindings = deduplicateFindings(findings);
  const sortedFindings = sortFindings(uniqueFindings);
  const maxSeverity = computeMaxSeverity(sortedFindings);

  return {
    schemaVersion: DIFF_SCHEMA_VERSION,
    comparisonId: /* from context */,
    leftProbeId: /* from context */,
    rightProbeId: /* from context */,
    probe: probeDiff,
    findings: sortedFindings,
    maxSeverity,
  };
}
```

### Step 7: Write Integration Tests (2–3 hours)
Snapshot tests matching Phase-B2.md examples:

```typescript
// src/analysis/__tests__/classify.test.ts
describe("Phase B2 Integration — All 14 Rules", () => {
  test("Rule A1: Both probes failed", () => { /* ... */ });
  test("Rule A2: One probe failed", () => { /* ... */ });
  test("Rule B1: Status mismatch critical", () => { /* ... */ });
  test("Rule B1: Status mismatch warn", () => { /* ... */ });
  test("Rule B2: URL scheme differs", () => { /* ... */ });
  // ... 14 tests total
});
```

---

## 📊 MVP Success Criteria

✅ Before you call Phase B2 done:

- [ ] All 9 utility modules implemented
- [ ] `computeEnvDiff()` orchestrates all 14 rules in Phase-B2.md §5 order
- [ ] Unit tests pass for each utility
- [ ] Integration tests pass (all 14 rules)
- [ ] Output matches Phase-B2.md examples byte-for-byte
- [ ] Evidence keys validated (Phase-B2.md §1.3)
- [ ] Findings sorted by (severity, code, message)
- [ ] maxSeverity computed correctly
- [ ] No timestamps or randomness in diff engine
- [ ] Code review checklist complete (CLAUDE.md §15)

**No more, no less.** Phase B2 done = deterministic diff engine ready.

---

## 📚 Reference Stack (Keep These Open While Coding)

### Tab 1: Authoritative Rules
**Phase-B2.md** — Reference while implementing each rule. Keep this open at all times.

### Tab 2: Quick Lookup
**PHASE_B2_QUICK_REFERENCE.md** — Constants, evidence vocab, finding codes. Lookup during implementation.

### Tab 3: Implementation Order
**PHASE_B2_IMPLEMENTATION_ROADMAP.md** — Which utility to build next.

### Tab 4: Implementation Examples
**PHASE_B2_DESIGN_DECISIONS.md** — Code examples for complex rules (e.g., header diff, redirect chain).

### If You Get Stuck
→ PHASE_B2_QUICK_REFERENCE.md (answers 90% of questions)
→ Phase-B2.md (authoritative)
→ PHASE_B2_DESIGN_DECISIONS.md (code examples)

---

## 🎯 Implementation Order (For MVP)

### 🔴 Critical Path (Do These First)
1. ✓ probeUtils.ts — Convert envelopes → ProbeOutcomeDiff
2. classifiers.ts — Status code severity logic
3. urlUtils.ts — URL parsing & drift classification
4. headerDiff.ts — Normalize headers, compute diffs
5. contentUtils.ts — Content-type normalization, length thresholds
6. redirectUtils.ts — Compare redirect chains
7. (shared/diff.ts helpers) — Dedup key, sorting, constants
8. classify.ts — Orchestrate all utilities into 14 rules

### 🟡 Nice-to-Have (Do After Critical Path)
- cacheUtils.ts — Cache-control keyword detection
- validators.ts — Evidence key validation (helps with testing)
- constants.ts — Centralize timing thresholds

### Tests (In Parallel)
- Unit tests for each utility (as you build them)
- Integration tests for classify.ts (after all utilities done)

---

## ❌ What NOT to Do (MVP Anti-Patterns)

**Don't:**
- ❌ Add UI integration code (Phase B7+)
- ❌ Cache results (determinism > speed)
- ❌ Add configurable thresholds (hardcode per Phase-B2.md)
- ❌ Implement LLM explanation (Phase B5)
- ❌ Add historical context (Phase B4)
- ❌ Build async/concurrent logic (sync MVP)
- ❌ Add retry/error recovery (fail fast)
- ❌ Optimize for performance (correctness first)

**Do:**
- ✅ Follow Phase-B2.md §5 rule order exactly
- ✅ Write deterministic, testable functions
- ✅ Snapshot tests everything
- ✅ Keep it simple and stupid
- ✅ Finish utilities before classify.ts

---

## 🚦 Status Check

| Item | Status |
|------|--------|
| CF Context decision | ✅ RESOLVED (Soft Correlation) |
| Phase-B2.md (rulebook) | ✅ FINAL |
| Design decisions (15 total) | ✅ DOCUMENTED |
| Implementation roadmap | ✅ READY |
| Code contracts (shared/) | ✅ LOCKED |
| Directory structure | ⏳ TO CREATE |
| Utilities (9 modules) | ⏳ TO IMPLEMENT |
| classify.ts | ⏳ TO IMPLEMENT |
| Tests | ⏳ TO IMPLEMENT |

---

## 🚀 Next Action

**RIGHT NOW:**

1. Open Phase-B2-Docs/PHASE_B2_QUICK_REFERENCE.md in one browser tab
2. Open Phase-B2-Docs/Phase-B2.md in another tab
3. Create src/analysis/ directory and stubs
4. Start with probeUtils.ts

**IN 30 MINUTES:**
You'll have your first working utility with tests.

**IN 9–13 HOURS:**
Phase B2 is done. Deterministic diff engine ready for Phase B3.

---

**You are ready. Start coding. No more decisions needed.**
