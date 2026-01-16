# Phase B4 Summary: Understanding & Design Complete

## Executive Summary

Phase B4 introduces **SQLite-backed Durable Objects (DO)** as the authoritative state store for environment comparison results. This is the bridge between the stateless Worker/Workflow layer and durable history management.

**Key Achievement:** Design provides idempotent, retry-safe, bounded storage with automatic ring buffer retention.

---

## What is Phase B4?

### The Problem It Solves

- **Phase B3** (ActiveProbeProvider) can probe URLs but has no place to store results
- **Phase B5+** (LLM) needs historical context from previous comparisons
- **Workflow retries** could create duplicate records if storage is not idempotent
- **Storage quota** must be bounded to prevent DO instance bloat

### The Solution

**One SQLite instance per environment pair** (keyed by stable `pairKey`):

```
pair("staging.example.com" vs "prod.example.com")
  ↓
  DO instance (unique ID)
    ↓
    SQLite database (comparisons + probes tables)
      ↓
      Ring buffer (keep last 50 comparisons)
```

---

## Core Design Principles

### 1. Deterministic Routing

Same environment pair always routes to same DO instance.

```typescript
pairKey = computePairKey("staging.example.com", "prod.example.com");
const doId = env.ENVPAIR_DO.idFromName(pairKey);  // Always same ID
```

**Benefit:** Comparisons for same pair share history and ring buffer.

### 2. Idempotent DO Methods

All methods safe for automatic Workflow retries.

```typescript
// First execution
await saveProbe(comparisonId, "left", envelope);  // Inserts row

// Retry (same inputs)
await saveProbe(comparisonId, "left", envelope);  // Updates row (no duplicate)
```

**Key:** Probe ID is deterministic: `${comparisonId}:${side}`

### 3. Ring Buffer Retention

Automatic cleanup of oldest comparisons when threshold exceeded.

```
Insert comparison #51 → Automatically delete comparison #1
Keep: last 50 comparisons (default, configurable)
```

**Benefit:** Bounded storage; DO quota never exceeded.

### 4. Authoritative State Source

Worker polls DO, never reads Workflow state directly.

```typescript
// ✅ Correct: Poll DO
const state = await doStub.getComparison(comparisonId);

// ❌ Wrong: Poll Workflow
const state = await workflow.getStatus(comparisonId);
```

**Benefit:** Loose coupling; Workflow can retry/replay without Worker coordination.

---

## Architecture at a Glance

```
Frontend (React)
      ↓ POST /api/compare
Worker (Stateless)
      ↓ compute pairKey
DO (SQLite)
      ↓ return comparisonId
Workflow (Orchestration)
      ↓ step.do() calls
DO (Save probes, diffs, results)
      ↓ persist state
Frontend (Polls GET /api/compare/:id)
      ↓ route via pairKey
Worker (Fetch state)
      ↓ get doStub(pairKey)
DO (Read state)
      ↓ return {status, result, error}
Frontend (Display result)
```

---

## Database Schema

### Comparisons Table

Tracks all comparison runs for a pair.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | TEXT PRIMARY KEY | Stable ID: `${pairKey}:${uuid}` |
| `ts` | INTEGER | Creation timestamp (immutable) |
| `left_url` | TEXT | Left environment URL |
| `right_url` | TEXT | Right environment URL |
| `status` | TEXT | "running" \| "completed" \| "failed" |
| `result_json` | TEXT | Final result (null if not complete) |
| `error` | TEXT | Error message (null if not failed) |

### Probes Table

Stores raw HTTP probe results.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | TEXT PRIMARY KEY | Deterministic: `${comparisonId}:${side}` |
| `comparison_id` | TEXT | Foreign key to comparisons |
| `ts` | INTEGER | Probe execution timestamp |
| `side` | TEXT | "left" \| "right" |
| `url` | TEXT | Probed URL |
| `envelope_json` | TEXT | Full SignalEnvelope (JSON) |

**Constraints:**
- `UNIQUE(comparison_id, side)`: One probe per side per comparison
- `FOREIGN KEY ... ON DELETE CASCADE`: Cleanup when comparison deleted
- `CHECK status IN (...)`: Enforce valid status values

---

## Key DO Methods

### 1. `createComparison(leftUrl, rightUrl)`

Initialize a comparison run.

```typescript
{ comparisonId: "abc123:def456", status: "running" }
```

### 2. `saveProbe(comparisonId, side, envelope)`

Store HTTP probe result (idempotent).

```typescript
// Deterministic probe ID prevents duplicates on retry
probeId = `${comparisonId}:${side}`
```

### 3. `saveResult(comparisonId, resultJson)`

Finalize with LLM result.

```typescript
// UPDATE comparisons
// SET status = 'completed', result_json = {...}
```

### 4. `failComparison(comparisonId, error)`

Mark as failed with error message.

```typescript
// UPDATE comparisons
// SET status = 'failed', error = "..."
```

### 5. `getComparison(comparisonId)`

Retrieve state (used by Worker polling).

```typescript
{ status: "completed", result: {...} }
```

### 6. `getComparisonsForHistory(limit)`

Fetch recent comparisons for LLM context.

```typescript
// SELECT ... WHERE status = 'completed' ORDER BY ts DESC LIMIT 10
```

---

## Data Flow: Complete Comparison Lifecycle

### Step 1: Frontend Initiates

```
POST /api/compare
{ leftUrl, rightUrl }
```

### Step 2: Worker Handles

```
1. Validate URLs (SSRF protection)
2. Compute pairKey = hash("staging" | "prod")
3. Get DO stub via idFromName(pairKey)
4. stub.createComparison(leftUrl, rightUrl)
5. Return { comparisonId: "pairHash:uuid" }
6. Start Workflow in background (async)
```

### Step 3: Workflow Executes (Multi-Step)

```
1. Probe left URL → SignalEnvelope
   await stub.saveProbe(comparisonId, "left", envelope)

2. Probe right URL → SignalEnvelope
   await stub.saveProbe(comparisonId, "right", envelope)

3. Compute diff deterministically
   diff = computeDiff(left, right)

4. Load history
   history = await stub.getComparisonsForHistory(5)

5. Call LLM
   result = await explainDiff(diff, history)

6. Save result
   await stub.saveResult(comparisonId, result)

On error:
   await stub.failComparison(comparisonId, errorMsg)
```

### Step 4: Frontend Polls

```
GET /api/compare/pairHash:uuid

Worker:
  1. Extract pairKey from comparisonId (before ':')
  2. Get DO stub via idFromName(pairKey)
  3. state = stub.getComparison(comparisonId)
  4. Return { status, result?, error? }
```

---

## Why Idempotency Matters

### Scenario: Workflow Step Fails and Retries

**First Attempt:**
```typescript
await step.do("saveLeftProbe", async () => {
  return stub.saveProbe(comparisonId, "left", envelope);
  // Network error occurs here
});
```

**Automatic Retry (same inputs):**
```typescript
await step.do("saveLeftProbe", async () => {
  return stub.saveProbe(comparisonId, "left", envelope);
  // Same inputs!
});
```

**Without Idempotency:**
- First attempt: INSERT into probes (succeeds but crashes before returning)
- Retry: INSERT again → **Duplicate probe record** ❌

**With Idempotency:**
- First attempt: INSERT into probes
- Retry: INSERT OR REPLACE with same ID → **Updates existing row** ✅

**Key:** Probe ID is stable: `${comparisonId}:${side}` (never changes)

---

## Ring Buffer Mechanism

### Purpose

Keep DO storage bounded (max 50 comparisons per pair).

### Algorithm

```sql
-- When inserting comparison #51
INSERT INTO comparisons ... VALUES (comparison_51, ...)

-- Cleanup: Delete oldest beyond N=50
DELETE FROM comparisons
WHERE ts < (
  SELECT ts FROM comparisons
  ORDER BY ts DESC
  LIMIT 1 OFFSET 49  -- Keep 50, delete older
)

-- Result: comparisons 2-51 remain (original #1 deleted)
```

### Benefits

- No manual cleanup jobs
- Automatic on every insert
- Synchronous (no background alarms)
- Configurable (change N without migration)

---

## Wrangler Configuration Required

```toml
# Durable Objects binding
[durable_objects]
bindings = [
  { name = "ENVPAIR_DO", class_name = "EnvPairDO" }
]

# D1 Database binding
[[d1_databases]]
binding = "ENVPAIR_DB"
database_name = "envpair_comparisons"
database_id = "YOUR_ID"  # From Cloudflare dashboard

# Migrations
[[migrations]]
tag = "v1"
new_classes = ["EnvPairDO"]
```

---

## Three Documents Provided

### 1. **PHASE_B4_DESIGN.md**
Complete specification of Phase B4.
- SQLite schema (with rationale)
- All DO methods (with signatures)
- Ring buffer algorithm
- DO routing strategy
- Data flow rules
- Acceptance criteria

**Use when:** You need the official requirements and constraints.

### 2. **PHASE_B4_ARCHITECTURE.md**
Visual architecture and detailed data flow.
- High-level system diagram
- Sequence diagrams (complete flow)
- Idempotency examples with code
- State machine diagrams
- Ring buffer visualization
- DO instance routing mechanics
- Migration/deployment steps

**Use when:** You want to understand how the pieces fit together visually.

### 3. **PHASE_B4_IMPLEMENTATION.md**
Step-by-step implementation guide.
- Create SQLite migration file
- Implement EnvPairDO class
- Update wrangler.toml
- Write env type definitions
- Update router and worker
- Implement pairKey utility
- Unit test examples
- Local testing procedures
- Idempotency verification
- Troubleshooting

**Use when:** You're ready to code Phase B4.

---

## What Phase B4 Enables

Once implemented, you'll have:

✅ **Durable State**
- Comparisons persist across Worker restarts
- DO is source of truth for comparison status
- Ring buffer prevents quota issues

✅ **Idempotent Retries**
- Workflow can safely retry without duplicating probes
- Deterministic probe IDs enforce uniqueness
- INSERT OR REPLACE handles retries automatically

✅ **Historical Context**
- LLM can see recent comparisons for better explanations
- getComparisonsForHistory() retrieves context
- Phase B5 (LLM) depends on this

✅ **Scalable Architecture**
- One DO per pair (not per comparison)
- Worker stateless; can be replicated
- DO handles persistence and retry safety
- Clear separation of concerns

---

## What Comes After Phase B4

### Phase B5: LLM Explanation Layer
- Call Workers AI with diff + history
- Validate JSON output
- Store structured explanation in result

### Phase B6: Workflow Orchestration
- Wire CompareEnvironments workflow
- Coordinate probe → diff → LLM → persist
- Error handling and status transitions

### Phase B7: Public API Endpoints
- Expose POST /api/compare
- Expose GET /api/compare/:id
- Input validation (SSRF protection)

### Phase B8: Hardening & Polish
- Retry logic with exponential backoff
- Clear error classification
- Production stability

---

## Key Insights

### Insight 1: Pair-Level Isolation
DO instances group by environment pair, not individual comparisons. This enables:
- Shared history for same pair
- Pair-level ring buffer
- Deterministic routing (pairKey → always same DO)

### Insight 2: Idempotent Storage
Probe IDs encode their identity (`${comparisonId}:${side}`), making retry-safety automatic:
- Same probe ID on retry → UPDATE, not INSERT
- No application-level deduplication needed
- Schema constraint enforces uniqueness

### Insight 3: Polling, Not Subscription
Worker polls DO instead of watching Workflow:
- Worker remains stateless
- Workflow can fail/retry without Worker knowing
- Frontend polling is simple REST: GET /api/compare/:id

### Insight 4: Bounded Memory
Ring buffer (default 50) prevents quota explosion:
- Synchronous cleanup on every insert
- No background jobs or alarms
- Oldest comparisons auto-deleted

---

## Testing Checklist

Before moving to Phase B5, verify:

- [ ] SQLite schema creates correctly (`wrangler migrations apply --local`)
- [ ] EnvPairDO class instantiates without errors
- [ ] createComparison returns stable comparisonId
- [ ] saveProbe is idempotent (retry with same inputs = no duplicate)
- [ ] Ring buffer deletes oldest after N=50
- [ ] Status transitions work (running → completed, running → failed)
- [ ] getComparison returns correct state
- [ ] getComparisonsForHistory retrieves recent comparisons
- [ ] Workflow can call all DO methods via step.do()

---

## References

**Within Repo:**
- `CLAUDE.md` Section 2.3: Durable Objects Contract
- `CLAUDE.md` Section 2.2: Workflow Idempotency Rules
- `MVP_Tracker.md` Phase B4: Original requirements

**Cloudflare Documentation:**
- [Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [D1 Database](https://developers.cloudflare.com/d1/)
- [Workflows](https://developers.cloudflare.com/workflows/)

**Design Documents (This Suite):**
1. PHASE_B4_DESIGN.md (Detailed specification)
2. PHASE_B4_ARCHITECTURE.md (Visual diagrams and data flow)
3. PHASE_B4_IMPLEMENTATION.md (Step-by-step coding guide)
4. PHASE_B4_SUMMARY.md (This document)

---

## Next Steps

1. **Review** all three design documents to understand Phase B4
2. **Follow** PHASE_B4_IMPLEMENTATION.md to code the EnvPairDO class
3. **Test** locally with `wrangler dev` and manual SQL queries
4. **Verify** idempotency by simulating Workflow retries
5. **Move to Phase B5** once acceptance criteria pass

**Good luck! Phase B4 is a critical foundational layer.** 🚀
