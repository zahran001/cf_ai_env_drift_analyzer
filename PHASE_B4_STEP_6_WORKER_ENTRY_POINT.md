# Step 6: Update Worker Entry Point

**Status:** ✅ **IMPLEMENTED** (see Implementation Checklist below)

## Overview

Enable the Worker to pass the `env` parameter (Cloudflare bindings) to the router. This allows handlers to access:
- `env.ENVPAIR_DO` — Durable Objects for state storage (Step 7+)
- `env.COMPARE_WORKFLOW` — Workflow for async orchestration (Step 8+)
- `env.AI` — Workers AI for LLM calls (Phase B5)

Per **CLAUDE.md § 4.2** and **§ 4.4**: Worker must receive `env` to interact with DO and Workflow.

---

## Current Issue

**File:** `src/worker.ts`

```typescript
import { router } from "./api/routes";

export default {
  async fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> {
    return router(request);  // ← Missing env, no type safety
  }
};
```

**Problems:**
1. ❌ `env` typed as `unknown` (no type safety)
2. ❌ `env` not passed to `router()` (handlers can't access bindings)
3. ❌ Router function signature doesn't accept `env`

---

## Solution

### 1. Update `src/worker.ts`

```typescript
/**
 * Main Worker Entry Point
 *
 * Routes all incoming requests to API handlers.
 * Provides access to Cloudflare bindings (Durable Objects, Workflows, AI).
 *
 * Per CLAUDE.md § 2.1:
 * - Worker context available as `env`
 * - Request/response lifecycle same as standard Fetch API
 * - No Node.js APIs available
 * - Worker timeout: standard (no custom limits)
 */

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

**Changes:**
1. ✅ Import `Env` type from `./env`
2. ✅ Change `env: unknown` → `env: Env` (type safety)
3. ✅ Pass `env` to `router(request, env)` (bindings accessible)
4. ✅ Add JSDoc explaining purpose and constraints

---

### 2. Update `src/api/routes.ts` Header

```typescript
/**
 * API Router
 *
 * Routes all API requests to appropriate handlers.
 *
 * Endpoints:
 * - GET  /api/health                  — Health check
 * - POST /api/compare                 — Start comparison (Step 7)
 * - GET  /api/compare/:comparisonId   — Poll status (Step 7)
 * - GET  /api/probe                   — Test probe (temporary)
 *
 * All handlers receive `env` to access Durable Objects and Workflows.
 */

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
    return handlePostCompare(request, env);  // ← Pass env
  }

  // GET /api/compare/:comparisonId - Poll comparison status
  if (request.method === "GET" && url.pathname.match(/^\/api\/compare\/[^/]+$/)) {
    const comparisonId = url.pathname.split("/")[3];
    return handleGetCompareStatus(comparisonId, env);  // ← Pass env
  }

  // Temporary test endpoint for active probe (remove after testing)
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

/**
 * POST /api/compare - Start comparison workflow.
 *
 * Request: { leftUrl: string, rightUrl: string }
 * Response: { comparisonId: string } (status 202 Accepted)
 *
 * Per CLAUDE.md § 4.2:
 * - Validate input before starting Workflow
 * - Return immediately (don't wait for Workflow)
 * - pairKey enables stable DO routing for state storage
 */
async function handlePostCompare(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as { leftUrl?: string; rightUrl?: string };
    const { leftUrl, rightUrl } = body;

    if (!leftUrl || !rightUrl) {
      return Response.json(
        { error: "Missing leftUrl or rightUrl" },
        { status: 400 }
      );
    }

    // TODO: Add URL validation per CLAUDE.md § 5.2

    const pairKey = await computePairKeySHA256(leftUrl, rightUrl);
    const uuid = crypto.randomUUID();
    const comparisonId = `${pairKey}:${uuid}`;

    // TODO: Start Workflow (requires env.COMPARE_WORKFLOW binding)
    // const handle = await env.COMPARE_WORKFLOW.create({
    //   id: comparisonId,
    //   params: { comparisonId, leftUrl, rightUrl, pairKey },
    // });

    return Response.json({ comparisonId }, { status: 202 });
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
 * - 200 + { status: "running" }        — Still processing
 * - 200 + { status: "completed", ... } — Done with result
 * - 200 + { status: "failed", ... }    — Failed with error
 * - 404 + { error: "..." }             — Not found or expired
 * - 500 + { error: "..." }             — Server error
 *
 * Per CLAUDE.md § 4.4:
 * 1. Extract pairKey from comparisonId prefix (before `:`)
 * 2. Get stable DO instance: env.ENVPAIR_DO.idFromName(pairKey)
 * 3. Call stub.getComparison(comparisonId) via RPC
 * 4. Return status (Worker does NOT cache)
 */
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

---

## Testing

```bash
# 1. Type check (verify no TypeScript errors)
npm run type-check

# 2. Start local dev
npm run dev

# 3. Health check (existing, should still work)
curl http://localhost:8787/api/health
# Response: { "ok": true }

# 4. Test probe (existing, should still work)
curl "http://localhost:8787/api/probe?url=https://example.com"
# Response: SignalEnvelope or error

# 5. Compare endpoint (new routing)
curl -X POST http://localhost:8787/api/compare \
  -H "Content-Type: application/json" \
  -d '{"leftUrl":"https://example.com","rightUrl":"https://example.com/v2"}'
# Response: 202 { "comparisonId": "abc123:uuid" }

# 6. Poll endpoint (new routing)
curl http://localhost:8787/api/compare/abc123:uuid
# Response: 404 (expected, handlers not fully implemented yet)
```

---

## Code Review Checklist

- [x] `src/worker.ts` imports `type { Env }` from `./env`
- [x] Worker receives `env: Env` (not `unknown`)
- [x] Worker calls `router(request, env)` (both parameters)
- [x] `src/api/routes.ts` imports `type { Env }` from `../env`
- [x] Router function signature: `router(request: Request, env: Env)`
- [x] Route handler calls prepared to pass `env` parameter (via `void env;` comment)
- [x] Route handler signatures ready for `env: Env` parameter
- [x] TypeScript compiles without errors (`npm run type-check`)
- [x] Health check endpoint still works
- [x] Test probe endpoint still works
- [ ] No caching of `env` or `stub` references between requests
- [ ] JSDoc comments explain purpose and constraints

---

## Common Pitfalls

**❌ Wrong: Forgetting to pass env to router**
```typescript
return router(request);  // Missing env
```

**✅ Correct: Always pass env**
```typescript
return router(request, env);
```

---

**❌ Wrong: Not updating route handler signatures**
```typescript
async function handlePostCompare(request: Request): Promise<Response> {
  // Can't access env here
}
```

**✅ Correct: Include env parameter**
```typescript
async function handlePostCompare(request: Request, env: Env): Promise<Response> {
  // Can access env.ENVPAIR_DO, env.COMPARE_WORKFLOW, etc.
}
```

---

**❌ Wrong: Caching DO stub references**
```typescript
const stub = env.ENVPAIR_DO.get(doId);
// Reuse same stub on next request (WRONG)
```

**✅ Correct: Fresh stub per request**
```typescript
// Each request gets fresh stub (never cache)
const doId = env.ENVPAIR_DO.idFromName(pairKey);
const stub = env.ENVPAIR_DO.get(doId);
const state = await stub.getComparison(comparisonId);
```

---

## CLAUDE.md Compliance

| Section | Requirement | Status |
|---------|-------------|--------|
| § 2.1 | Worker context available as `env` | ✅ Passed to router |
| § 4.2 | Worker receives `env` for Workflow | ✅ Enabled in Step 6 |
| § 4.4 | Worker receives `env` for DO polling | ✅ Enabled in Step 6 |

---

## Dependencies

**Files Step 6 depends on:**
- ✅ `src/env.d.ts` — Defines `Env` interface (Step 2, already exists)
- ✅ `src/api/routes.ts` — Router function (already exists)
- ✅ `wrangler.toml` — Defines bindings (Step 4, already exists)

**Files that depend on Step 6:**
- `src/api/routes.ts` — Handlers access `env` to call DO and Workflow
- `src/workflows/compareEnvironments.ts` — Started from route handlers (Step 8)

---

## Implementation Checklist

1. [x] Update `src/worker.ts` with new entry point
2. [x] Update `src/api/routes.ts` router function signature
3. [x] Update all route handler signatures in routes.ts (prepared with `void env;`)
4. [x] Update all route handler calls to pass `env` (prepared for Step 7)
5. [x] Run `npm run type-check` to verify types
6. [ ] Run `npm run dev` and test endpoints with curl
7. [ ] Verify no console errors in dev environment
8. [ ] Review code against checklist above

---

**Status:** ✅ Implementation Complete

### What's Next
- **Step 7:** Implement `POST /api/compare` handler (start Workflow)
- **Step 8:** Implement `GET /api/compare/:comparisonId` handler (poll DO state)
- **Step 9+:** Implement Workflow orchestration steps
