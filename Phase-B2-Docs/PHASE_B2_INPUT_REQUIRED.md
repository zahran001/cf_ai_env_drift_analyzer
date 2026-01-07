# Phase B2 — Where Your Input is Needed

**Current Date:** 2026-01-07  
**Status:** Review complete. Highlighting all areas requiring your decision/input.

---

## ✅ DECISION ALREADY MADE (No Input Needed)

### CF Context Drift Correlation
**Your Decision:** Soft Correlation (Option B)  
**Status:** ✅ RESOLVED and documented everywhere

- Implementation: Always emit CF_CONTEXT_DRIFT; severity = `warn` if TIMING_DRIFT present, `info` otherwise
- Updated in: Phase-B2.md §4.F1, all Phase-B2 docs
- No further input required

---

## 🔍 AREAS REVIEWED (All Ready)

### 1. Phase-B2.md (Authoritative Rulebook)
- ✅ 14 rule groups fully specified
- ✅ Evidence vocabulary locked (Phase-B2.md §1.3)
- ✅ All constants defined (timing thresholds in §3)
- ✅ Finding generation order specified (§5)
- **Input Required:** NONE — this is authority

### 2. Design Decisions (15 Total)
**Status:** All 15 design decisions documented with code examples
- ✅ Evidence key validation (Decision #1)
- ✅ Deduplication & ID generation (Decision #2)
- ✅ Finding rule registry (Decision #3)
- ✅ Timing drift constants (Decision #4)
- ✅ Status code classification (Decision #5)
- ✅ URL component parsing (Decision #6)
- ✅ Header diff computation (Decision #7)
- ✅ Content-type normalization (Decision #8)
- ✅ Content length classification (Decision #9)
- ✅ Redirect chain comparison (Decision #10)
- ✅ Cache-control keyword detection (Decision #11)
- ✅ Body hash computation (Decision #12)
- ✅ Probe outcome detection (Decision #13)
- ✅ Finding sorting & ordering (Decision #14)
- ✅ CF context correlation (Decision #15) — **YOUR CHOICE: Soft Correlation**

**Input Required:** NONE — all documented with implementation code

### 3. Implementation Roadmap
**Status:** Complete with ordered dependencies
- ✅ Blocking items identified
- ✅ Utility modules in build order (9 modules)
- ✅ classify.ts orchestration strategy
- ✅ Testing strategy with examples
- ✅ Timeline estimate (9–13 hours)
- **Input Required:** NONE — ready to execute

### 4. TypeScript Contracts
**Status:** All locked in shared/
- ✅ `shared/signal.ts` — SignalEnvelope
- ✅ `shared/diff.ts` — EnvDiff, DiffFinding, ProbeOutcomeDiff
- ✅ `shared/api.ts` — API DTOs
- **Input Required:** NONE — contracts frozen

### 5. CLAUDE.md System Rules
**Status:** Complete and enforced
- ✅ No LLM in diff engine (Phase B2 is pure deterministic)
- ✅ Idempotency rules for Workflow steps (Phase B4+)
- ✅ Code review checklist (§15)
- **Input Required:** NONE — system rules apply

---

## ❓ POTENTIAL INPUT AREAS (For Future Phases)

### Phase B2-specific Choices (May Need Clarification Later)

#### 1. Evidence Collection Detail Level
**Question:** How much evidence detail should each finding capture?
- **Current approach:** Minimal evidence (section + keys), one evidence item per finding
- **Could expand:** Multiple evidence items per finding (e.g., "cache-control differs AND vary differs")
- **Status:** Works for MVP, might need discussion post-implementation
- **Input Required Now:** NO — proceed with minimal approach

#### 2. "Catch-all" (UNKNOWN_DRIFT) Behavior
**Question:** Rule G1 (Generic Header Drift) uses "catch-all" for unclassified headers. How should this work?
- **Current approach:** Emit UNKNOWN_DRIFT for header diffs not claimed by earlier rules, severity based on count
- **Status:** Defined in Phase-B2.md §4.G1
- **Input Required Now:** NO — specification is clear

#### 3. Vary Header Handling (Rule D2)
**Question:** Phase-B2.md §4.D2 treats Vary drift as `UNKNOWN_DRIFT` instead of specific code. OK?
- **Current approach:** Yes, Vary drift → UNKNOWN_DRIFT (not a separate code)
- **Status:** Defined in Phase-B2.md §4.D2
- **Input Required Now:** NO — specification is clear

#### 4. Body Hash Algorithm
**Question:** What hash algorithm should SignalEnvelope use for `bodyHash`?
- **Current approach:** Not specified in Phase-B2.md (belongs to Phase B3, ActiveProbeProvider)
- **Status:** Phase B2 just consumes existing `bodyHash` field
- **Input Required Now:** NO — Phase B3 task

---

## 📋 WHAT HAPPENS NEXT

### Before You Start Implementation
1. ✅ Confirm you've read PHASE_B2_QUICK_REFERENCE.md (1-page card)
2. ✅ Confirm CF context decision is what you want (Soft Correlation → Document says "More informative")
3. ✅ Ready to proceed? Start with probeUtils.ts

### During Implementation
- Reference Phase-B2.md constantly (keep it open in another tab)
- Follow rule generation order exactly (Phase-B2.md §5)
- Write tests alongside code
- No decisions needed — just execution

### After Implementation
- Code review against CLAUDE.md §15 checklist
- Verify byte-stable output matches Phase-B2.md examples
- No further decisions unless review identifies new ambiguities

---

## 🎯 Bottom Line

**How many decisions need your input to start Phase B2 implementation?**

**ZERO.**

CF context drift is decided. All 15 design decisions are documented. All contracts are locked. You can start coding immediately.

**What would block implementation?**
- ✅ CF context decision → DONE (Soft Correlation)
- ✅ Design decisions → DONE (15 documented)
- ✅ Specs locked → DONE (Phase-B2.md)
- ✅ No blocking issues → CONFIRMED

---

## 📚 Quick Navigation

| If you want to... | Read this |
|------------------|-----------|
| Understand Phase B2 at a glance | PHASE_B2_QUICK_REFERENCE.md |
| Know the implementation order | PHASE_B2_IMPLEMENTATION_ROADMAP.md |
| See why each design decision was made | PHASE_B2_DESIGN_DECISIONS.md |
| Verify you're ready to code | READINESS_CHECKLIST.md |
| Review your CF context decision | PHASE_B2_OPEN_DECISION.md or DECISION_LOG.md |
| Understand system constraints | CLAUDE.md (§1–3, §15) |

---

**Status: ✅ READY TO IMPLEMENT**

No further input needed. Start with probeUtils.ts.

