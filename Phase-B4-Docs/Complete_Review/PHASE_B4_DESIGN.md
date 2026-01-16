# Phase B4 Design Document: Durable Object (SQLite) + Ring Buffer Retention

## Overview

Phase B4 introduces persistent state management through **Cloudflare Durable Objects (DO)** backed by SQLite. This is a critical phase that bridges the stateless Worker/Workflow layer with durable comparison history.

**Status:** Not yet implemented
**Dependencies completed:**
- ✅ Phase B0: Worker bootstrap + routing
- ✅ Phase B1: Type contracts (SignalEnvelope, EnvDiff)
- ✅ Phase B2: Deterministic diff engine
- ✅ Phase B3: ActiveProbeProvider (HTTP probes with manual redirects)

---

## Architecture Overview

### Key Principles

1. **One DO Instance Per Environment Pair**
   - Keyed by `pairKey` (stable hash of left + right URLs)
   - All comparisons for the same pair route to the same DO instance
   - Enables historical context and bounded retention

2. **SQLite as State Store**
   - Comparisons table: tracks all comparison runs
   - Probes table: stores raw HTTP probe results
   - Ring buffer: auto-deletes oldest N comparisons to prevent quota exhaustion

3. **Idempotent DO Methods**
   - All methods designed for automatic Workflow retry safety
   - Probe IDs use deterministic format: `${comparisonId}:${side}`
   - UNIQUE constraint on (comparison_id, side) prevents duplicates on retry

4. **No Workflow State Polling**
   - Worker never reads Workflow state directly
   - Worker polls DO state, which is authoritative
   - Keeps Worker stateless and enables horizontal scaling

---

## SQLite Schema

### Table: `comparisons`

Stores one row per comparison run.

```sql
CREATE TABLE comparisons (
  id TEXT PRIMARY KEY,              -- Stable format: ${pairKey}:${uuid}
  ts INTEGER NOT NULL,              -- Unix timestamp (ms) when created
  left_url TEXT NOT NULL,           -- Left environment URL
  right_url TEXT NOT NULL,          -- Right environment URL
  status TEXT NOT NULL DEFAULT 'running',  -- 'running' | 'completed' | 'failed'
  result_json TEXT,                 -- Final result (JSON string), null if not complete
  error TEXT,                       -- Error message if status='failed'

  CONSTRAINT status_check CHECK (status IN ('running', 'completed', 'failed'))
);

CREATE INDEX idx_comparisons_ts ON comparisons(ts DESC);
CREATE INDEX idx_comparisons_status ON comparisons(status);
```

**Invariants:**
- `id` is globally unique (includes pairKey prefix for routing)
- `ts` is immutable (creation time, never updated)
- `status` transitions: running → (completed | failed)
- `result_json` is only populated when status='completed'
- `error` is only populated when status='failed'

---

### Table: `probes`

Stores raw HTTP probe results from ActiveProbeProvider.

```sql
CREATE TABLE probes (
  id TEXT PRIMARY KEY,              -- Deterministic: ${comparisonId}:${side}
  comparison_id TEXT NOT NULL,      -- Foreign key to comparisons.id
  ts INTEGER NOT NULL,              -- Timestamp of probe execution
  side TEXT NOT NULL,               -- 'left' | 'right'
  url TEXT NOT NULL,                -- The URL that was probed
  envelope_json TEXT NOT NULL,      -- Full SignalEnvelope as JSON string

  UNIQUE(comparison_id, side),      -- Enforce single probe per side per comparison
  CONSTRAINT side_check CHECK (side IN ('left', 'right')),
  FOREIGN KEY (comparison_id) REFERENCES comparisons(id) ON DELETE CASCADE
);

CREATE INDEX idx_probes_comparison ON probes(comparison_id);
CREATE INDEX idx_probes_side ON probes(side);
```

**Invariants:**
- `id` format is deterministic (enables idempotent retries)
- UNIQUE constraint on (comparison_id, side) enforces one probe per side
- `envelope_json` is the raw SignalEnvelope from provider
- ON DELETE CASCADE ensures probe cleanup when comparison is deleted

---

## Ring Buffer Retention

### Algorithm

Keep the last **N comparisons** (default: N=50) per DO instance.

On every `insert` or `update` to `comparisons`:

```typescript
// 1. Insert/update the new comparison
INSERT INTO comparisons (id, ts, left_url, right_url, status, ...)
  VALUES (...)
  ON CONFLICT(id) DO UPDATE SET status=..., result_json=..., error=...

// 2. Delete oldest rows beyond N
DELETE FROM comparisons
WHERE ts < (
  SELECT ts FROM comparisons
  ORDER BY ts DESC
  LIMIT 1 OFFSET ?  -- ? = N-1 (keep last N rows)
)
```

**Properties:**
- Synchronous: no background jobs needed
- Bounded storage: DO storage quota protected
- Automatic: no manual triggers
- Configurable: N can be adjusted without schema migration

**Example with N=50:**
- Store: comparisons 1, 2, ..., 50 (newest at 50)
- Insert comparison 51:
  - Save comparison 51
  - Delete comparison 1 (oldest)
  - Store: comparisons 2, 3, ..., 51 (newest at 51)

---

## DO Methods (Public API)

### 1. `createComparison(leftUrl: string, rightUrl: string): { comparisonId: string, status: "running" }`

Initialize a new comparison run.

**Signature:**
```typescript
async createComparison(leftUrl: string, rightUrl: string): Promise<{
  comparisonId: string;
  status: "running";
}>;
```

**Implementation:**
```typescript
const comparisonId = `${this.pairKey}:${crypto.randomUUID()}`;
const now = Date.now();

// Insert into comparisons table
await this.db.exec(`
  INSERT INTO comparisons (id, ts, left_url, right_url, status)
  VALUES (?, ?, ?, ?, 'running')
`, [comparisonId, now, leftUrl, rightUrl]);

// Apply ring buffer retention
await this.retainLatestN(50);

return { comparisonId, status: "running" };
```

**Idempotency:**
- ID is deterministic for given pairKey + UUID
- Workflow generates stable UUID → always same comparisonId for retry
- If retry runs, INSERT fails with UNIQUE constraint
- Caller handles: check existing record or use INSERT OR REPLACE

---

### 2. `saveProbe(comparisonId: string, side: "left" | "right", envelope: SignalEnvelope): Promise<void>`

Persist one HTTP probe result.

**Signature:**
```typescript
async saveProbe(
  comparisonId: string,
  side: "left" | "right",
  envelope: SignalEnvelope
): Promise<void>;
```

**Implementation:**
```typescript
const probeId = `${comparisonId}:${side}`;
const now = Date.now();

// INSERT OR REPLACE ensures idempotent retry
await this.db.exec(`
  INSERT OR REPLACE INTO probes (id, comparison_id, ts, side, url, envelope_json)
  VALUES (?, ?, ?, ?, ?, json(?))
`, [probeId, comparisonId, now, side, envelope.routing.final_url, JSON.stringify(envelope)]);
```

**Idempotency:**
- Probe ID is stable: `${comparisonId}:${side}`
- UNIQUE constraint on (comparison_id, side) forces replacement
- Retry with same inputs → UPDATE, not INSERT duplicate
- Envelope is fully serialized for later retrieval

---

### 3. `saveResult(comparisonId: string, resultJson: unknown): Promise<void>`

Finalize a completed comparison with LLM result.

**Signature:**
```typescript
async saveResult(comparisonId: string, resultJson: unknown): Promise<void>;
```

**Implementation:**
```typescript
await this.db.exec(`
  UPDATE comparisons
  SET status = 'completed', result_json = json(?)
  WHERE id = ?
`, [JSON.stringify(resultJson), comparisonId]);
```

**Idempotency:**
- UPDATE is idempotent (same inputs → no-op if already updated)
- Result can be re-saved; last write wins

---

### 4. `failComparison(comparisonId: string, error: string): Promise<void>`

Mark comparison as failed with error message.

**Signature:**
```typescript
async failComparison(comparisonId: string, error: string): Promise<void>;
```

**Implementation:**
```typescript
await this.db.exec(`
  UPDATE comparisons
  SET status = 'failed', error = ?
  WHERE id = ?
`, [error, comparisonId]);
```

**Idempotency:**
- Multiple calls with same error → UPDATE succeeds (no-op on retry)
- Error message is overwritten if called with different error (last wins)

---

### 5. `getComparison(comparisonId: string): Promise<ComparisonState>`

Retrieve comparison state (used by Worker for polling).

**Signature:**
```typescript
interface ComparisonState {
  status: "running" | "completed" | "failed";
  result?: unknown;
  error?: string;
}

async getComparison(comparisonId: string): Promise<ComparisonState>;
```

**Implementation:**
```typescript
const row = await this.db.prepare(`
  SELECT status, result_json, error
  FROM comparisons
  WHERE id = ?
`).bind(comparisonId).first();

if (!row) {
  return { status: "running" }; // Not found; assume still running
}

const result: ComparisonState = { status: row.status };
if (row.result_json) result.result = JSON.parse(row.result_json);
if (row.error) result.error = row.error;

return result;
```

---

### 6. `getComparisonsForHistory(limit: number = 10): Promise<ComparisonState[]>`

Fetch recent completed comparisons for LLM context.

**Signature:**
```typescript
async getComparisonsForHistory(limit: number = 10): Promise<ComparisonState[]>;
```

**Implementation:**
```typescript
const rows = await this.db.prepare(`
  SELECT id, status, result_json, error
  FROM comparisons
  WHERE status = 'completed'
  ORDER BY ts DESC
  LIMIT ?
`).bind(limit).all();

return rows.map(row => {
  const state: ComparisonState = { status: row.status };
  if (row.result_json) state.result = JSON.parse(row.result_json);
  if (row.error) state.error = row.error;
  return state;
});
```

---

## Class Structure

```typescript
// src/storage/envPairDO.ts

import type { SignalEnvelope } from "../shared/signal";

export interface ComparisonState {
  status: "running" | "completed" | "failed";
  result?: unknown;
  error?: string;
}

export class EnvPairDO {
  private pairKey: string;  // stable identifier for this DO instance
  private db: D1Database;   // SQLite database binding

  constructor(state: DurableObjectState, env: Env) {
    this.db = env.ENVPAIR_DB;
    this.pairKey = state.id.name;  // state.id.name is the pairKey
  }

  async createComparison(
    leftUrl: string,
    rightUrl: string
  ): Promise<{ comparisonId: string; status: "running" }> {
    // Implementation...
  }

  async saveProbe(
    comparisonId: string,
    side: "left" | "right",
    envelope: SignalEnvelope
  ): Promise<void> {
    // Implementation...
  }

  async saveResult(comparisonId: string, resultJson: unknown): Promise<void> {
    // Implementation...
  }

  async failComparison(comparisonId: string, error: string): Promise<void> {
    // Implementation...
  }

  async getComparison(comparisonId: string): Promise<ComparisonState> {
    // Implementation...
  }

  async getComparisonsForHistory(limit: number = 10): Promise<ComparisonState[]> {
    // Implementation...
  }

  private async retainLatestN(n: number): Promise<void> {
    // Ring buffer cleanup
  }
}

export default EnvPairDO;
```

---

## Wrangler Configuration

### wrangler.toml Updates

```toml
# Existing...
name = "cf_ai_env_drift_analyzer"
main = "src/worker.ts"
compatibility_date = "2025-01-01"

# Add Durable Objects bindings
[durable_objects]
bindings = [
  { name = "ENVPAIR_DO", class_name = "EnvPairDO", script_name = "cf_ai_env_drift_analyzer" }
]

# Add D1 database binding
[[d1_databases]]
binding = "ENVPAIR_DB"
database_name = "envpair_comparisons"
database_id = "your-database-id-here"

# Migrations
[[migrations]]
tag = "v1"
new_classes = ["EnvPairDO"]
```

---

## Data Flow: Worker → DO → Workflow

### Step 1: Worker Initiates Comparison

```typescript
// src/api/routes.ts
async function handlePostCompare(request: Request, env: Env): Promise<Response> {
  const body = await request.json();
  const { leftUrl, rightUrl } = body;

  // Validate inputs (SSRF protection, etc.)
  validateUrls(leftUrl, rightUrl);

  // Compute pairKey from URLs
  const pairKey = computePairKey(leftUrl, rightUrl);

  // Get or create DO stub for this pair
  const stub = env.ENVPAIR_DO.get(env.ENVPAIR_DO.idFromName(pairKey));

  // Initialize comparison in DO
  const { comparisonId } = await stub.createComparison(leftUrl, rightUrl);

  // Start Workflow (background)
  const workflowHandle = await env.COMPARE_WORKFLOW.create({
    id: comparisonId,
    params: { comparisonId, leftUrl, rightUrl, pairKey }
  });

  // Return immediately (don't wait for completion)
  return Response.json({ comparisonId }, { status: 201 });
}
```

### Step 2: Worker Polls DO for Status

```typescript
// src/api/routes.ts
async function handleGetCompareStatus(
  request: Request,
  env: Env,
  comparisonId: string
): Promise<Response> {
  // Extract pairKey from comparisonId prefix (before the ':')
  const pairKey = comparisonId.split(':')[0];

  // Get DO stub for this pair
  const stub = env.ENVPAIR_DO.get(env.ENVPAIR_DO.idFromName(pairKey));

  // Fetch authoritative state from DO
  const state = await stub.getComparison(comparisonId);

  // Return state (running/completed/failed)
  return Response.json(state, { status: 200 });
}
```

### Step 3: Workflow Uses DO for Persistence

```typescript
// src/workflows/compareEnvironments.ts
export async function* CompareEnvironments(
  { comparisonId, leftUrl, rightUrl, pairKey }: WorkflowInput,
  step: WorkflowStep,
  env: Env
): AsyncGenerator<unknown, unknown> {
  try {
    // Get DO stub for this pair
    const stub = env.ENVPAIR_DO.get(env.ENVPAIR_DO.idFromName(pairKey));

    // Step 1: Probe left
    const leftEnvelope = await step.do("probeLeft", async () => {
      return activeProbeProvider.probe(leftUrl, cfContext);
    });

    // Step 2: Save left probe to DO (idempotent)
    await step.do("saveLeftProbe", async () => {
      return stub.saveProbe(comparisonId, "left", leftEnvelope);
    });

    // Step 3: Probe right
    const rightEnvelope = await step.do("probeRight", async () => {
      return activeProbeProvider.probe(rightUrl, cfContext);
    });

    // Step 4: Save right probe to DO (idempotent)
    await step.do("saveRightProbe", async () => {
      return stub.saveProbe(comparisonId, "right", rightEnvelope);
    });

    // Step 5: Compute diff deterministically
    const diff = await step.do("computeDiff", async () => {
      return computeDiff(leftEnvelope, rightEnvelope, comparisonId);
    });

    // Step 6: Load history from DO (optional)
    const history = await step.do("loadHistory", async () => {
      return stub.getComparisonsForHistory(5);
    });

    // Step 7: Call LLM with diff + history
    const explanation = await step.do("callLLM", async () => {
      return explainDiff(diff, history);
    });

    // Step 8: Save result to DO
    await step.do("saveResult", async () => {
      return stub.saveResult(comparisonId, {
        diff,
        explanation,
        timestamp: Date.now()
      });
    });

  } catch (error) {
    // Step 9: On failure, mark comparison as failed in DO
    const stub = env.ENVPAIR_DO.get(env.ENVPAIR_DO.idFromName(pairKey));
    await stub.failComparison(comparisonId, String(error));
    throw error;
  }
}
```

---

## Acceptance Criteria

- [x] SQLite schema defined (comparisons + probes tables)
- [x] Ring buffer retention algorithm designed (keep last N=50)
- [x] All DO methods defined and documented
- [x] Idempotency rules specified for Workflow retries
- [ ] EnvPairDO class fully implemented (Phase B4 task)
- [ ] wrangler.toml updated with DO + D1 bindings
- [ ] Integration tests verify:
  - [ ] createComparison returns stable comparisonId
  - [ ] saveProbe handles duplicates correctly (UNIQUE constraint)
  - [ ] Ring buffer deletes oldest after threshold
  - [ ] getComparison returns correct state transitions
  - [ ] Workflow steps can retry safely with DO methods

---

## Key Design Decisions

### 1. One DO Per Pair (Not Per Comparison)

**Why:**
- Comparisons for the same pair share history
- Ring buffer is pair-level, not global
- Enables efficient historical context retrieval
- Stateless Worker: can route any pair to its DO

**Alternative rejected:** One global DO
- Would become hot spot
- No pair-level history isolation
- Harder to reason about retention

---

### 2. Deterministic Probe IDs

**Why:**
- `${comparisonId}:${side}` format
- Enables idempotent retries without duplicates
- UNIQUE constraint on (comparison_id, side) is enforced at schema level
- No need for application-level deduplication

**Example:**
- Workflow retries step 4 (saveLeftProbe)
- Same comparisonId + side → same probe ID
- INSERT OR REPLACE updates existing row
- No duplicate probe records

---

### 3. No Workflow-to-Worker Polling

**Why:**
- Worker polls DO (authoritative source)
- Worker never reads Workflow state directly
- Keeps Worker and Workflow loosely coupled
- Enables Workflow replay/retry without Worker coordination

---

## Testing Strategy

### Unit Tests

1. **Ring Buffer Retention**
   - Insert 60 comparisons, verify 50 retained
   - Oldest rows deleted deterministically
   - Timestamps used for ordering

2. **Probe Idempotency**
   - Call saveProbe twice with same inputs
   - Verify single row in probes table
   - UNIQUE constraint enforces this

3. **Status Transitions**
   - running → completed (saveResult)
   - running → failed (failComparison)
   - All transitions idempotent

### Integration Tests

1. **Comparison Lifecycle**
   - Create comparison
   - Save both probes
   - Mark completed with result
   - Retrieve and verify state

2. **Workflow Retry Simulation**
   - Start comparison
   - Simulate step retry
   - Verify no duplicate probes

---

## Deployment Checklist

- [ ] D1 database created in Cloudflare dashboard
- [ ] Database ID added to wrangler.toml
- [ ] SQLite schema applied via Wrangler migrations
- [ ] EnvPairDO class exported as default
- [ ] DO binding configured in wrangler.toml
- [ ] Local dev: `wrangler dev` runs without errors
- [ ] Schema validated: `wrangler migrations status`
- [ ] Ring buffer tested with manual SQL queries

---

## References

- **CLAUDE.md**: Section 2.3 (Durable Objects) and 2.2 (Workflow Idempotency)
- **MVP_Tracker.md**: Phase B4 tasks and acceptance criteria
- **Cloudflare Docs**: [Durable Objects](https://developers.cloudflare.com/durable-objects/), [D1 Database](https://developers.cloudflare.com/d1/)
