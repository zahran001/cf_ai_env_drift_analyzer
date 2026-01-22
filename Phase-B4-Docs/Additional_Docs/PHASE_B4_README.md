# Phase B4: SQLite Durable Objects + Ring Buffer — Complete Design

## What You Have

Five comprehensive design documents that completely specify Phase B4 (Durable Objects with SQLite):

### 1. **PHASE_B4_DESIGN.md** (Main Specification)
The authoritative design document. Contains:
- Complete SQLite schema (comparisons + probes tables)
- All 6 DO methods with full signatures and pseudocode
- Ring buffer algorithm with examples
- Keying strategy (pairKey → stable DO routing)
- Acceptance criteria for Phase B4

**Length:** ~500 lines
**Best for:** Understanding Phase B4 requirements and contracts

---

### 2. **PHASE_B4_ARCHITECTURE.md** (Visual + Data Flow)
Architecture diagrams and detailed flow visualization. Contains:
- High-level system diagram (frontend → worker → DO → workflow)
- Sequence diagram (complete comparison lifecycle)
- Idempotency examples with actual code
- State machine (status transitions)
- Ring buffer visualization with step-by-step examples
- DO instance routing mechanics
- Migration/deployment checklist

**Length:** ~700 lines
**Best for:** Understanding how pieces fit together, seeing visual flow

---

### 3. **PHASE_B4_IMPLEMENTATION.md** (Step-by-Step Guide)
Practical implementation guide. Contains:
- Create migration file (copy-paste ready)
- Update wrangler.toml (with D1 + DO bindings)
- Implement EnvPairDO class (full TypeScript code)
- Update routes and worker entry point
- Implement computePairKey utility
- Unit test examples
- Local testing commands
- Idempotency verification steps
- Troubleshooting guide

**Length:** ~600 lines
**Best for:** Actually coding Phase B4

---

### 4. **PHASE_B4_SUMMARY.md** (Executive Overview)
High-level summary and navigation guide. Contains:
- What Phase B4 solves (the problem)
- 4 core design principles
- Quick architecture overview
- Database schema at a glance
- Data flow lifecycle (4 steps)
- Why idempotency matters (retry scenarios)
- Ring buffer mechanism
- What Phase B4 enables
- What comes after (B5, B6, B7, B8)
- Testing checklist
- Key insights

**Length:** ~400 lines
**Best for:** Getting oriented, understanding big picture

---

### 5. **PHASE_B4_CLAUDE_MAPPING.md** (Compliance Verification)
Maps Phase B4 design to CLAUDE.md requirements. Contains:
- Section-by-section mapping to CLAUDE.md
- Proof that every requirement is satisfied
- Cross-references to design documents
- Code examples showing compliance
- Compliance checklist (all ✅)

**Length:** ~400 lines
**Best for:** Verifying design meets rulebook, code review

---

## Quick Navigation

### "I'm new to Phase B4. Where do I start?"
→ Read **PHASE_B4_SUMMARY.md** (20 min read)

### "I need to understand the architecture."
→ Read **PHASE_B4_ARCHITECTURE.md** and look at the diagrams (30 min)

### "I'm ready to code Phase B4."
→ Follow **PHASE_B4_IMPLEMENTATION.md** step by step (2-3 hours)

### "I need the complete specification."
→ Read **PHASE_B4_DESIGN.md** (reference document, bookmark it)

### "I need to verify CLAUDE.md compliance."
→ Check **PHASE_B4_CLAUDE_MAPPING.md** (5 min scan, ✅ everything is compliant)

---

## Key Concepts (TL;DR)

### Problem
- Workflow needs durable storage for comparison results
- Workers can't store state (stateless architecture)
- Need idempotent storage to handle Workflow retries
- Need bounded storage to prevent quota overflow

### Solution
**One SQLite DO per environment pair**, with:
- **Deterministic routing:** `computePairKey(leftUrl, rightUrl)` → always same DO
- **Idempotent probes:** Probe ID = `${comparisonId}:${side}` → updates on retry, no duplicates
- **Ring buffer:** Keep last 50 comparisons, auto-delete oldest on insert
- **Polling not subscription:** Worker polls DO (not Workflow), keeps everything stateless

### Why It Works
1. **Same pair always routes to same DO** via pairKey → shared history
2. **Probes can retry safely** via deterministic ID → no duplicates
3. **Storage is bounded** via ring buffer → never exceed quota
4. **Worker is stateless** via polling → can replicate horizontally

---

## Implementation Path

### Phase B4 (This phase)
- [ ] Implement EnvPairDO class with SQLite
- [ ] Create migration file
- [ ] Update wrangler.toml with DO + D1 bindings
- [ ] Test locally with `wrangler dev`

### Phase B5 (Next)
- Integrate Workers AI for LLM explanations
- Call `explainDiff(diff, history)` in Workflow

### Phase B6 (After B5)
- Wire Workflow orchestration end-to-end
- Coordinate probe → diff → LLM → persist pipeline

### Phase B7
- Expose POST /api/compare and GET /api/compare/:id
- Input validation (SSRF protection)

### Phase B8
- Hardening, error handling, production stability

---

## At a Glance: The Design

```
┌─────────────────────────────────────────────┐
│         React Frontend (Polling)            │
└──────────────────┬──────────────────────────┘
                   │ POST /api/compare
                   │ GET /api/compare/:id
┌──────────────────▼──────────────────────────┐
│  Cloudflare Worker (Stateless)              │
│  - Validate input                           │
│  - Compute pairKey                          │
│  - Initialize/poll DO                       │
└──────────────────┬──────────────────────────┘
                   │ stub.createComparison()
                   │ stub.saveProbe()
                   │ stub.getComparison()
┌──────────────────▼──────────────────────────┐
│  Durable Object (SQLite, 1 per pair)        │
│  ┌──────────────────────────────────────┐   │
│  │ Comparisons Table                    │   │
│  │ - id (pairKey:uuid)                  │   │
│  │ - status (running/completed/failed)  │   │
│  │ - result_json, error                 │   │
│  │ - Ring buffer (keep last 50)         │   │
│  └──────────────────────────────────────┘   │
│  ┌──────────────────────────────────────┐   │
│  │ Probes Table                         │   │
│  │ - id (comparisonId:side)             │   │
│  │ - envelope_json (SignalEnvelope)     │   │
│  │ - UNIQUE(comparison_id, side)        │   │
│  └──────────────────────────────────────┘   │
└──────────────────┬──────────────────────────┘
                   │ step.do() calls
┌──────────────────▼──────────────────────────┐
│  Cloudflare Workflow (Orchestration)        │
│  - Probe left & right                       │
│  - Save probes (idempotent)                 │
│  - Compute diff                             │
│  - Load history from DO                     │
│  - Call LLM (Phase B5)                      │
│  - Save result (Phase B5)                   │
└─────────────────────────────────────────────┘
```

---

## Key Guarantees

### ✅ Idempotent Retries
Workflow can safely retry any step without duplicating probes.
- Probe ID is deterministic: `${comparisonId}:${side}`
- Schema enforces UNIQUE(comparison_id, side)
- INSERT OR REPLACE handles retries automatically

### ✅ Bounded Storage
DO storage never exceeds quota.
- Ring buffer keeps last N=50 comparisons
- Oldest automatically deleted on insert
- Synchronous cleanup (no background jobs)

### ✅ Stateless Worker
Worker can be replicated horizontally.
- No local state caching
- All state in DO (authoritative source)
- Poll-based (not subscription-based)

### ✅ Deterministic Routing
Same pair always uses same DO instance.
- pairKey computed from URLs (order-independent)
- idFromName(pairKey) always returns same DO
- Enables pair-level history and retention

---

## Files Created

```
cloudflare_ai_project/
├── PHASE_B4_DESIGN.md              (← Specification)
├── PHASE_B4_ARCHITECTURE.md        (← Diagrams & flow)
├── PHASE_B4_IMPLEMENTATION.md      (← Step-by-step guide)
├── PHASE_B4_SUMMARY.md             (← Executive overview)
├── PHASE_B4_CLAUDE_MAPPING.md      (← Compliance check)
└── PHASE_B4_README.md              (← This file)
```

---

## How to Use These Documents

### For Code Review
1. Check **PHASE_B4_CLAUDE_MAPPING.md** for compliance ✅
2. Review **PHASE_B4_DESIGN.md** for contracts
3. Verify against **PHASE_B4_ARCHITECTURE.md** diagrams

### For Implementation
1. Start with **PHASE_B4_SUMMARY.md** (orient yourself)
2. Follow **PHASE_B4_IMPLEMENTATION.md** step by step
3. Reference **PHASE_B4_DESIGN.md** for details
4. Use **PHASE_B4_ARCHITECTURE.md** to understand data flow

### For Questions
- "What's the requirement?" → **PHASE_B4_DESIGN.md**
- "How does it work?" → **PHASE_B4_ARCHITECTURE.md**
- "How do I code it?" → **PHASE_B4_IMPLEMENTATION.md**
- "Is this compliant?" → **PHASE_B4_CLAUDE_MAPPING.md**

---

## Acceptance Criteria (Phase B4)

✅ = Will verify after implementation

- [ ] SQLite schema creates without errors (`wrangler migrations apply`)
- [ ] EnvPairDO class instantiates and connects to D1
- [ ] createComparison returns stable comparisonId with format `${pairKey}:${uuid}`
- [ ] saveProbe is idempotent (retry with same inputs updates existing row)
- [ ] Ring buffer deletes oldest after inserting 51st comparison
- [ ] Status transitions work (running → completed, running → failed)
- [ ] getComparison returns correct state object
- [ ] getComparisonsForHistory retrieves completed comparisons
- [ ] Workflow can call all DO methods via step.do()
- [ ] Deterministic routing: same URLs always use same DO instance

---

## What's NOT in Phase B4

These come in later phases:

- ❌ LLM explanation (Phase B5)
- ❌ Workflow orchestration code (Phase B6)
- ❌ Public API endpoints (Phase B7)
- ❌ Input validation/SSRF protection (Phase B8)
- ❌ Error retry logic (Phase B8)

---

## Questions? Troubleshooting?

### Q: Why one DO per pair (not per comparison)?
A: Comparisons for the same pair share history. If you had one DO per comparison, you'd lose history across comparisons.

### Q: Why is probe ID deterministic?
A: Enables idempotent retries. Same probe ID on retry → UPDATE, not INSERT duplicate.

### Q: Why extract pairKey from comparisonId?
A: Worker stays stateless. No pairKey lookup table needed; it's embedded in the ID.

### Q: Why synchronous ring buffer (not alarms)?
A: Cloudflare DO doesn't have timers. Synchronous cleanup on every insert is simpler and deterministic.

### Q: Why polling (not Workflow subscription)?
A: Keeps Worker stateless and enables horizontal scaling. Workflow can fail/retry without Worker coordination.

---

## References

- **CLAUDE.md:** The authoritative rulebook (sections 2.2, 2.3, 4.2-4.4, 5.3)
- **MVP_Tracker.md:** Original Phase B4 requirements
- **Backend_System_Architecture.md:** System context
- **Cloudflare Docs:**
  - [Durable Objects](https://developers.cloudflare.com/durable-objects/)
  - [D1 Database](https://developers.cloudflare.com/d1/)
  - [Workflows](https://developers.cloudflare.com/workflows/)

---

## Next Steps

1. ✅ You have the complete design (5 documents)
2. ⏭️ Follow **PHASE_B4_IMPLEMENTATION.md** to code it
3. ⏭️ Verify acceptance criteria after implementation
4. ⏭️ Move to Phase B5 (LLM integration)

---

**Good luck with Phase B4! It's a critical foundation for the entire system.** 🚀

Any questions? Refer back to one of the five design documents above.
