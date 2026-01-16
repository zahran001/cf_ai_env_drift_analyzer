# Phase B4 Critical Fixes — Runtime Compatibility & Architecture Decisions

**Status:** Critical issues identified in PHASE_B4_IMPLEMENTATION_REFINED.md that will cause runtime failures.

**Document Purpose:** Resolve architectural decisions and provide corrected implementation code.

---

## Executive Summary

The refined implementation guide mixed two incompatible storage approaches:
1. **DO-Local SQLite** (`state.storage.sql`) with wrangler migrations
2. **D1 Database** (via `env.ENVPAIR_DB` binding)

CLAUDE.md specifies **DO-local SQLite**, but the code attempted to use D1 APIs on a non-D1 object, which will crash at runtime.

**Additional Critical Issues:**
- Missing `retainLatestN()` invocation → ring buffer doesn't execute
- Missing RPC enablement specification → stub.getComparison() calls fail
- Missing type imports → TypeScript compilation fails
- Ambiguous null response → infinite polling or hidden invalid IDs

---

## Decision 1: Storage Backend (DO-Local SQLite vs D1)

### CLAUDE.md Specification (Authoritative)

**Section 2.3:**
> Durable Objects (SQLite-Backed State)
> **One DO instance per environment pair** (`pairKey`).
> **SQLite schema:** [inline schema]
> SQL changes require `npx wrangler migrations apply`

**Section 3.4 (Storage Interface):**
> Files: `src/storage/envPairDO.ts` — DO methods and SQL
> Invariants:
> - Single source of truth for comparison state
> - **SQL changes require `npx wrangler migrations apply`**
> - Ring buffer implementation is synchronous
> - No caching of DO state in Worker memory

**Interpretation:**
- ✅ DO uses **local SQLite** (not D1)
- ✅ Schema changes via wrangler migrations
- ✅ `state.storage.sql` API in DO constructor
- ❌ NOT `env.ENVPAIR_DB` (that's for optional global D1)

### Issue in PHASE_B4_IMPLEMENTATION_REFINED.md

```typescript
// ❌ WRONG: Constructor tries to access env parameter
constructor(state: DurableObjectState, env: Env) {
  this.pairKey = state.id.name;
  this.db = state.storage as unknown as D1Database;  // ← NOT a D1Database!
}

// ❌ WRONG: Code assumes D1 API
await this.db.exec(
  `INSERT OR REPLACE INTO comparisons (id, ts, left_url, right_url, status)
   VALUES (?, ?, ?, ?, 'running')`,
  [comparisonId, now, leftUrl, rightUrl]
);
```

**Why it breaks:**
- `state.storage` is a `StorageArea` object (key-value store) in standard DO
- **With persistent SQLite binding:** `state.storage.sql` returns a `Database` object
- `Database.exec()` doesn't exist; must use `Database.prepare()` + `.run()`
- Constructor doesn't receive `env` parameter; it's only `state: DurableObjectState`

### Decision: Use DO-Local SQLite (state.storage.sql API)

**Rationale:**
- CLAUDE.md explicitly specifies DO-local SQLite, not D1
- Migrations work with `wrangler migrations apply` targeting DO class
- One DO per pairKey provides natural isolation and horizontal scalability
- No external D1 quota to manage; DO ~100MB limit is sufficient for MVP

**Corrected Approach:**

```typescript
import type { SignalEnvelope } from "../shared/types";
import type { Database } from "@cloudflare/workers-types";

interface ComparisonState {
  status: "running" | "completed" | "failed";
  result?: unknown;
  error?: string;
}

export class EnvPairDO {
  private pairKey: string;
  private db: Database;

  constructor(state: DurableObjectState) {
    this.pairKey = state.id.name;
    // ✅ CORRECT: Access DO-local SQLite via state.storage.sql
    this.db = state.storage.sql;
  }

  // ✅ CORRECT: Use Database.prepare() API
  async createComparison(
    comparisonId: string,
    leftUrl: string,
    rightUrl: string
  ): Promise<{ comparisonId: string; status: "running" }> {
    const now = Date.now();

    await this.db
      .prepare(
        `INSERT OR REPLACE INTO comparisons (id, ts, left_url, right_url, status)
         VALUES (?, ?, ?, ?, 'running')`
      )
      .bind(comparisonId, now, leftUrl, rightUrl)
      .run();

    await this.retainLatestN(this.RING_BUFFER_SIZE);

    return { comparisonId, status: "running" };
  }
}
```

---

## Decision 2: Ring Buffer Invocation (Missing retainLatestN Call)

### Issue in PHASE_B4_IMPLEMENTATION_REFINED.md

```typescript
// ❌ WRONG: retainLatestN is defined but NEVER CALLED
private async retainLatestN(n: number): Promise<void> {
  // ... implementation exists ...
}

// ❌ WRONG: createComparison doesn't call it
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
  // ❌ Missing: await this.retainLatestN(this.RING_BUFFER_SIZE);

  return { comparisonId, status: "running" };
}
```

**Consequence:**
- Ring buffer retention **never executes**
- DO storage grows unbounded toward 100MB quota
- Old comparisons are never deleted
- Ring buffer tests will fail

### Fix: Invoke retainLatestN at End of Each Write

Call `retainLatestN()` after each INSERT/UPDATE that modifies comparisons:

```typescript
async createComparison(
  comparisonId: string,
  leftUrl: string,
  rightUrl: string
): Promise<{ comparisonId: string; status: "running" }> {
  const now = Date.now();

  await this.db
    .prepare(
      `INSERT OR REPLACE INTO comparisons (id, ts, left_url, right_url, status)
       VALUES (?, ?, ?, ?, 'running')`
    )
    .bind(comparisonId, now, leftUrl, rightUrl)
    .run();

  // ✅ CORRECT: Invoke ring buffer cleanup after insert
  await this.retainLatestN(this.RING_BUFFER_SIZE);

  return { comparisonId, status: "running" };
}

async saveResult(comparisonId: string, resultJson: unknown): Promise<void> {
  const resultStr = JSON.stringify(resultJson);

  await this.db
    .prepare(
      `UPDATE comparisons
       SET status = 'completed', result_json = json(?)
       WHERE id = ?`
    )
    .bind(resultStr, comparisonId)
    .run();

  // ✅ Ring buffer cleanup (not needed on UPDATE, but idempotent)
  // Uncomment if you want to trigger cleanup on every state change
  // await this.retainLatestN(this.RING_BUFFER_SIZE);
}

async failComparison(comparisonId: string, error: string): Promise<void> {
  await this.db
    .prepare(
      `UPDATE comparisons
       SET status = 'failed', error = ?
       WHERE id = ?`
    )
    .bind(error, comparisonId)
    .run();

  // ✅ Ring buffer cleanup (not needed on UPDATE)
  // await this.retainLatestN(this.RING_BUFFER_SIZE);
}
```

**Decision:** Call `retainLatestN()` only in `createComparison()` (before returning).
- Rationale: Ring buffer logic is "keep last N **comparisons**"
- Only `INSERT INTO comparisons` changes the count
- `UPDATE` operations don't change count (no cleanup needed)
- Synchronous cleanup prevents quota exhaustion

---

## Decision 3: Durable Object RPC vs HTTP Router

### Issue in PHASE_B4_IMPLEMENTATION_REFINED.md

```typescript
// This line assumes DO RPC is enabled:
const state = await stub.getComparison(comparisonId);
```

**Problem:** DO RPC is **not the default** in Cloudflare. Without explicit enablement in wrangler.toml:
- `stub.getComparison()` throws: `TypeError: stub.getComparison is not a function`
- Must use `stub.fetch()` + HTTP router instead, OR
- Enable RPC in wrangler.toml (newer feature, requires opt-in)

### Two Approaches

#### Approach A: DO RPC (Modern, Simpler)

**Requires:** wrangler.toml configuration

```toml
[durable_objects]
bindings = [
  {
    name = "ENVPAIR_DO",
    class_name = "EnvPairDO",
    script_name = "cf_ai_env_drift_analyzer",
    rpc = true  # ← ENABLE RPC
  }
]
```

**Code (Workflow step):**
```typescript
const doId = env.ENVPAIR_DO.idFromName(pairKey);
const stub = env.ENVPAIR_DO.get(doId);

// ✅ Works with RPC enabled
await stub.createComparison(comparisonId, leftUrl, rightUrl);
const state = await stub.getComparison(comparisonId);
```

**Pros:**
- Clean, type-safe method calls
- No serialization/deserialization boilerplate
- Matches CLAUDE.md examples (section 4.4)

**Cons:**
- RPC is newer feature, availability may vary by region
- Requires explicit enablement

#### Approach B: DO HTTP Router (Compatible, Verbose)

**Requires:** HTTP routing in DO class

```typescript
// In EnvPairDO
async fetch(request: Request): Promise<Response> {
  const url = new URL(request.url);

  // Route to methods based on pathname + method
  if (request.method === "POST" && url.pathname === "/createComparison") {
    const { comparisonId, leftUrl, rightUrl } = await request.json();
    const result = await this.createComparison(comparisonId, leftUrl, rightUrl);
    return Response.json(result);
  }

  if (request.method === "GET" && url.pathname === "/getComparison") {
    const comparisonId = url.searchParams.get("comparisonId");
    const result = await this.getComparison(comparisonId!);
    return Response.json(result);
  }

  return new Response("Not Found", { status: 404 });
}
```

**Code (Workflow step):**
```typescript
const doId = env.ENVPAIR_DO.idFromName(pairKey);
const stub = env.ENVPAIR_DO.get(doId);

const response = await stub.fetch(
  new Request("http://do/getComparison", {
    method: "GET",
    body: JSON.stringify({ comparisonId }),
  })
);
const state = await response.json();
```

**Pros:**
- Works on all Cloudflare versions
- Standard HTTP semantics
- No special features required

**Cons:**
- Verbose, manual serialization
- No type safety without custom wrappers
- Error handling less convenient

### Decision: Use DO RPC (Approach A)

**Rationale:**
1. CLAUDE.md section 4.4 shows direct method calls: `stub.getComparison(comparisonId)`
2. This implies RPC is expected
3. Cleaner code, matches examples in spec
4. If RPC unavailable in user's region, they can easily switch to HTTP router

**Action:** Update wrangler.toml with `rpc = true` flag

```toml
[durable_objects]
bindings = [
  {
    name = "ENVPAIR_DO",
    class_name = "EnvPairDO",
    script_name = "cf_ai_env_drift_analyzer",
    rpc = true
  }
]
```

---

## Decision 4: Missing Record Response (Infinite Polling)

### Issue in PHASE_B4_IMPLEMENTATION_REFINED.md

```typescript
async getComparison(comparisonId: string): Promise<ComparisonState> {
  const row = await this.db
    .prepare(`SELECT status, result_json, error FROM comparisons WHERE id = ?`)
    .bind(comparisonId)
    .first<...>();

  if (!row) {
    // ❌ PROBLEM: Returns { status: "running" } for missing records
    return { status: "running" };
  }

  // ... rest of logic ...
}
```

**Consequence:**
1. Frontend polls GET /api/compare/:comparisonId
2. Worker calls DO.getComparison(comparisonId)
3. Record doesn't exist (never created, or deleted)
4. DO returns `{ status: "running" }`
5. Frontend thinks it's still processing → **infinite polling**
6. Bug is silent; frontend never learns the ID was invalid

### Fix: Return 404 from Worker on Not Found

**DO method:**
```typescript
async getComparison(
  comparisonId: string
): Promise<ComparisonState | null> {
  const row = await this.db
    .prepare(`SELECT status, result_json, error FROM comparisons WHERE id = ?`)
    .bind(comparisonId)
    .first<{ status: string; result_json: string | null; error: string | null }>();

  if (!row) {
    return null;  // ← Return null explicitly
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
```

**Worker handler:**
```typescript
async function handleGetCompareStatus(
  comparisonId: string,
  env: Env
): Promise<Response> {
  try {
    const pairKey = comparisonId.split(":")[0];

    if (!pairKey) {
      return Response.json(
        { error: "Invalid comparisonId format" },
        { status: 400 }
      );
    }

    const doId = env.ENVPAIR_DO.idFromName(pairKey);
    const stub = env.ENVPAIR_DO.get(doId);

    const state = await stub.getComparison(comparisonId);

    if (!state) {
      // ✅ CORRECT: Return 404 for missing comparison
      return Response.json(
        { error: "Comparison not found", comparisonId },
        { status: 404 }
      );
    }

    return Response.json(state, { status: 200 });
  } catch (err) {
    return Response.json(
      { error: `Failed to poll comparison: ${String(err)}` },
      { status: 500 }
    );
  }
}
```

**Frontend behavior:**
- 200 + terminal status → stop polling
- 404 → display error "comparison not found" (clear feedback)
- 500 → retry with backoff

---

## Decision 5: Missing Type Imports

### Issue in PHASE_B4_IMPLEMENTATION_REFINED.md

```typescript
// ❌ PROBLEM: Env type used but not imported
export class EnvPairDO {
  constructor(state: DurableObjectState, env: Env) {  // ← Env not imported/exported
    // ...
  }
}
```

**Fix:**

1. **Remove env parameter from DO constructor** (DO doesn't receive env)
2. **Export Env type from src/env.d.ts** for use in Workflow/routes
3. **Update DO class signature:**

```typescript
import type { SignalEnvelope } from "../shared/types";
import type { Database } from "@cloudflare/workers-types";

interface ComparisonState {
  status: "running" | "completed" | "failed";
  result?: unknown;
  error?: string;
}

export class EnvPairDO {
  private pairKey: string;
  private db: Database;
  private readonly RING_BUFFER_SIZE = 50;

  // ✅ CORRECT: Only receive state (no env)
  constructor(state: DurableObjectState) {
    this.pairKey = state.id.name;
    this.db = state.storage.sql;
  }

  // ... rest of class ...
}

export default EnvPairDO;
```

---

## Corrected Env Type Definition

Create/Update file: `src/env.d.ts`

```typescript
import type EnvPairDO from "./storage/envPairDO";

/**
 * Cloudflare bindings available in Worker context.
 * Matches wrangler.toml configuration.
 */
export interface Env {
  // Durable Objects binding
  ENVPAIR_DO: DurableObjectNamespace<EnvPairDO>;

  // Workflows binding (when implemented)
  // COMPARE_WORKFLOW?: Workflows.WorkflowEntrypoint;

  // Workers AI binding (when implemented)
  // AI?: Ai;

  // Environment name
  ENVIRONMENT: "production" | "development";
}
```

---

## Corrected wrangler.toml (Partial)

```toml
[durable_objects]
bindings = [
  {
    name = "ENVPAIR_DO",
    class_name = "EnvPairDO",
    script_name = "cf_ai_env_drift_analyzer",
    rpc = true  # ← Enable DO RPC
  }
]

[[migrations]]
tag = "v1"
new_classes = ["EnvPairDO"]
```

---

## Summary of Critical Fixes

| Issue | Root Cause | Fix | Impact |
|-------|-----------|-----|--------|
| **D1 API on non-D1 object** | Mixed storage backends | Use `state.storage.sql` (DO-local SQLite) | Runtime crash |
| **retainLatestN never called** | Incomplete implementation | Invoke in `createComparison()` | Quota exhaustion |
| **RPC not enabled** | Missing wrangler config | Add `rpc = true` to binding | Method calls fail |
| **Infinite polling** | Silent failure on missing record | Return 404 from Worker | User confusion |
| **Env type not imported** | Missing import statement | Remove env param from constructor | TypeScript error |

---

## Implementation Order

1. **Decide on RPC:** Confirm `rpc = true` is supported in target environment
2. **Update wrangler.toml** with RPC binding
3. **Rewrite DO class** with correct API:
   - ✅ `state.storage.sql` for Database access
   - ✅ `Database.prepare()` + `.run()` for exec
   - ✅ `Database.prepare()` + `.first()` for queries
   - ✅ No `env` parameter in constructor
   - ✅ Call `retainLatestN()` in `createComparison()`
4. **Update Env type** (export, remove D1 references)
5. **Update routes** to return 404 on not found
6. **Test locally** with `wrangler dev` + migrations

---

## References

- **CLAUDE.md 2.3:** Durable Objects (SQLite-Backed State)
- **CLAUDE.md 4.4:** Worker → Durable Object (Poll)
- **Cloudflare Docs:** [DO Persistent Storage](https://developers.cloudflare.com/durable-objects/platform/storage-api/), [DO RPC](https://developers.cloudflare.com/durable-objects/examples/rpc-api/) (if available)

---

**Next Step:** Confirm RPC availability and create corrected PHASE_B4_IMPLEMENTATION_FINAL.md with tested, production-ready code.
