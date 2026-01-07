# Phase B2 Implementation Readiness Checklist

**Status:** ✅ **READY FOR IMPLEMENTATION**  
**Date:** 2026-01-07

---

## 🔴 Blocking Decisions

### CF Context Drift Correlation
- **Status:** ✅ **RESOLVED**
- **Decision:** Soft Correlation (Option B)
- **When to use:** Rule F1 (CF_CONTEXT_DRIFT) implementation
- **Implementation:** Always emit CF_CONTEXT_DRIFT; severity = `warn` if TIMING_DRIFT present, `info` otherwise
- **Documented in:**
  - PHASE_B2_OPEN_DECISION.md — Full decision context
  - Phase-B2.md §4.F1 — Updated rule specification
  - DECISION_LOG.md — Decision journal entry

✅ **No blocking decisions remain.** Implementation can proceed.

---

## 📋 Phase B2 Documentation Status

### Authoritative Specs (All Complete)
- ✅ **Phase-B2.md** — 306 lines, 14 rule groups, complete rulebook
- ✅ **shared/diff.ts** — 269 lines, all TypeScript contracts defined
- ✅ **CLAUDE.md** — System constraints, idempotency rules

### Design & Planning (All Complete)
- ✅ **PHASE_B2_DESIGN_DECISIONS.md** — 15 design decisions with code examples (Issue #15 resolved)
- ✅ **PHASE_B2_IMPLEMENTATION_ROADMAP.md** — Ordered steps, blocking dependencies, timeline
- ✅ **PHASE_B2_QUICK_REFERENCE.md** — One-page quick lookup (updated with decision)
- ✅ **README_PHASE_B2.md** — Overview and immediate next steps (updated with decision)
- ✅ **DECISION_LOG.md** — Decision journal (new)
- ✅ **PHASE_B2_OPEN_DECISION.md** — Full decision context with struck-through alternatives

---

## 📦 Codebase Prerequisites

### Already In Place ✅
- ✅ `shared/signal.ts` — SignalEnvelope contract locked (versions B0–B3)
- ✅ `shared/diff.ts` — EnvDiff, DiffFinding, ProbeOutcomeDiff contracts
- ✅ `shared/api.ts` — API DTOs

### Needs Creation (Phase B2 Implementation)
- ⏳ `src/analysis/` — 9 utility modules + classify.ts (all stubs exist)
- ⏳ `shared/diff.ts` — Add helper functions (dedup key, ID computation, sorting)

---

## 🔧 Implementation Prerequisites Checklist

### Pre-Implementation Setup
- [ ] Create `src/analysis/` module directory structure
  - [ ] probeUtils.ts
  - [ ] urlUtils.ts
  - [ ] classifiers.ts
  - [ ] headerDiff.ts
  - [ ] contentUtils.ts
  - [ ] redirectUtils.ts
  - [ ] cacheUtils.ts
  - [ ] validators.ts
  - [ ] constants.ts
  - [ ] classify.ts
  - [ ] __tests__/ directory

- [ ] Add helpers to `shared/diff.ts`
  - [ ] `computeFindingDeduplicateKey(code, section, keys): string`
  - [ ] `computeFindingId(code, evidence): string`
  - [ ] `sortFindings(findings): DiffFinding[]`
  - [ ] `SEVERITY_ORDER` constant
  - [ ] `TIMING_DRIFT_THRESHOLDS` constant

### Testing Setup
- [ ] Jest or Vitest configured for `src/analysis/` tests
- [ ] Snapshot testing capability enabled
- [ ] Test fixtures defined for Phase-B2.md examples

---

## ✅ Ready-to-Implement Tasks

### Phase B2 Utility Modules (Build Order)

| # | Module | Status | Priority | Est. Time |
|---|--------|--------|----------|-----------|
| 1 | probeUtils.ts | ⏳ Stub | 🔴 High | 0.5h |
| 2 | urlUtils.ts | ⏳ Stub | 🔴 High | 0.5h |
| 3 | classifiers.ts | ⏳ Stub | 🔴 High | 0.25h |
| 4 | headerDiff.ts | ⏳ Stub | 🔴 High | 1h |
| 5 | contentUtils.ts | ⏳ Stub | 🔴 High | 0.5h |
| 6 | redirectUtils.ts | ⏳ Stub | 🔴 High | 0.5h |
| 7 | cacheUtils.ts | ⏳ Stub | 🟡 Medium | 0.25h |
| 8 | validators.ts | ⏳ Stub | 🟡 Medium | 0.5h |
| 9 | constants.ts | ⏳ Stub | 🟡 Medium | 0.25h |
| — | shared/diff.ts helpers | — | 🟡 Medium | 0.5h |
| — | classify.ts | ⏳ Stub | 🔴 High | 2–3h |
| — | Unit tests | — | 🟡 Medium | 2–3h |

**Total Estimate:** 9–13 hours

---

## 🎯 Success Criteria

Before Phase B2 is marked complete:

- [ ] All 9 utility modules implemented (>1100 LOC)
- [ ] All 14 rule groups implemented in classify.ts
- [ ] Unit tests pass for each utility
- [ ] Integration tests pass (all 14 rule groups tested)
- [ ] Output matches Phase-B2.md examples byte-for-byte
- [ ] Evidence keys validated per Phase-B2.md §1.3
- [ ] Findings deduplicated by (code, section, sorted keys)
- [ ] Findings sorted by (severity, code, message)
- [ ] maxSeverity correctly computed
- [ ] No timestamps, randomness, or LLM calls in diff engine
- [ ] Code review checklist complete (CLAUDE.md §15)

---

## 🚀 How to Start

**Step 1:** Review quick reference
```bash
cat PHASE_B2_QUICK_REFERENCE.md
```

**Step 2:** Create src/analysis/ structure
```bash
mkdir -p src/analysis/__tests__
touch src/analysis/{probeUtils,urlUtils,classifiers,headerDiff,contentUtils,redirectUtils,cacheUtils,validators,constants,classify}.ts
```

**Step 3:** Start with first utility (probeUtils.ts)
- Reference: PHASE_B2_DESIGN_DECISIONS.md #13
- Rule: Phase-B2.md §4.A (Probe Outcome Rules)

**Step 4:** Write tests in parallel
- Reference: PHASE_B2_IMPLEMENTATION_ROADMAP.md (Testing Strategy)
- Use snapshot tests matching Phase-B2.md examples

**Step 5:** Implement utilities in dependency order
- Order: PHASE_B2_IMPLEMENTATION_ROADMAP.md
- Follow: Phase-B2.md rule groups strictly

**Step 6:** Implement classify.ts last
- Orchestrate: All utilities in Phase-B2.md §5 order
- Deduplicate, sort, compute maxSeverity
- Test: Integration tests with all 14 rule groups

---

## 📚 Reference Documents

### For Understanding WHY
- **PHASE_B2_DESIGN_DECISIONS.md** — 15 design decisions with rationale

### For Implementing WHAT
- **Phase-B2.md** — Authoritative rules (keep open while coding)
- **PHASE_B2_QUICK_REFERENCE.md** — One-page lookup card

### For Knowing HOW
- **PHASE_B2_IMPLEMENTATION_ROADMAP.md** — Step-by-step ordered tasks

### For Decision Context
- **PHASE_B2_OPEN_DECISION.md** — Full decision history (struck-through alternatives)
- **DECISION_LOG.md** — Decision journal entry

---

## 🟢 Status Summary

| Aspect | Status |
|--------|--------|
| **Blocking Decisions** | ✅ All resolved (CF context drift → Soft Correlation) |
| **Authoritative Specs** | ✅ Complete (Phase-B2.md, shared/diff.ts, CLAUDE.md) |
| **Design Decisions** | ✅ All 15 documented |
| **Implementation Plan** | ✅ Ready (ordered roadmap) |
| **Code Prerequisites** | ✅ Contracts defined |
| **Ready to Code** | 🟢 **YES** |

---

**YOU ARE READY TO IMPLEMENT PHASE B2.**

Start with probeUtils.ts. Follow Phase-B2.md §5 rule generation order. Write tests alongside implementation.

