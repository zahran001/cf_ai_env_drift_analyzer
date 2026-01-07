# Phase B2: Deterministic Diff Engine — Pre-Implementation Summary

**This folder contains everything needed to understand and implement Phase B2.**

---

## 📋 Documents in This Plan

| Document | Purpose | Audience |
|----------|---------|----------|
| **PHASE_B2_DESIGN_DECISIONS.md** | 15 design decisions with rationale, code examples, recommendations | Developers, architects |
| **PHASE_B2_IMPLEMENTATION_ROADMAP.md** | Ordered checklist of utilities to build, integration strategy, timeline | Project leads, developers |
| **PHASE_B2_QUICK_REFERENCE.md** | One-page card with constants, codes, logic rules, evidence vocabulary | Quick lookup during coding |
| **PHASE_B2_OPEN_DECISION.md** | The ONE decision that must be made before coding | Decision-makers |
| **Phase-B2.md** | Authoritative rulebook (governance document) | Authority reference |

---

## 🚀 Before You Start Coding

### 1. Read in This Order
```
1. PHASE_B2_QUICK_REFERENCE.md (5 min) — Understand the vocab
2. PHASE_B2_DESIGN_DECISIONS.md (30 min) — Understand the WHY
3. PHASE_B2_OPEN_DECISION.md (10 min) — One decision to resolve
4. PHASE_B2_IMPLEMENTATION_ROADMAP.md (10 min) — Understand the plan
```

### 2. Make One Decision
**Question:** CF Context Drift Correlation
- Read: `PHASE_B2_OPEN_DECISION.md`
- Choose: Option A (hard) or Option B (soft)
- Update: Phase-B2.md §4.F1
- Document: Your choice in the codebase

### 3. Create File Structure
```
src/analysis/
├─ probeUtils.ts
├─ urlUtils.ts
├─ classifiers.ts
├─ headerDiff.ts
├─ contentUtils.ts
├─ redirectUtils.ts
├─ cacheUtils.ts
├─ validators.ts
├─ constants.ts
├─ sorting.ts (optional; can go in diff.ts)
├─ classify.ts (main orchestrator)
├─ diff.ts (coordinate computation)
│
├─ __tests__/
│  ├─ probeUtils.test.ts
│  ├─ urlUtils.test.ts
│  ├─ classifiers.test.ts
│  ├─ ... (one per utility)
│  └─ classify.test.ts (integration)
```

### 4. Update shared/diff.ts
Add these helpers:
```typescript
// Deduplication
export function computeFindingDeduplicateKey(code, section, keys): string

// ID generation
export function computeFindingId(code, evidence): string

// Sorting
export function sortFindings(findings): DiffFinding[]
export const SEVERITY_ORDER: Record<Severity, number>

// Constants
export const TIMING_DRIFT_THRESHOLDS = { /* from Phase-B2.md §3 */ }
```

---

## 📊 Implementation Overview

### Phase B2 = 14 Finding Rules + Determinism

```
Input: Two SignalEnvelopes (left, right)
  ↓
Compile structural diffs:
  - ProbeOutcomeDiff (success/failure status)
  - Status diff (status code comparison)
  - Final URL diff (scheme/host/path/query)
  - Redirect chain diff (hop count, final host)
  - Headers diff (normalized, whitelisted)
  - Content diff (type, length, hash)
  - Timing diff (duration)
  - CF context diff (colo, asn, country)
  ↓
Emit findings in strict order (Rules A1–G1):
  ├─ A1/A2: Probe outcomes
  ├─ B1–B3: Routing (status, URL, redirects)
  ├─ C1–C2: Security (auth, CORS)
  ├─ D1–D5: Content & cache
  ├─ E1: Timing
  ├─ F1: CF context
  └─ G1: Generic headers
  ↓
Post-process:
  - Deduplicate by (code, section, keys)
  - Sort by (severity, code, message)
  - Compute maxSeverity
  ↓
Output: EnvDiff with deterministic findings[]
```

### Why 14 Rules?

| Group | Rules | What |
|-------|-------|------|
| A | 2 | Probe success/failure outcomes |
| B | 3 | Routing (status, URL, redirects) |
| C | 2 | Security headers (auth, CORS) |
| D | 5 | Content headers & body (cache, type, length, hash, vary) |
| E | 1 | Timing drift thresholds |
| F | 1 | Cloudflare context (colo, ASN) |
| G | 1 | Catch-all for unlabeled headers |
| **Total** | **14** | |

---

## 🔑 Key Invariants

1. **Determinism:** Same inputs → identical output every time (no timestamps, randomness, LLM)
2. **Evidence Vocabulary:** Keys constrained by section (see QUICK_REFERENCE)
3. **Whitelist:** Only captured headers are those in Phase-B2.md allowlist
4. **Sorting:** Always by (severity, code, message) for stable output
5. **Deduplication:** By (code, section, sorted keys) to collapse duplicates
6. **Thresholds:** All constants from Phase-B2.md §3

---

## 📦 Utility Modules (Build Order)

### 🔴 Critical (Required for Core Logic)

1. **probeUtils.ts** — Convert SignalEnvelopes → ProbeOutcomeDiff
2. **urlUtils.ts** — Parse URLs, classify drift (scheme/host vs path)
3. **classifiers.ts** — Status code severity logic
4. **headerDiff.ts** — Whitelist enforcement, normalize, compute diff categories
5. **contentUtils.ts** — Content-type normalization, content-length severity
6. **redirectUtils.ts** — Redirect chain comparison
7. **cacheUtils.ts** — Cache-control keyword detection
8. **probeUtils.ts** — (above)
9. **validators.ts** — Evidence key validation

### 🟡 High Priority

10. **constants.ts** — Timing thresholds, rule registry
11. **shared/diff.ts updates** — Dedup key, sorting helpers

---

## 🧪 Testing Strategy

### Per-Utility Tests
Each utility gets a snapshot test against Phase-B2.md examples:

```typescript
// classifiers.test.ts
test("STATUS_MISMATCH: 200 vs 500 = critical", () => {
  const severity = classifyStatusDrift(200, 500);
  expect(severity).toBe("critical");
});

test("STATUS_MISMATCH: 200 vs 201 = warn", () => {
  const severity = classifyStatusDrift(200, 201);
  expect(severity).toBe("warn");
});
```

### Integration Tests
One big test file with all 14 rule groups:

```typescript
// classify.test.ts
describe("Phase B2 Integration", () => {
  test("Rule A1: Both probes failed", () => {
    const diff = computeEnvDiff(mockLeft, mockRight);
    expect(diff.findings).toContainEqual({
      code: "PROBE_FAILURE",
      severity: "critical",
      evidence: [{ section: "probe" }]
    });
  });

  test("Rule B1: Status critical", () => { /* ... */ });
  test("Rule B2: URL critical", () => { /* ... */ });
  // ... 14 total
});
```

---

## 📏 Complexity & Effort

| Component | Complexity | LOC Est. | Time |
|-----------|-----------|---------|------|
| probeUtils | Low | 30 | 0.5h |
| urlUtils | Low | 50 | 0.5h |
| classifiers | Low | 40 | 0.25h |
| headerDiff | Medium | 100 | 1h |
| contentUtils | Low | 60 | 0.5h |
| redirectUtils | Low | 60 | 0.5h |
| cacheUtils | Low | 40 | 0.25h |
| validators | Low | 50 | 0.5h |
| constants | Low | 30 | 0.25h |
| classify.ts | High | 300 | 2–3h |
| Tests | Medium | 400 | 2–3h |
| **Total** | | ~1100 | **9–13h** |

---

## ✅ Definition of Done

Before Phase B2 is complete:

- [ ] All 11 utility modules implemented and unit-tested
- [ ] `computeEnvDiff()` in classify.ts orchestrates all rules
- [ ] All 14 rule groups implemented and tested
- [ ] Evidence keys validated against Phase-B2.md §1.3
- [ ] Findings deduplicated and sorted deterministically
- [ ] Output matches Phase-B2.md examples byte-for-byte
- [ ] Code review checklist complete (CLAUDE.md §15)
- [ ] No timestamps, randomness, or LLM calls in diff engine

---

## 🎯 Immediate Next Steps

1. **Read** PHASE_B2_QUICK_REFERENCE.md (5 min)
2. **Decide** on CF context correlation (5–10 min discussion)
3. **Update** Phase-B2.md §4.F1 with decision
4. **Create** src/analysis/ directory structure
5. **Start** with probeUtils.ts (first utility)
6. **Write** tests alongside implementation

---

## 📞 Key References

- **Phase-B2.md** — Authoritative rules
- **CLAUDE.md** — System constraints (idempotency, no LLM, etc.)
- **shared/diff.ts** — TypeScript schemas
- **QUICK_REFERENCE.md** — Vocab & constants lookup

---

## 💡 Pro Tips

1. **Keep Phase-B2.md open** while coding — reference rules directly
2. **Snapshot tests are your friend** — they verify byte-stability
3. **Build utilities independently** — easier to test and review
4. **Run classify tests last** — they depend on all utilities
5. **If unsure, check Phase-B2.md** — it's the authority

---

## ❓ Questions?

Refer to:
- **Why a decision?** → PHASE_B2_OPEN_DECISION.md
- **How to implement X?** → PHASE_B2_DESIGN_DECISIONS.md (section number)
- **Quick lookup** → PHASE_B2_QUICK_REFERENCE.md
- **What's the order?** → PHASE_B2_IMPLEMENTATION_ROADMAP.md

---

**Ready? Start with PHASE_B2_QUICK_REFERENCE.md and work through in order.** ✨
