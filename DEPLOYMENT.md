# Deployment Guide: cf_ai_env_drift_analyzer

## What This Document Covers

A step-by-step guide to go from "I run `wrangler deploy` and test in Postman" to a stable, repeatable deployment with:
- Frontend deployed to Cloudflare Pages (currently has no deployment)
- Same-domain routing: UI and API on one `*.pages.dev` URL
- CORS locked down in production
- Unified verification before every deploy

**Single-environment approach:** No staging. One Worker, one DO namespace, one deploy command. Add staging later if needed.

**Architecture after completion:**

```
Browser → cf-ai-drift-ui.pages.dev
  ├── /api/*   → Pages Function → Service Binding → Worker
  └── /*       → Static HTML/JS/CSS from pages/dist/
```

Same domain = no CORS needed in production. Pages Functions act as a 5-line proxy that forwards `/api/*` requests to your Worker via a Cloudflare Service Binding.

---

## Step 1: Fix the Lockfile Problem

**Why:** `.gitignore` currently ignores `package-lock.json`. This means dependency versions can drift between your machine and any future CI or collaborator. Fix this first.

**File to edit: `.gitignore`** — Remove line 3 (`package-lock.json`). The full file should look like:

```gitignore
# Dependencies
node_modules/
yarn.lock
pnpm-lock.yaml

# Build outputs
/pages/dist
/pages/.vite
dist/
build/

# Environment variables
.env
.env.local
.env.*.local
.env.production.local

# IDE
.vscode/
.idea/
.claude/
*.swp
*.swo
*~
.DS_Store

# Wrangler / Cloudflare
.wrangler/
wrangler.toml.local

# Development
npm-debug.log
yarn-debug.log
yarn-error.log
pnpm-debug.log

# OS
Thumbs.db

# Test coverage
coverage/
.nyc_output/

# Misc
.cache/
*.bak
```

**Then regenerate lockfiles:**

```bash
npm install
cd pages && npm install && cd ..
```

**Commit:**

```bash
git add .gitignore package-lock.json pages/package-lock.json
git commit -m "Track package-lock.json for reproducible installs"
```

---

## Step 2: Add Deployment Scripts to package.json

**File to edit: `package.json`** — Add new scripts alongside the existing ones. Full `scripts` section:

```json
{
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "type-check": "tsc -p tsconfig.json --noEmit",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "verify": "npm run type-check && npm test && npm --prefix pages run build && npm --prefix pages test",
    "verify:backend": "npm run type-check && npm test",
    "verify:frontend": "npm --prefix pages run build && npm --prefix pages test",
    "pages:build": "npm --prefix pages run build",
    "pages:deploy": "npx wrangler pages deploy pages/dist --project-name cf-ai-drift-ui",
    "dev:ui": "npm --prefix pages run dev"
  }
}
```

**What changed:**
- `verify` now runs backend type-check + backend tests + frontend build + frontend tests
- `verify:backend` / `verify:frontend` for partial checks
- `pages:build` / `pages:deploy` for frontend-specific operations

**Test it works:**

```bash
npm run verify
```

Should output zero errors across all 4 steps (type-check, backend tests, vite build, frontend tests).

---

## Step 3: Clean Up wrangler.toml

**File to replace: `wrangler.toml`** — Replace the entire file with:

```toml
name = "cf_ai_env_drift_analyzer"
main = "src/worker.ts"
compatibility_date = "2024-10-22"

[dev]
port = 8787

[[durable_objects.bindings]]
name = "ENVPAIR_DO"
class_name = "EnvPairDO"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["EnvPairDO"]

[ai]
binding = "AI"

[[workflows]]
name = "COMPARE_WORKFLOW"
binding = "COMPARE_WORKFLOW"
class_name = "CompareEnvironments"

[vars]
ALLOWED_ORIGIN = "https://cf-ai-drift-ui.pages.dev"
```

**What changed vs. the old file:**
- `script_name = "cf_ai_env_drift_analyzer"` **removed** from DO binding. Since the DO class is in the same Worker, `script_name` is unnecessary.
- `ALLOWED_ORIGIN` var added (used by CORS, see Step 4). Set to your Pages URL in production; overridden to `*` locally via `wrangler dev` (which doesn't set it, so the code falls back to `*`).
- No staging/production env blocks — single environment, one DO namespace, one deploy command.

**Resulting Worker URLs:**
- `wrangler dev` → `http://localhost:8787` (CORS falls back to `*`)
- `wrangler deploy` → `https://cf_ai_env_drift_analyzer.<your-subdomain>.workers.dev` (CORS locked to Pages URL)

**Test it:**

```bash
npx wrangler dev
# Should start on :8787 with no errors
```

---

## Step 4: Make CORS Configurable Per Environment

Currently `src/api/routes.ts` has `Access-Control-Allow-Origin: *` hardcoded. This step makes it read from the `ALLOWED_ORIGIN` env var set in Step 3.

### 4a. Edit `src/env.d.ts`

Add `ALLOWED_ORIGIN` to the `Env` interface. Full file:

```typescript
import type { EnvPairDO } from "./storage/envPairDO";
import type { CompareEnvironmentsInput } from "./workflows/compareEnvironments";

/**
 * Cloudflare Worker Env interface.
 * Bindings from wrangler.toml.
 */
export interface Env {
  // Durable Objects binding with RPC enabled
  ENVPAIR_DO: DurableObjectNamespace<EnvPairDO>;

  // Workers AI binding for LLM integration (Llama 3.3)
  AI: Ai;

  // Workflows binding for comparison orchestration
  COMPARE_WORKFLOW: Workflow<CompareEnvironmentsInput>;

  // CORS origin lock. Set in wrangler.toml [vars]. Falls back to "*" for local dev.
  ALLOWED_ORIGIN?: string;
}
```

### 4b. Edit `src/api/routes.ts`

Replace the top of the file. Change the hardcoded `CORS_HEADERS` constant to a function:

**Replace this** (lines 7-15):
```typescript
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
```

**With this:**
```typescript
/** Build CORS headers using env.ALLOWED_ORIGIN (falls back to "*" for local dev). */
function getCorsHeaders(env: Env): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
```

Then update `jsonResponse` and `errorResponse` to accept `env` as a parameter:

```typescript
function jsonResponse(env: Env, data: unknown, init?: ResponseInit): Response {
  const corsHeaders = getCorsHeaders(env);
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries(corsHeaders)) {
    headers.set(k, v);
  }
  return new Response(JSON.stringify(data), {
    ...init,
    headers,
    status: init?.status ?? 200,
  });
}

function errorResponse(env: Env, error: CompareError, status: number): Response {
  return jsonResponse(env, { error }, { status });
}
```

Finally, update every call to `jsonResponse(...)` and `errorResponse(...)` in the `router()`, `handlePostCompare()`, and `handleGetCompareStatus()` functions to pass `env` as the first argument. Also update the `OPTIONS` handler:

```typescript
if (request.method === "OPTIONS") {
  return new Response(null, { status: 204, headers: getCorsHeaders(env) });
}
```

**Behavior after this change:**
- `wrangler dev` (no `ALLOWED_ORIGIN` set) → `*` (open, same as today)
- `wrangler deploy` (`ALLOWED_ORIGIN = "https://cf-ai-drift-ui.pages.dev"`) → locked to Pages domain

**Verify:**

```bash
npm run verify
# Should still pass all tests (no behavioral change for existing tests)
```

---

## Step 5: Set Up Frontend Production Build

### 5a. Create `pages/.env.production`

**New file: `pages/.env.production`**

```
VITE_API_BASE_URL=
```

That's it — one line, empty value. Vite loads `.env.production` automatically during `vite build`. An empty `VITE_API_BASE_URL` means API calls go to relative paths (`/api/compare`), which works when frontend and backend share a domain.

The existing `pages/.env` (with `http://localhost:8787`) continues to be used for `vite dev`.

**Note:** `.env.production` is safe to commit. The `.gitignore` blocks `.env` and `.env.*.local` but NOT `.env.production`.

### 5b. Create the Pages Function proxy

Cloudflare Pages Functions automatically route requests matching file paths in a `functions/` directory. A catch-all file at `functions/api/[[path]].ts` intercepts all `/api/*` requests and forwards them to your Worker.

**New file: `pages/functions/api/[[path]].ts`**

```typescript
interface FuncEnv {
  API: Fetcher; // Service Binding to the Worker
}

export const onRequest: PagesFunction<FuncEnv> = async (context) => {
  const url = new URL(context.request.url);
  const apiPath = url.pathname + url.search;
  return context.env.API.fetch(new URL(apiPath, "https://dummy").toString(), context.request);
};
```

**New file: `pages/functions/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["./**/*.ts"]
}
```

### 5c. Create Pages wrangler config (for Service Binding)

**New file: `pages/wrangler.toml`**

```toml
name = "cf-ai-drift-ui"
pages_build_output_dir = "dist"

[[services]]
binding = "API"
service = "cf_ai_env_drift_analyzer"
```

This tells Cloudflare Pages to create a Service Binding named `API` pointing to your Worker. The Pages Function in 5b uses `context.env.API` to forward requests.

**Note:** This file only applies to `wrangler pages deploy`. It does NOT conflict with the root `wrangler.toml`.

### 5d. Add security headers

**New file: `pages/public/_headers`**

```
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
```

Vite copies everything in `public/` to `dist/` during build. Cloudflare Pages reads `_headers` and applies them to all static file responses.

---

## Step 6: First-Time Deployment (Do This Once)

This is the exact sequence for your very first deploy. Order matters because the Service Binding needs both the Worker and the Pages project to exist.

```bash
# ── Prerequisite: verify everything passes ──
npm run verify

# ── 1. Deploy the Worker ──
# (creates the Worker that the Pages Function will call)
npx wrangler deploy

# ── 2. Smoke test the Worker ──
curl -s https://cf_ai_env_drift_analyzer.<YOUR-SUBDOMAIN>.workers.dev/api/health
# You should see: {"ok":true}
# (Replace <YOUR-SUBDOMAIN> with your actual workers.dev subdomain)

# ── 3. Build the frontend for production ──
npm --prefix pages run build
# (uses pages/.env.production → VITE_API_BASE_URL is empty → relative API paths)

# ── 4. Deploy Pages ──
# First run will prompt you to create the project.
# The --branch main makes this the production deployment.
npx wrangler pages deploy pages/dist --project-name cf-ai-drift-ui --branch main

# ── 5. Verify the Service Binding ──
# The pages/wrangler.toml should configure this automatically.
# If it doesn't work, go to Cloudflare Dashboard manually:
#   cf-ai-drift-ui → Settings → Functions → Service Bindings
#   Variable name: API
#   Service: cf_ai_env_drift_analyzer
# Then redeploy Pages:
npx wrangler pages deploy pages/dist --project-name cf-ai-drift-ui --branch main

# ── 6. Smoke test the full stack ──
# Frontend loads:
curl -s -o /dev/null -w "%{http_code}" https://cf-ai-drift-ui.pages.dev/
# Expected: 200

# API works through Pages proxy:
curl -s https://cf-ai-drift-ui.pages.dev/api/health
# Expected: {"ok":true}
```

---

## Ongoing Deployment Runbook

After the first-time setup, use these commands for subsequent deploys.

```bash
# 1. Verify
npm run verify

# 2. Deploy backend
npm run deploy

# 3. Smoke test backend directly
curl -s https://cf_ai_env_drift_analyzer.<YOUR-SUBDOMAIN>.workers.dev/api/health

# 4. Build frontend (uses .env.production → empty API base → same-domain)
npm run pages:build

# 5. Deploy frontend
npm run pages:deploy

# 6. Smoke test full stack through Pages
curl -s https://cf-ai-drift-ui.pages.dev/api/health
```

---

## Complete File Checklist

### New files to create (5)

| # | File | Contents described in |
|---|------|----------------------|
| 1 | `pages/.env.production` | Step 5a |
| 2 | `pages/functions/api/[[path]].ts` | Step 5b |
| 3 | `pages/functions/tsconfig.json` | Step 5b |
| 4 | `pages/wrangler.toml` | Step 5c |
| 5 | `pages/public/_headers` | Step 5d |

### Files to edit (5)

| # | File | What to change | Described in |
|---|------|----------------|--------------|
| 1 | `.gitignore` | Remove `package-lock.json` line | Step 1 |
| 2 | `package.json` | Add new scripts | Step 2 |
| 3 | `wrangler.toml` | Clean up + add `ALLOWED_ORIGIN` var | Step 3 |
| 4 | `src/env.d.ts` | Add `ALLOWED_ORIGIN` field | Step 4a |
| 5 | `src/api/routes.ts` | Make CORS read from `env` | Step 4b |

### Generated files to commit (2)

| File | How to generate |
|------|-----------------|
| `package-lock.json` | `npm install` |
| `pages/package-lock.json` | `cd pages && npm install` |

---

## Things That Can Go Wrong

| # | Problem | Cause | Fix |
|---|---------|-------|-----|
| 1 | `wrangler deploy` fails with DO binding error | `script_name` still in wrangler.toml | Remove `script_name` from the DO binding (Step 3) |
| 2 | `/api/health` returns 404 on Pages domain | Service Binding not configured | Check Pages project → Settings → Functions → Service Bindings in CF Dashboard. Must have `API` → `cf_ai_env_drift_analyzer` |
| 3 | Frontend shows network errors in production | `VITE_API_BASE_URL` still set to `localhost:8787` | `pages/.env.production` must have `VITE_API_BASE_URL=` (empty). Rebuild and redeploy. |
| 4 | CORS error in browser on production | `ALLOWED_ORIGIN` doesn't match Pages URL | Check `[vars]` in `wrangler.toml`. Must match your actual Pages URL exactly. |
| 5 | `VITE_API_BASE_URL` change not taking effect | Vite bakes env vars at build time | Must rebuild (`npm --prefix pages run build`) and redeploy. Not a runtime var. |

---

## Verification Checklist

Run through this after implementing all steps:

- [ ] `npm run verify` passes (type-check + backend tests + frontend build + frontend tests)
- [ ] `npx wrangler dev` starts on :8787 with no errors
- [ ] `npx wrangler deploy` succeeds
- [ ] `curl https://cf_ai_env_drift_analyzer.<subdomain>.workers.dev/api/health` → `{"ok":true}`
- [ ] `npx wrangler pages deploy pages/dist --project-name cf-ai-drift-ui --branch main` succeeds
- [ ] `curl https://cf-ai-drift-ui.pages.dev/` → HTTP 200
- [ ] `curl https://cf-ai-drift-ui.pages.dev/api/health` → `{"ok":true}` (Service Binding works)
