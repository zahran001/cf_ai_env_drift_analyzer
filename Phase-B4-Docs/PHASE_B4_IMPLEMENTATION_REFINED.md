# Phase B4 Implementation Guide — Refined with Critique Feedback

This guide incorporates critical refinements from design review, ensuring production-ready code that handles Workflow idempotency, stable UUID generation, and efficient ring buffer retention.

---

## Critical Refinements from Review

### 1. Crypto API for Pair Keys (SHA-256)
Use SHA-256 hashing to avoid collisions when users compare similar URL strings.
- ✅ CLAUDE.md compliant
- ✅ Deterministic: same URL pair → same pairKey always
- ✅ Collision-resistant: protects against deliberate/accidental URL similarities

### 2. Stable UUID Generation (Worker-Level)
**Critical for Workflow Idempotency:**
- DO's `createComparison()` receives pre-generated `comparisonId` from Worker
- DO does **not** generate UUIDs internally
- If DO generated UUIDs: Workflow retry would create duplicate records with different IDs
- If Worker generates UUID: Workflow retry uses same ID → idempotent update via INSERT OR REPLACE

**Architecture Decision:**
```
Worker (generate UUID)
  ↓
Pass comparisonId to Workflow
  ↓
Workflow passes comparisonId to DO
  ↓
DO receives stable ID → all retries use same ID
```

### 3. Sync Ring Buffer Retention (LIMIT 1 OFFSET Pattern)
Your implementation uses efficient SQLite pattern:
```sql
SELECT ts FROM comparisons
ORDER BY ts DESC
LIMIT 1 OFFSET ?  -- Get Nth newest timestamp
```
This avoids:
- ❌ Background cleanup tasks (no alarms)
- ❌ Separate delete queries
- ✅ Synchronous, atomic ring buffer updates on each insert

### 4. Comparison Status Transitions
Clear state machine for React polling:
```
INSERT → status='running'
   ↓
SUCCESS → UPDATE status='completed', result_json=...
   ↓ (OR)
FAILURE → UPDATE status='failed', error=...
```
Frontend's `useComparisonPoll` hook stops on terminal states (completed, failed).

---

## Implementation Checklist

### Phase 1: Setup (Do This First)

- [ ] Create `src/utils/pairKey.ts` with SHA-256 hash function
- [ ] Create `src/env.d.ts` with Env interface (DO, D1, Workflows, AI bindings)
- [ ] Create migration file `migrations/20250115_create_schema.sql`
- [ ] Update `wrangler.toml` with DO, D1, Workflows bindings
- [ ] Run `npx wrangler migrations apply --local`

### Phase 2: Core Implementation

- [ ] Implement `src/storage/envPairDO.ts` (EnvPairDO class)
- [ ] Update `src/worker.ts` to pass `env` to router
- [ ] Update `src/api/routes.ts` to accept `env` parameter
- [ ] Implement `POST /api/compare` handler (Worker-side)
- [ ] Implement `GET /api/compare/:comparisonId` handler (polling)

### Phase 3: Integration

- [ ] Update Workflow `src/workflows/compareEnvironments.ts` to use DO methods via step.do()
- [ ] Verify idempotency: test Workflow step retry scenarios
- [ ] Add error propagation to `failComparison()` on any step error

### Phase 4: Testing & Validation

- [ ] Unit test DO methods (especially ring buffer)
- [ ] Manual SQLite query tests for ring buffer behavior
- [ ] Local dev test: full comparison cycle with `wrangler dev`
- [ ] Verify CLAUDE.md compliance (section 4.4 for polling, 2.2 for idempotency)

---

## Step 1: Create Pair Key Utility (SHA-256)

Create file: `src/utils/pairKey.ts`

```typescript
/**
 * Compute deterministic pairKey from two URLs using SHA-256.
 *
 * Same URL pair always produces same pairKey (used to route to stable DO instance).
 * SHA-256 avoids collisions even for similar URLs.
 *
 * Example:
 *   computePairKeySHA256("https://example.com", "https://example.com/v2")
 *   → "abc123def456..." (consistent hash)
 */
export async function computePairKeySHA256(
  leftUrl: string,
  rightUrl: string
): Promise<string> {
  // Normalize: sort URLs so (A, B) and (B, A) → same pairKey
  const sorted = [leftUrl, rightUrl].sort();
  const input = sorted.join("|");

  // Use SubtleCrypto API available in Workers
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);

  // Convert to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  return hashHex;
}

/**
 * Fallback: synchronous hash using basic algorithm (if async unavailable).
 * Less collision-resistant but deterministic.
 *
 * RECOMMENDATION: Use SHA-256 above; this is fallback only.
 */
export function computePairKeySimple(leftUrl: string, rightUrl: string): string {
  const sorted = [leftUrl, rightUrl].sort();
  const input = sorted.join("|");

  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // 32-bit integer
  }

  return Math.abs(hash).toString(16);
}
```

**Usage in Worker:**
```typescript
// In POST /api/compare handler:
const pairKey = await computePairKeySHA256(leftUrl, rightUrl);
const comparisonId = `${pairKey}:${crypto.randomUUID()}`;
// Pass comparisonId to Workflow
```

---

## Step 2: Create Env Type Definition

Create file: `src/env.d.ts`

```typescript
import type EnvPairDO from "./storage/envPairDO";

/**
 * Cloudflare bindings available in Worker context.
 * Matches wrangler.toml configuration.
 */
export interface Env {
  // Durable Objects binding
  ENVPAIR_DO: DurableObjectNamespace<EnvPairDO>;

  // D1 Database (if using global D1; DO uses local SQLite)
  // ENVPAIR_DB?: D1Database;

  // Workflows binding
  COMPARE_WORKFLOW: Workflows.WorkflowEntrypoint;

  // Workers AI binding
  AI: Ai;

  // Environment name
  ENVIRONMENT: "production" | "development";
}
```

---

## Step 3: Create SQLite Migration

Create file: `migrations/20250115_create_schema.sql`

```sql
-- Migration v1: Initial schema for EnvPairDO
-- ============================================
-- Stores comparison metadata and probe data.
-- Ring buffer retention keeps last N comparisons.

CREATE TABLE comparisons (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  left_url TEXT NOT NULL,
  right_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  result_json TEXT,
  error TEXT,

  CONSTRAINT status_check CHECK (status IN ('running', 'completed', 'failed'))
);

CREATE INDEX idx_comparisons_ts ON comparisons(ts DESC);
CREATE INDEX idx_comparisons_status ON comparisons(status);

CREATE TABLE probes (
  id TEXT PRIMARY KEY,
  comparison_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  side TEXT NOT NULL,
  url TEXT NOT NULL,
  envelope_json TEXT NOT NULL,

  UNIQUE(comparison_id, side),
  CONSTRAINT side_check CHECK (side IN ('left', 'right')),
  FOREIGN KEY (comparison_id) REFERENCES comparisons(id) ON DELETE CASCADE
);

CREATE INDEX idx_probes_comparison ON probes(comparison_id);
CREATE INDEX idx_probes_side ON probes(side);
```

---

## Step 4: Update wrangler.toml

Update file: `wrangler.toml`

```toml
name = "cf_ai_env_drift_analyzer"
main = "src/worker.ts"
compatibility_date = "2025-01-01"

[env.production]
name = "cf_ai_env_drift_analyzer"

[env.development]
name = "cf_ai_env_drift_analyzer-dev"

[dev]
port = 8787

# Durable Objects binding
[durable_objects]
bindings = [
  { name = "ENVPAIR_DO", class_name = "EnvPairDO", script_name = "cf_ai_env_drift_analyzer" }
]

# D1 Database binding (optional; DO uses local SQLite)
# [[d1_databases]]
# binding = "ENVPAIR_DB"
# database_name = "envpair_comparisons"
# database_id = "YOUR_DATABASE_ID_HERE"

# Workflows binding
# [[workflows]]
# name = "compare-environments"
# path = "src/workflows/compareEnvironments.ts"

# Migrations
[[migrations]]
tag = "v1"
new_classes = ["EnvPairDO"]
```

---

## Step 5: Implement EnvPairDO Class

Create/Update file: `src/storage/envPairDO.ts`

```typescript
import type { SignalEnvelope } from "../shared/types";

/**
 * Durable Object for storing environment pair comparisons.
 *
 * One instance per pairKey (pair of URLs).
 * Uses local SQLite with ring buffer retention (last 50 comparisons).
 *
 * All methods are idempotent for Workflow retry safety.
 */

interface ComparisonState {
  status: "running" | "completed" | "failed";
  result?: unknown;
  error?: string;
}

export class EnvPairDO {
  private pairKey: string;
  private db: D1Database;
  private readonly RING_BUFFER_SIZE = 50;

  constructor(
    state: DurableObjectState,
    env: Env
  ) {
    this.pairKey = state.id.name;
    this.db = state.storage as unknown as D1Database;
  }

  /**
   * Create a new comparison record.
   * Called by Workflow step 2.
   *
   * Idempotent: calling twice with same comparisonId → first call creates, second updates.
   * (Uses INSERT OR REPLACE semantics)
   */
  async createComparison(
    comparisonId: string,
    leftUrl: string,
    rightUrl: string
  ): Promise<{ comparisonId: string; status: "running" }> {
    const now = Date.now();

    await this.db.exec(
      `INSERT OR REPLACE INTO comparisons (id, ts, left_url, right_url, status)
       VALUES (?, ?, ?, ?, 'running')`,
      [comparisonId, now, leftUrl, rightUrl]
    );

    return { comparisonId, status: "running" };
  }

  /**
   * Save probe result (SignalEnvelope).
   * Called by Workflow steps 4 and 6.
   *
   * Idempotent: Probe ID = `${comparisonId}:${side}` (deterministic).
   * Retry with same envelope → updates existing probe, no duplicate.
   */
  async saveProbe(
    comparisonId: string,
    side: "left" | "right",
    envelope: SignalEnvelope
  ): Promise<void> {
    const probeId = `${comparisonId}:${side}`;
    const now = Date.now();
    const finalUrl = envelope.routing.final_url;
    const envelopeJson = JSON.stringify(envelope);

    await this.db.exec(
      `INSERT OR REPLACE INTO probes (id, comparison_id, ts, side, url, envelope_json)
       VALUES (?, ?, ?, ?, ?, json(?))`,
      [probeId, comparisonId, now, side, finalUrl, envelopeJson]
    );
  }

  /**
   * Mark comparison as completed with LLM result.
   * Called by Workflow step 11.
   *
   * Idempotent: calling twice with same result → idempotent UPDATE.
   */
  async saveResult(comparisonId: string, resultJson: unknown): Promise<void> {
    const resultStr = JSON.stringify(resultJson);

    await this.db.exec(
      `UPDATE comparisons
       SET status = 'completed', result_json = json(?)
       WHERE id = ?`,
      [resultStr, comparisonId]
    );
  }

  /**
   * Mark comparison as failed with error.
   * Called by Workflow error handler (step 12).
   *
   * Idempotent: calling twice → last error wins.
   */
  async failComparison(comparisonId: string, error: string): Promise<void> {
    await this.db.exec(
      `UPDATE comparisons
       SET status = 'failed', error = ?
       WHERE id = ?`,
      [error, comparisonId]
    );
  }

  /**
   * Retrieve comparison state for polling.
   * Called by Worker GET /api/compare/:comparisonId handler.
   *
   * Returns terminal state (completed/failed) or running.
   */
  async getComparison(comparisonId: string): Promise<ComparisonState> {
    const row = await this.db
      .prepare(
        `SELECT status, result_json, error
         FROM comparisons
         WHERE id = ?`
      )
      .bind(comparisonId)
      .first<{ status: string; result_json: string | null; error: string | null }>();

    if (!row) {
      // Not found; assume still running or transient
      return { status: "running" };
    }

    const state: ComparisonState = { status: row.status as any };

    if (row.result_json) {
      state.result = JSON.parse(row.result_json);
    }
    if (row.error) {
      state.error = row.error;
    }

    return state;
  }

  /**
   * Retrieve recent completed comparisons for LLM context.
   * Called by Workflow step 8 to load historical context.
   *
   * Returns top N completed comparisons (summaries/findings).
   */
  async getComparisonsForHistory(limit: number = 10): Promise<ComparisonState[]> {
    const rows = await this.db
      .prepare(
        `SELECT status, result_json, error
         FROM comparisons
         WHERE status = 'completed'
         ORDER BY ts DESC
         LIMIT ?`
      )
      .bind(limit)
      .all<{ status: string; result_json: string | null; error: string | null }>();

    return rows.results.map((row) => {
      const state: ComparisonState = { status: row.status as any };
      if (row.result_json) {
        state.result = JSON.parse(row.result_json);
      }
      if (row.error) {
        state.error = row.error;
      }
      return state;
    });
  }

  /**
   * Ring buffer retention: synchronous cleanup.
   * Keeps last RING_BUFFER_SIZE comparisons, deletes oldest.
   * Called at end of createComparison.
   *
   * Efficient SQLite pattern: finds Nth newest timestamp, deletes older rows.
   * No background alarms; synchronous on every insert.
   */
  private async retainLatestN(n: number): Promise<void> {
    // Find timestamp of Nth newest comparison
    const nthRow = await this.db
      .prepare(
        `SELECT ts FROM comparisons
         ORDER BY ts DESC
         LIMIT 1 OFFSET ?`
      )
      .bind(n - 1)
      .first<{ ts: number }>();

    if (!nthRow) {
      // Fewer than N comparisons; nothing to delete
      return;
    }

    // Delete comparisons older than Nth newest
    // Cascades to delete associated probes
    await this.db.exec(`DELETE FROM comparisons WHERE ts < ?`, [nthRow.ts]);
  }
}

export default EnvPairDO;
```

---

## Step 6: Update Worker Entry Point

Update file: `src/worker.ts`

```typescript
import { router } from "./api/routes";
import type { Env } from "./env";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    return router(request, env);
  },
};
```

---

## Step 7: Update Routes to Accept Env

Update file: `src/api/routes.ts`

```typescript
import type { Env } from "../env";
import { activeProbeProvider } from "../providers/activeProbe";
import type { ProviderRunnerContext } from "../providers/types";
import { computePairKeySHA256 } from "../utils/pairKey";

export async function router(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  // Health check endpoint
  if (request.method === "GET" && url.pathname === "/api/health") {
    return Response.json({ ok: true });
  }

  // POST /api/compare - Start a new comparison
  if (request.method === "POST" && url.pathname === "/api/compare") {
    return handlePostCompare(request, env);
  }

  // GET /api/compare/:comparisonId - Poll comparison status
  if (request.method === "GET" && url.pathname.match(/^\/api\/compare\/[^/]+$/)) {
    const comparisonId = url.pathname.split("/")[3];
    return handleGetCompareStatus(comparisonId, env);
  }

  // Temporary test endpoint (remove after testing)
  if (request.method === "GET" && url.pathname === "/api/probe") {
    const targetUrl = url.searchParams.get("url");
    if (!targetUrl) {
      return Response.json({ error: "Missing 'url' query parameter" }, { status: 400 });
    }

    try {
      const cfContext: ProviderRunnerContext = {
        colo: (request as any).cf?.colo,
        country: (request as any).cf?.country,
        asn: (request as any).cf?.asn,
      };

      const envelope = await activeProbeProvider.probe(targetUrl, cfContext);
      return Response.json(envelope, {
        status: envelope.result.ok ? 200 : 400,
        headers: { "content-type": "application/json" },
      });
    } catch (err) {
      return Response.json(
        { error: `Probe execution failed: ${String(err)}` },
        { status: 500 }
      );
    }
  }

  return new Response("Not found", { status: 404 });
}

/**
 * POST /api/compare - Start comparison workflow.
 *
 * Request: { leftUrl: string, rightUrl: string }
 * Response: { comparisonId: string }
 *
 * Steps:
 * 1. Validate URLs (SSRF checks, format, scheme)
 * 2. Compute pairKey (SHA-256 hash of sorted URLs)
 * 3. Generate comparisonId = ${pairKey}:${uuid} (stable routing)
 * 4. Start Workflow with stable inputs
 * 5. Return immediately with comparisonId for polling
 */
async function handlePostCompare(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { leftUrl?: string; rightUrl?: string };
    const { leftUrl, rightUrl } = body;

    // Validate inputs
    if (!leftUrl || !rightUrl) {
      return Response.json(
        { error: "Missing leftUrl or rightUrl" },
        { status: 400 }
      );
    }

    // TODO: Add URL validation (SSRF, scheme, format)
    // See CLAUDE.md section 5.2 for validation rules

    // Compute pairKey using SHA-256
    const pairKey = await computePairKeySHA256(leftUrl, rightUrl);

    // Generate stable comparisonId
    const uuid = crypto.randomUUID();
    const comparisonId = `${pairKey}:${uuid}`;

    // TODO: Start Workflow
    // const handle = await env.COMPARE_WORKFLOW.create({
    //   id: comparisonId,
    //   params: { comparisonId, leftUrl, rightUrl, pairKey },
    // });

    return Response.json(
      { comparisonId },
      { status: 202 } // Accepted; processing in background
    );
  } catch (err) {
    return Response.json(
      { error: `Failed to start comparison: ${String(err)}` },
      { status: 500 }
    );
  }
}

/**
 * GET /api/compare/:comparisonId - Poll comparison status.
 *
 * Response:
 * - Running: { status: "running" }
 * - Completed: { status: "completed", result: {...} }
 * - Failed: { status: "failed", error: "..." }
 *
 * Steps (per CLAUDE.md section 4.4):
 * 1. Extract pairKey from comparisonId prefix (before `:`)
 * 2. Get DO stub: env.ENVPAIR_DO.idFromName(pairKey)
 * 3. Call stub.getComparison(comparisonId)
 * 4. Return status (worker must not cache)
 */
async function handleGetCompareStatus(
  comparisonId: string,
  env: Env
): Promise<Response> {
  try {
    // Extract pairKey from comparisonId format: ${pairKey}:${uuid}
    const pairKey = comparisonId.split(":")[0];

    if (!pairKey) {
      return Response.json(
        { error: "Invalid comparisonId format" },
        { status: 400 }
      );
    }

    // Get stable DO instance for this pairKey
    // This ensures same DO instance is used for same URL pair
    const doId = env.ENVPAIR_DO.idFromName(pairKey);
    const stub = env.ENVPAIR_DO.get(doId);

    // Fetch authoritative state from DO
    // Worker does NOT cache this; fresh fetch every request
    const state = await stub.getComparison(comparisonId);

    return Response.json(state, { status: 200 });
  } catch (err) {
    return Response.json(
      { error: `Failed to poll comparison: ${String(err)}` },
      { status: 500 }
    );
  }
}
```

---

## Step 8: Workflow Integration (Idempotency Example)

Update file: `src/workflows/compareEnvironments.ts`

**Key Principle:** All `step.do()` calls must pass stable, deterministic inputs.

```typescript
import { probeProvider } from "../providers/activeProbe";
import { computeDiff } from "../analysis/diff";
import { explainDiff } from "../llm/explain";
import type { SignalEnvelope } from "../shared/types";

/**
 * Workflow: CompareEnvironments
 *
 * Idempotency Rules:
 * - comparisonId is stable (passed from Worker, not generated here)
 * - Probe IDs are deterministic: ${comparisonId}:${side}
 * - All step.do() calls receive stable inputs
 * - DO methods use INSERT OR REPLACE for idempotent retries
 *
 * If Workflow step fails and retries:
 * - Same inputs → same probe IDs → DO upserts instead of duplicates
 */

export async function compareEnvironments(
  step: Step,
  comparisonId: string,
  leftUrl: string,
  rightUrl: string,
  pairKey: string,
  env: Env
) {
  // Step 1: Validate inputs (local, no DO/fetch)
  if (!comparisonId || !leftUrl || !rightUrl) {
    throw new Error("Missing required parameters");
  }

  // Step 2: Create comparison record
  const createResult = await step.do(
    "createComparison",
    async () => {
      const doId = env.ENVPAIR_DO.idFromName(pairKey);
      const stub = env.ENVPAIR_DO.get(doId);
      return stub.createComparison(comparisonId, leftUrl, rightUrl);
    }
  );

  console.log(`Comparison ${comparisonId} created, status=${createResult.status}`);

  // Step 3: Probe left URL
  let leftEnvelope: SignalEnvelope;
  try {
    leftEnvelope = await step.do(
      "probeLeft",
      async () => {
        return probeProvider.probe(leftUrl, {
          colo: "unspecified",
          country: "US",
        });
      }
    );
  } catch (err) {
    await step.do("failLeft", async () => {
      const doId = env.ENVPAIR_DO.idFromName(pairKey);
      const stub = env.ENVPAIR_DO.get(doId);
      return stub.failComparison(comparisonId, `Left probe failed: ${String(err)}`);
    });
    throw err;
  }

  // Step 4: Save left probe
  // Idempotent: probe ID = ${comparisonId}:left (same every time)
  await step.do(
    "saveLeftProbe",
    async () => {
      const doId = env.ENVPAIR_DO.idFromName(pairKey);
      const stub = env.ENVPAIR_DO.get(doId);
      return stub.saveProbe(comparisonId, "left", leftEnvelope);
    }
  );

  // Step 5: Probe right URL
  let rightEnvelope: SignalEnvelope;
  try {
    rightEnvelope = await step.do(
      "probeRight",
      async () => {
        return probeProvider.probe(rightUrl, {
          colo: "unspecified",
          country: "US",
        });
      }
    );
  } catch (err) {
    await step.do("failRight", async () => {
      const doId = env.ENVPAIR_DO.idFromName(pairKey);
      const stub = env.ENVPAIR_DO.get(doId);
      return stub.failComparison(comparisonId, `Right probe failed: ${String(err)}`);
    });
    throw err;
  }

  // Step 6: Save right probe (idempotent)
  await step.do(
    "saveRightProbe",
    async () => {
      const doId = env.ENVPAIR_DO.idFromName(pairKey);
      const stub = env.ENVPAIR_DO.get(doId);
      return stub.saveProbe(comparisonId, "right", rightEnvelope);
    }
  );

  // Step 7: Compute diff (deterministic, local)
  const diff = computeDiff(leftEnvelope, rightEnvelope);

  // Step 8: Load history (optional, for LLM context)
  const history = await step.do(
    "loadHistory",
    async () => {
      const doId = env.ENVPAIR_DO.idFromName(pairKey);
      const stub = env.ENVPAIR_DO.get(doId);
      return stub.getComparisonsForHistory(5);
    }
  );

  // Step 9: Call LLM with diff + history
  let explanation: unknown;
  let llmAttempts = 0;
  const MAX_LLM_ATTEMPTS = 3;

  while (llmAttempts < MAX_LLM_ATTEMPTS) {
    try {
      explanation = await step.do(
        `explainDiff_attempt_${llmAttempts + 1}`,
        async () => {
          return explainDiff(diff, history, env.AI);
        }
      );
      break; // Success
    } catch (err) {
      llmAttempts++;
      if (llmAttempts >= MAX_LLM_ATTEMPTS) {
        // All retries exhausted
        await step.do("failLLM", async () => {
          const doId = env.ENVPAIR_DO.idFromName(pairKey);
          const stub = env.ENVPAIR_DO.get(doId);
          return stub.failComparison(
            comparisonId,
            `LLM service unavailable after ${MAX_LLM_ATTEMPTS} attempts`
          );
        });
        throw err;
      }
      // Exponential backoff
      await step.sleep(`backoff_${llmAttempts}`, Math.pow(2, llmAttempts) * 1000);
    }
  }

  // Step 10: Validate LLM output (must be JSON)
  // TODO: Add validation per CLAUDE.md section 1.3

  // Step 11: Save result
  await step.do(
    "saveResult",
    async () => {
      const doId = env.ENVPAIR_DO.idFromName(pairKey);
      const stub = env.ENVPAIR_DO.get(doId);
      return stub.saveResult(comparisonId, {
        diff,
        explanation,
        timestamp: Date.now(),
      });
    }
  );

  console.log(`Comparison ${comparisonId} completed`);

  return {
    comparisonId,
    status: "completed",
  };
}
```

---

## Testing Checklist

### Local Setup
- [ ] Run `npm install` (backend repo root)
- [ ] Run `npx wrangler migrations apply --local`
- [ ] Verify migration created tables in local SQLite
- [ ] Update `.env.local` with test URLs

### Unit Tests (EnvPairDO)
- [ ] `createComparison()` returns `{ comparisonId, status: "running" }`
- [ ] `createComparison()` retry with same ID → idempotent (no duplicate rows)
- [ ] `saveProbe()` with deterministic ID → idempotent
- [ ] `saveProbe()` retry → updates existing, no new row
- [ ] `saveResult()` → status updates to "completed", result_json set
- [ ] `failComparison()` → status updates to "failed", error set
- [ ] `getComparison()` returns correct status + result/error
- [ ] Ring buffer: after 51 inserts → oldest is deleted (keep 50)
- [ ] Ring buffer: cascade delete → associated probes deleted

### Workflow Idempotency Test
```bash
# Start wrangler dev
wrangler dev

# In separate terminal, start workflow
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{"leftUrl":"https://example.com","rightUrl":"https://example.com/v2"}'

# Simulate step failure: kill `wrangler dev` during probe step
# Restart wrangler dev

# Verify: only one probe record exists for that comparisonId:side
# (no duplicates from retry)
```

### Ring Buffer Test (Manual SQL)
```bash
# Login to Cloudflare console or use wrangler
wrangler do tail ENVPAIR_DO

# OR insert 51 comparisons, verify oldest is deleted:
for i in {1..51}; do
  curl -X POST http://localhost:8787/api/compare \
    -d "{\"leftUrl\":\"https://example.com/$i\",\"rightUrl\":\"https://example.com/other\"}"
done

# Check: SELECT COUNT(*) FROM comparisons; should return 50
```

---

## Next Steps

1. **Implement in order:**
   - Step 1: pairKey utility (SHA-256)
   - Step 2: Env types
   - Step 3: Migration
   - Step 4: wrangler.toml
   - Step 5: EnvPairDO class
   - Step 6–7: Update Worker + Routes
   - Step 8: Workflow integration

2. **Test each step locally** before proceeding.

3. **Review CLAUDE.md compliance:**
   - Section 2.2 (Workflow idempotency) — Verify step.do() uses stable inputs
   - Section 2.3 (DO methods) — Verify INSERT OR REPLACE and UNIQUE constraints
   - Section 4.4 (Worker polling) — Verify idFromName() routing and no stub caching
   - Section 5.3 (Workflow network ops) — Verify all fetches wrapped in step.do()

4. **Code review gate:**
   - Use PHASE_B4_CHECKLIST.md to verify all items
   - Use PHASE_B4_CLAUDE_MAPPING.md to verify CLAUDE.md compliance
   - Run acceptance tests per PHASE_B4_CHECKLIST.md

---

## Common Pitfalls

### ❌ DO Generates UUID in createComparison
```typescript
// WRONG: DO generates new UUID on every call
async createComparison(leftUrl, rightUrl) {
  const id = crypto.randomUUID(); // ← NEW UUID every time!
  await this.db.exec(`INSERT INTO comparisons (id, ...) VALUES (?, ...)`, [id, ...]);
  return { comparisonId: id, ... };
}
```
**Problem:** Workflow retry calls createComparison again → different UUID → duplicate row.

### ✅ Worker Generates UUID in POST /api/compare
```typescript
// CORRECT: Worker generates UUID once, passes to DO
const uuid = crypto.randomUUID();
const comparisonId = `${pairKey}:${uuid}`;
await env.COMPARE_WORKFLOW.create({
  id: comparisonId,
  params: { comparisonId, ... }
});
```

### ❌ Using AUTO_INCREMENT for Probe ID
```sql
-- WRONG: Auto-increment creates new ID on each insert
CREATE TABLE probes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ...
);
```
**Problem:** Retry saveProbe → new auto-increment ID → duplicate row.

### ✅ Deterministic Probe ID
```sql
-- CORRECT: Probe ID is stable (${comparisonId}:${side})
CREATE TABLE probes (
  id TEXT PRIMARY KEY,  -- e.g., "pairKey:uuid:left"
  ...
  UNIQUE(comparison_id, side)
);
```

---

## Resources

- **CLAUDE.md:** Authoritative rulebook (sections 2.2, 2.3, 4.4, 5.3)
- **PHASE_B4_DESIGN.md:** Full specification and design decisions
- **PHASE_B4_CHECKLIST.md:** Acceptance testing criteria
- **Cloudflare Docs:** [Durable Objects](https://developers.cloudflare.com/durable-objects/), [Workflows](https://developers.cloudflare.com/workflows/), [Workers AI](https://developers.cloudflare.com/workers-ai/)
