# Phase B4: Architecture & Data Flow Diagrams

## High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    React Frontend (Vite)                        │
│                    (Stateless, Polling)                         │
└────────────────────────┬────────────────────────────────────────┘
                         │
         POST /api/compare & GET /api/compare/:id
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                  Cloudflare Worker                              │
│              (Stateless Request Handler)                        │
├─────────────────────────────────────────────────────────────────┤
│  1. Validate input (SSRF protection)                            │
│  2. Compute pairKey from URLs                                   │
│  3. Get/create DO stub for pair                                 │
│  4. Initialize comparison in DO                                 │
│  5. Start Workflow (async)                                      │
│  6. Return comparisonId immediately                             │
└────────────────────────┬────────────────────────────────────────┘
                         │
          env.ENVPAIR_DO.get(idFromName(pairKey))
                         │
┌────────────────────────▼────────────────────────────────────────┐
│  Durable Objects (SQLite-Backed)                                │
│  One instance per environment pair (pairKey)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Comparisons Table                                       │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ id          │ ts  │ left_url │ right_url │ status      │   │
│  │─────────────────────────────────────────────────────────│   │
│  │ pair1:uuid1 │ ... │ ...      │ ...       │ running     │   │
│  │ pair1:uuid2 │ ... │ ...      │ ...       │ completed   │   │
│  │ pair1:uuid3 │ ... │ ...      │ ...       │ failed      │   │
│  │ ...         │ ... │ ...      │ ...       │ ...         │   │
│  │ (Ring buffer: keep last 50)                            │   │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ Probes Table                                            │  │
│  ├─────────────────────────────────────────────────────────┤  │
│  │ id              │ side  │ url │ envelope_json           │  │
│  │─────────────────────────────────────────────────────────│  │
│  │ pair1:uuid1:left│ left  │ ... │ {...}                   │  │
│  │ pair1:uuid1:right│right │ ... │ {...}                   │  │
│  │ pair1:uuid2:left│ left  │ ... │ {...}                   │  │
│  │ ...             │ ...   │ ... │ ...                     │  │
│  │ (UNIQUE(comparison_id, side) - 1 probe per side)        │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│ Methods:                                                      │
│  - createComparison(leftUrl, rightUrl)                        │
│  - saveProbe(comparisonId, side, envelope)                    │
│  - saveResult(comparisonId, resultJson)                       │
│  - failComparison(comparisonId, error)                        │
│  - getComparison(comparisonId) → returns state                │
│  - getComparisonsForHistory(limit) → context for LLM          │
└────────────────────────┬────────────────────────────────────────┘
                         │
             Workflow reads/writes via step.do()
                         │
┌────────────────────────▼────────────────────────────────────────┐
│             Cloudflare Workflows (Orchestration)                │
│         CompareEnvironments Pipeline (9 steps)                  │
├─────────────────────────────────────────────────────────────────┤
│ 1. Validate inputs & compute pairKey                           │
│ 2. DO: createComparison() → comparisonId, status=running       │
│ 3. step.do(): probe left URL → SignalEnvelope                 │
│ 4. step.do(): DO.saveProbe(comparisonId, "left", envelope)    │
│ 5. step.do(): probe right URL → SignalEnvelope                │
│ 6. step.do(): DO.saveProbe(comparisonId, "right", envelope)   │
│ 7. step.do(): computeDiff(left, right) → EnvDiff             │
│ 8. step.do(): DO.getComparisonsForHistory() → context         │
│ 9. step.do(): explainDiff(diff, history) → LLM result        │
│ 10. step.do(): DO.saveResult(comparisonId, result)            │
│ ─────────────────────────────────────────────────────────────  │
│ On ANY error:                                                   │
│   - DO.failComparison(comparisonId, errorMessage)             │
│   - status = "failed"                                          │
└────────────────────────┬────────────────────────────────────────┘
                         │
    Available for polling and historical context
                         │
┌────────────────────────▼────────────────────────────────────────┐
│             Supporting Services                                 │
├─────────────────────────────────────────────────────────────────┤
│ • ActiveProbeProvider: fetch() with manual redirects           │
│ • Diff Engine (B2): deterministic comparison                   │
│ • LLM (Workers AI): Llama 3.3 explanation                     │
│ • Ring Buffer: auto-delete oldest comparisons                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Detailed Sequence Diagram: Full Comparison Flow

```
Frontend              Worker              DO (SQLite)     Workflow        Provider    LLM
   │                    │                     │              │              │          │
   │ POST /api/compare  │                     │              │              │          │
   ├────────────────────>│                     │              │              │          │
   │                    │ validate URLs       │              │              │          │
   │                    ├─────────────────┐   │              │              │          │
   │                    │ compute pairKey │   │              │              │          │
   │                    └─────────────────┘   │              │              │          │
   │                    │ get DO stub         │              │              │          │
   │                    ├──────────────────────>createComp.. │              │          │
   │                    │<──────────────────── comparisonId  │              │          │
   │                    │ start Workflow      │              │              │          │
   │                    │──────────────────────────────────────> start      │          │
   │ {comparisonId}     │<───────────────────────────────────── async       │          │
   │<────────────────────┤                     │              │              │          │
   │                    │                     │              │              │          │
   │ GET /api/compare/id│                     │              │              │          │
   ├────────────────────>│                     │              │              │          │
   │                    │ extract pairKey     │              │              │          │
   │                    │ get DO stub         │              │              │          │
   │                    ├──────────────────────> getCompar.. │              │          │
   │ {status: running}  │<──────────────────── {status}      │              │          │
   │<────────────────────┤                     │              │              │          │
   │ [polling...]       │                     │              │              │          │
   │                    │                     │  [Meanwhile in parallel]    │          │
   │                    │                     │              │              │          │
   │                    │                     │              ├─ step.do()──> probe L   │
   │                    │                     │              │<─────────────────────   │
   │                    │                     │              │ SignalEnvelope L        │
   │                    │                     │              │              │          │
   │                    │                     │<─ saveProbe(compId, L, env) │          │
   │                    │                     │ INSERT INTO probes (L)      │          │
   │                    │                     │ ────────────────────────    │          │
   │                    │                     │              │              │          │
   │                    │                     │              ├─ step.do()──> probe R   │
   │                    │                     │              │<─────────────────────   │
   │                    │                     │              │ SignalEnvelope R        │
   │                    │                     │              │              │          │
   │                    │                     │<─ saveProbe(compId, R, env) │          │
   │                    │                     │ INSERT INTO probes (R)      │          │
   │                    │                     │ ────────────────────────    │          │
   │                    │                     │              │              │          │
   │                    │                     │              ├─ step.do()──> computeDiff
   │                    │                     │              │<───────────────────────│
   │                    │                     │              │ EnvDiff               │
   │                    │                     │              │              │        │
   │                    │                     │<─ getHistory │              │        │
   │                    │                     │ SELECT last 5 completed     │        │
   │                    │                     │ ────────────────────────    │        │
   │                    │                     │              │              │        │
   │                    │                     │              ├─────────────────────> LLM explain
   │                    │                     │              │<───────────────────── result JSON
   │                    │                     │              │              │        │
   │                    │                     │<─ saveResult(compId, result)        │
   │                    │                     │ UPDATE comparisons           │        │
   │                    │                     │ status = completed           │        │
   │                    │                     │ result_json = {...}         │        │
   │                    │                     │ ────────────────────────    │        │
   │                    │                     │              │              │        │
   │ GET /api/compare/id│                     │              │              │        │
   ├────────────────────>│                     │              │              │        │
   │                    ├──────────────────────> getCompar.. │              │        │
   │ {status: completed,│<──────────────────── {status, result, ...}       │        │
   │  result: {...}}    │                     │              │              │        │
   │<────────────────────┤                     │              │              │        │
   │                    │                     │              │              │        │
```

---

## Idempotency & Retry Safety

### Why Idempotency Matters

Cloudflare Workflows retry failed steps automatically. If a step fails, it re-executes with the **same inputs**. Without idempotent DO methods, retries would create duplicate records.

### Probe Idempotency Example

**Scenario:** Workflow step 4 (saveLeftProbe) executes twice due to transient network error.

```typescript
// First execution (fails due to network error)
await step.do("saveLeftProbe", async () => {
  return stub.saveProbe(comparisonId, "left", envelope);
  // Workflow crashes here
});

// Second execution (automatic retry)
await step.do("saveLeftProbe", async () => {
  return stub.saveProbe(comparisonId, "left", envelope);
  // Same inputs, same comparisonId, same side → same probe ID
});
```

**Implementation in DO:**

```typescript
async saveProbe(
  comparisonId: string,
  side: "left" | "right",
  envelope: SignalEnvelope
): Promise<void> {
  const probeId = `${comparisonId}:${side}`;  // ← Deterministic

  // INSERT OR REPLACE ensures:
  // - First call: INSERT new row
  // - Second call (retry): UPDATE existing row (no duplicate)
  await this.db.exec(`
    INSERT OR REPLACE INTO probes (id, comparison_id, ts, side, url, envelope_json)
    VALUES (?, ?, ?, ?, ?, json(?))
  `, [probeId, comparisonId, now, side, envelope.routing.final_url, JSON.stringify(envelope)]);
}
```

**Schema Enforcement:**

```sql
CREATE TABLE probes (
  id TEXT PRIMARY KEY,                       -- Probe ID is unique key
  comparison_id TEXT NOT NULL,
  side TEXT NOT NULL,
  ...
  UNIQUE(comparison_id, side)                -- Also enforce pair uniqueness
);
```

**Result:**
- Retry with same inputs → updates existing row
- No duplicate probes in database
- Workflow can safely retry without coordination

---

## State Transitions & Error Handling

### Comparison Status State Machine

```
                    ┌─────────────────────┐
                    │   Initialized       │
                    │  status = running   │
                    └──────────┬──────────┘
                               │
                     [All steps succeed]
                               │
                    ┌──────────▼──────────┐
                    │   Completed         │
                    │ status = completed  │
                    │ result_json = {...} │
                    └─────────────────────┘


                    ┌──────────┐
                    │ Running  │
                    └──────────┬──────────┐
                               │          │
                    [Step fails]│          │[Explicit error]
                               │          │
                    ┌──────────▼──────────▼┐
                    │   Failed            │
                    │  status = failed    │
                    │  error = "..."      │
                    └─────────────────────┘
```

### Error Propagation in Workflow

```typescript
try {
  // Steps 1-10: probe, diff, LLM, etc.
  await step.do("probeLeft", ...);
  await step.do("saveLeftProbe", ...);
  // ... more steps ...
  await step.do("saveResult", ...);
} catch (error) {
  // Any step fails → propagate to DO
  const stub = env.ENVPAIR_DO.get(env.ENVPAIR_DO.idFromName(pairKey));
  await stub.failComparison(comparisonId, String(error));

  // Comparison status = "failed" in SQLite
  // Worker will see this on next poll
  throw error;  // Re-throw if needed for logging
}
```

---

## Ring Buffer Retention Mechanism

### Visual Example: Keeping Last 3 Comparisons (N=3)

```
Step 1: Insert comparison A
  Comparisons: [A]

Step 2: Insert comparison B
  Comparisons: [A, B]

Step 3: Insert comparison C
  Comparisons: [A, B, C]

Step 4: Insert comparison D
  Comparisons: [A, B, C, D]
  → Trigger ring buffer cleanup: DELETE oldest beyond N=3
  → After cleanup: [B, C, D]

Step 5: Insert comparison E
  Comparisons: [B, C, D, E]
  → Trigger ring buffer cleanup
  → After cleanup: [C, D, E]
```

### SQL Implementation

```sql
-- Step: Insert new comparison
INSERT INTO comparisons (id, ts, left_url, right_url, status)
VALUES (?, ?, ?, ?, 'running');

-- Step: Clean up oldest beyond N=50
DELETE FROM comparisons
WHERE ts < (
  SELECT ts FROM (
    SELECT ts FROM comparisons
    ORDER BY ts DESC
    LIMIT 1 OFFSET 49  -- Keep 50, delete older
  )
);
```

### Ring Buffer Algorithm in TypeScript

```typescript
private async retainLatestN(n: number): Promise<void> {
  // Find the timestamp of the Nth newest comparison
  const nthRow = await this.db.prepare(`
    SELECT ts FROM comparisons
    ORDER BY ts DESC
    LIMIT 1 OFFSET ?
  `).bind(n - 1).first();

  if (!nthRow) {
    // Fewer than N comparisons; nothing to delete
    return;
  }

  // Delete comparisons older than the Nth newest
  await this.db.exec(`
    DELETE FROM comparisons
    WHERE ts < ?
  `, [nthRow.ts]);
}
```

---

## DO Instance Routing

### How Worker Routes to Correct DO Instance

```typescript
// src/api/routes.ts

function computePairKey(leftUrl: string, rightUrl: string): string {
  // Deterministic hash of both URLs
  // Examples:
  //   leftUrl=https://staging.example.com rightUrl=https://prod.example.com
  //   → pairKey = "sha256(staging.example.com|prod.example.com)"

  const combined = [leftUrl, rightUrl].sort().join("|");
  return hashSha256(combined);
}

async function handlePostCompare(request: Request, env: Env): Promise<Response> {
  const { leftUrl, rightUrl } = await request.json();

  // Compute stable pairKey
  const pairKey = computePairKey(leftUrl, rightUrl);

  // Get DO stub for this pair
  // Same pairKey always routes to same DO instance
  const doId = env.ENVPAIR_DO.idFromName(pairKey);
  const stub = env.ENVPAIR_DO.get(doId);

  // Initialize comparison
  const { comparisonId } = await stub.createComparison(leftUrl, rightUrl);

  // Later, when Worker polls, it extracts pairKey from comparisonId
  // comparisonId = "${pairKey}:${uuid}"
  return Response.json({ comparisonId }, { status: 201 });
}

async function handleGetCompareStatus(
  request: Request,
  env: Env,
  comparisonId: string
): Promise<Response> {
  // Extract pairKey from comparisonId prefix
  const pairKey = comparisonId.split(':')[0];

  // Route to correct DO using same pairKey
  const doId = env.ENVPAIR_DO.idFromName(pairKey);
  const stub = env.ENVPAIR_DO.get(doId);

  // Fetch state
  const state = await stub.getComparison(comparisonId);
  return Response.json(state, { status: 200 });
}
```

**Why This Works:**
1. `computePairKey(leftUrl, rightUrl)` is deterministic
2. Same URLs always hash to same pairKey
3. Same pairKey always routes to same DO instance (via `idFromName`)
4. DO stores all comparisons for a pair
5. comparisonId encodes pairKey as prefix for stateless routing

---

## Key Properties

### Deterministic Routing

| Input | pairKey | DO Instance | Comparisons Stored |
|-------|---------|-------------|-------------------|
| A vs B | hash(A\|B) | DO#1 | {uuid1, uuid2, ...} |
| A vs B | hash(A\|B) | DO#1 | {uuid1, uuid2, ...} |
| B vs A | hash(A\|B) | DO#1 | {uuid1, uuid2, ...} |
| A vs C | hash(A\|C) | DO#2 | {uuid3, uuid4, ...} |

Same pair → same DO instance → shared history & ring buffer

### Idempotent Probe Storage

| Retry | comparisonId | side | Probe ID | Action | Result |
|-------|--------------|------|----------|--------|--------|
| 1 | uuid1 | left | uuid1:left | INSERT | ✓ New row |
| 2 | uuid1 | left | uuid1:left | INSERT OR REPLACE | ✓ Update existing |
| 3 | uuid1 | left | uuid1:left | INSERT OR REPLACE | ✓ Update existing |

Same probe ID → updates existing row (no duplicates)

---

## Migration & Deployment

### Step-by-Step

1. **Create SQLite migrations**
   ```bash
   mkdir -p migrations
   # migrations/20250115_create_schema.sql
   # Contains CREATE TABLE statements
   ```

2. **Configure wrangler.toml**
   ```toml
   [durable_objects]
   bindings = [{ name = "ENVPAIR_DO", class_name = "EnvPairDO" }]

   [[d1_databases]]
   binding = "ENVPAIR_DB"
   database_name = "envpair_comparisons"

   [[migrations]]
   tag = "v1"
   new_classes = ["EnvPairDO"]
   ```

3. **Apply migrations locally**
   ```bash
   wrangler migrations apply --local
   ```

4. **Test locally**
   ```bash
   wrangler dev
   curl http://localhost:8787/api/health
   ```

5. **Deploy to production**
   ```bash
   wrangler publish
   wrangler migrations apply --remote
   ```

---

## Next Steps (Phase B5+)

- **Phase B5:** Integrate LLM explanation layer
- **Phase B6:** Wire Workflow orchestration end-to-end
- **Phase B7:** Expose public API endpoints
- **Phase B8:** Hardening, validation, error handling

---

## References

- **Cloudflare Durable Objects:** https://developers.cloudflare.com/durable-objects/
- **Cloudflare D1:** https://developers.cloudflare.com/d1/
- **Cloudflare Workflows:** https://developers.cloudflare.com/workflows/
- **CLAUDE.md:** Section 2.3 (DO Contracts) and 2.2 (Workflow Idempotency)
