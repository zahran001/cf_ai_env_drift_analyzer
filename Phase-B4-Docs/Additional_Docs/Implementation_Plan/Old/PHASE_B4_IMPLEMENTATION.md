# Phase B4 Implementation Guide

## Quick Start Checklist

- [ ] Create SQLite migration file (`migrations/20250115_create_schema.sql`)
- [ ] Implement `EnvPairDO` class in `src/storage/envPairDO.ts`
- [ ] Update `wrangler.toml` with DO and D1 bindings
- [ ] Add env types for Env interface in `src/env.d.ts`
- [ ] Update `src/worker.ts` to pass env to router
- [ ] Update `src/api/routes.ts` to handle env parameter
- [ ] Implement `computePairKey()` utility
- [ ] Write unit tests for DO methods
- [ ] Test locally with `wrangler dev`
- [ ] Test ring buffer with manual SQL queries

---

## Step 1: Create SQLite Migration

Create file: `migrations/20250115_create_schema.sql`

```sql
-- Migration: v1 - Initial schema for EnvPairDO
-- Creates comparisons and probes tables with ring buffer support

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

## Step 2: Update wrangler.toml

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

# D1 Database binding
[[d1_databases]]
binding = "ENVPAIR_DB"
database_name = "envpair_comparisons"
database_id = "YOUR_DATABASE_ID_HERE"  # Replace after creating database

# Migrations
[[migrations]]
tag = "v1"
new_classes = ["EnvPairDO"]
```

---

## Step 3: Create Env Type Definition

Create file: `src/env.d.ts`

```typescript
// src/env.d.ts
export interface Env {
  ENVPAIR_DO: DurableObjectNamespace;
  ENVPAIR_DB: D1Database;
  COMPARE_WORKFLOW?: Workflows.Workflow<any>;  // Added in Phase B6
}

// For Durable Object binding
export interface DurableObjectState {
  id: {
    name: string;
  };
  storage: {
    get(key: string): Promise<any>;
    put(key: string, value: any): Promise<void>;
    delete(key: string): Promise<void>;
  };
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
  abort(): void;
}

// D1 type placeholders (these come from @cloudflare/workers-types)
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  exec(query: string, ...args: any[]): Promise<any>;
  batch<T>(statements: D1PreparedStatement[]): Promise<T[]>;
}

export interface D1PreparedStatement {
  bind(...args: any[]): D1PreparedStatement;
  first<T>(): Promise<T | undefined>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<D1Result>;
}

export interface D1Result {
  success: boolean;
  meta: {
    duration: number;
    changes?: number;
    served_by: string;
  };
}
```

---

## Step 4: Implement EnvPairDO

Create file: `src/storage/envPairDO.ts`

```typescript
import type { D1Database, DurableObjectState } from "../env";
import type { SignalEnvelope } from "../shared/signal";
import type { Env } from "../env";

export interface ComparisonState {
  status: "running" | "completed" | "failed";
  result?: unknown;
  error?: string;
}

export class EnvPairDO {
  private pairKey: string;
  private db: D1Database;
  private readonly RING_BUFFER_SIZE = 50;

  constructor(state: DurableObjectState, env: Env) {
    this.pairKey = state.id.name;
    this.db = env.ENVPAIR_DB;
  }

  /**
   * Create a new comparison record.
   * Returns stable comparisonId for later retrieval.
   */
  async createComparison(
    leftUrl: string,
    rightUrl: string
  ): Promise<{ comparisonId: string; status: "running" }> {
    const comparisonId = `${this.pairKey}:${crypto.randomUUID()}`;
    const now = Date.now();

    await this.db.exec(
      `INSERT INTO comparisons (id, ts, left_url, right_url, status)
       VALUES (?, ?, ?, ?, 'running')`,
      [comparisonId, now, leftUrl, rightUrl]
    );

    await this.retainLatestN(this.RING_BUFFER_SIZE);

    return { comparisonId, status: "running" };
  }

  /**
   * Save a probe result (HTTP response envelope).
   * Uses INSERT OR REPLACE for idempotent retries.
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
   * Mark comparison as completed with result.
   * Idempotent: multiple calls with same result → no-op.
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
   * Mark comparison as failed with error message.
   * Idempotent: multiple calls → last error wins.
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
   * Returns current status and result/error if available.
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
      // Not found in DB; assume still running or transient issue
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
   * Used in Workflow to provide historical context to LLM.
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
   * Ring buffer retention: keep last N comparisons.
   * Deletes oldest rows beyond N to prevent quota exhaustion.
   */
  private async retainLatestN(n: number): Promise<void> {
    // Find the timestamp of the Nth newest comparison
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

    // Delete comparisons older than the Nth newest
    // This cascades to delete associated probes
    await this.db.exec(
      `DELETE FROM comparisons
       WHERE ts < ?`,
      [nthRow.ts]
    );
  }
}

export default EnvPairDO;
```

---

## Step 5: Update Worker Entry Point

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

## Step 6: Update Routes to Accept Env

Update file: `src/api/routes.ts`

```typescript
import type { Env } from "../env";
import { activeProbeProvider } from "../providers/activeProbe";
import type { ProviderRunnerContext } from "../providers/types";
import { computePairKey } from "../utils/pairKey";

export async function router(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/api/health") {
    return Response.json({ ok: true });
  }

  // POST /api/compare - Start a comparison
  if (request.method === "POST" && url.pathname === "/api/compare") {
    return handlePostCompare(request, env);
  }

  // GET /api/compare/:comparisonId - Poll comparison status
  if (request.method === "GET" && url.pathname.match(/^\/api\/compare\/[^/]+$/)) {
    const comparisonId = url.pathname.split("/")[3];
    return handleGetCompareStatus(request, env, comparisonId);
  }

  // Temporary test endpoint for active probe (remove later)
  if (request.method === "GET" && url.pathname === "/api/probe") {
    const targetUrl = url.searchParams.get("url");

    if (!targetUrl) {
      return Response.json(
        { error: "Missing 'url' query parameter" },
        { status: 400 }
      );
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

async function handlePostCompare(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as any;
    const { leftUrl, rightUrl } = body;

    // Validate inputs (basic checks)
    if (!leftUrl || !rightUrl) {
      return Response.json(
        { error: "Missing leftUrl or rightUrl" },
        { status: 400 }
      );
    }

    // TODO: Add SSRF protection, URL validation

    // Compute stable pairKey
    const pairKey = computePairKey(leftUrl, rightUrl);

    // Get DO stub for this pair
    const doId = env.ENVPAIR_DO.idFromName(pairKey);
    const stub = env.ENVPAIR_DO.get(doId);

    // Initialize comparison in DO
    const { comparisonId } = await stub.createComparison(leftUrl, rightUrl);

    // TODO: Start Workflow in Phase B6
    // await env.COMPARE_WORKFLOW.create({
    //   id: comparisonId,
    //   params: { comparisonId, leftUrl, rightUrl, pairKey }
    // });

    return Response.json({ comparisonId }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: `Failed to start comparison: ${String(error)}` },
      { status: 500 }
    );
  }
}

async function handleGetCompareStatus(
  request: Request,
  env: Env,
  comparisonId: string
): Promise<Response> {
  try {
    // Extract pairKey from comparisonId prefix (before the ':')
    const pairKey = comparisonId.split(":")[0];

    // Get DO stub for this pair
    const doId = env.ENVPAIR_DO.idFromName(pairKey);
    const stub = env.ENVPAIR_DO.get(doId);

    // Fetch authoritative state from DO
    const state = await stub.getComparison(comparisonId);

    return Response.json(state, { status: 200 });
  } catch (error) {
    return Response.json(
      { error: `Failed to fetch comparison status: ${String(error)}` },
      { status: 500 }
    );
  }
}
```

---

## Step 7: Implement Pair Key Utility

Create file: `src/utils/pairKey.ts`

```typescript
/**
 * Compute a stable pairKey from two URLs.
 * Same URLs always hash to same key (order-independent).
 */
export function computePairKey(leftUrl: string, rightUrl: string): string {
  // Sort URLs to make key order-independent
  // (A vs B and B vs A should hash to same key)
  const sorted = [leftUrl, rightUrl].sort();
  const combined = sorted.join("|");

  // Simple hash using TextEncoder + Uint8Array
  // In production, use crypto.subtle.digest for stronger hash
  return hashString(combined);
}

/**
 * Simple string hash for deterministic pairing.
 * For MVP, this is sufficient; can upgrade to SHA256 if needed.
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

// Alternative: Stronger hash using crypto API
export async function computePairKeySHA256(
  leftUrl: string,
  rightUrl: string
): Promise<string> {
  const sorted = [leftUrl, rightUrl].sort();
  const combined = sorted.join("|");

  const encoder = new TextEncoder();
  const data = encoder.encode(combined);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);

  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  return hashHex.substring(0, 32); // Use first 32 chars for brevity
}
```

---

## Step 8: Write Unit Tests

Create file: `src/storage/__tests__/envPairDO.test.ts`

```typescript
import { describe, it, expect, beforeEach } from "vitest";

// NOTE: Testing Durable Objects requires mocking D1 database
// This is a simplified example; adapt to your test setup

describe("EnvPairDO", () => {
  // Unit tests for DO methods would go here
  // Requires mocking D1 database and DurableObjectState

  it("should create a comparison with stable ID", () => {
    // Test createComparison returns deterministic comparisonId
  });

  it("should handle probe save idempotently", () => {
    // Test saveProbe with duplicate inputs updates existing row
  });

  it("should enforce ring buffer retention", () => {
    // Test retainLatestN deletes oldest comparisons
  });

  it("should transition status correctly", () => {
    // Test saveResult and failComparison update status
  });

  it("should retrieve comparison state correctly", () => {
    // Test getComparison returns correct state object
  });
});
```

---

## Step 9: Local Testing

### Start Local Development

```bash
# Install dependencies
npm install

# Apply migrations locally
wrangler migrations apply --local

# Start local development server
wrangler dev
```

### Test Endpoints

```bash
# Health check
curl http://localhost:8787/api/health
# Expected: {"ok":true}

# Create comparison
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{"leftUrl":"https://example.com","rightUrl":"https://example.org"}'
# Expected: {"comparisonId":"abc123:def456"}

# Poll comparison status
curl http://localhost:8787/api/compare/abc123:def456
# Expected: {"status":"running"} (until Workflow completes)
```

### Manual SQL Testing

```bash
# Open SQLite console via wrangler
wrangler d1 execute envpair_comparisons --local

# Check comparisons table
SELECT id, ts, status FROM comparisons ORDER BY ts DESC LIMIT 10;

# Check probes for a comparison
SELECT id, side, url FROM probes WHERE comparison_id = 'abc123:def456';

# Verify ring buffer (insert 60 rows, check only 50 remain)
SELECT COUNT(*) FROM comparisons;
```

---

## Step 10: Verify Idempotency

### Simulate Workflow Retry

```bash
# 1. Create comparison
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{"leftUrl":"https://example.com","rightUrl":"https://example.org"}'
# Returns: {"comparisonId":"pair_hash:uuid1"}

# 2. Manually insert probe (simulating step.do())
# Via wrangler d1:
#   INSERT INTO probes (id, comparison_id, ts, side, url, envelope_json)
#   VALUES ("pair_hash:uuid1:left", "pair_hash:uuid1", 1234567890, "left", "https://example.com", '{}');

# 3. Insert same probe again (retry scenario)
# Should update existing row, not create duplicate
#   INSERT OR REPLACE INTO probes (id, comparison_id, ts, side, url, envelope_json)
#   VALUES ("pair_hash:uuid1:left", "pair_hash:uuid1", 1234567890, "left", "https://example.com", '{}');

# 4. Verify single probe row exists
# SELECT COUNT(*) FROM probes WHERE comparison_id = 'pair_hash:uuid1' AND side = 'left';
# Expected: 1
```

---

## Troubleshooting

### Migration Issues

```bash
# Check migration status
wrangler migrations status --local

# Reset and reapply
wrangler d1 execute envpair_comparisons --local < migrations/20250115_create_schema.sql
```

### D1 Database Not Found

Make sure database_id in wrangler.toml matches your Cloudflare D1 database.

```bash
# List available databases
wrangler d1 list

# Create new database if needed
wrangler d1 create envpair_comparisons
```

### DO Binding Errors

Ensure wrangler.toml has correct binding name (ENVPAIR_DO) and class_name (EnvPairDO).

---

## Next Steps

After Phase B4 implementation:

1. **Phase B5:** Integrate LLM explanation (Workers AI)
2. **Phase B6:** Wire Workflow orchestration end-to-end
3. **Phase B7:** Expose public API endpoints
4. **Phase B8:** Hardening and error handling

---

## References

- **Cloudflare Durable Objects:** https://developers.cloudflare.com/durable-objects/
- **Cloudflare D1:** https://developers.cloudflare.com/d1/
- **CLAUDE.md Section 2.3:** Durable Objects contract details
- **PHASE_B4_DESIGN.md:** High-level design and architecture
- **PHASE_B4_ARCHITECTURE.md:** Detailed diagrams and data flow

