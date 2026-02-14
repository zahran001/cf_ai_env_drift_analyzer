# Demo Endpoints + "Try Demo" UI Button — Implementation Plan

## Problem

Random URLs don't showcase the app because it's designed to detect **environment drift** between deployments of the same service (e.g., staging vs. production). When you probe two unrelated URLs, the diff output is noisy and doesn't tell a compelling story about what this tool is actually for.

## Solution

Two dedicated Worker endpoints that simulate a **staging** and **production** environment with intentional, realistic drift — plus a one-click "Try Demo" button in the UI.

## Design Decision: Live Pipeline, Not Canned Results

The demo runs through the **real pipeline** (probe → diff → LLM explanation) so the experience is authentic. This means:
- Two GET endpoints on the worker: `/api/demo/staging` and `/api/demo/production`
- They return different HTTP responses (different headers, different timing)
- The "Try Demo" button fills in these URLs and the user clicks Compare normally
- The full Workflow executes: probe both → compute diff → call LLM → persist in DO

---

## Backend: Two Demo Endpoints

### `GET /api/demo/staging` — Clean Staging Environment

| Property | Value |
|---|---|
| Status Code | 200 |
| Latency | Natural (~5ms) |
| `content-type` | `application/json` |
| `cache-control` | `no-store` |
| `vary` | `Accept` |
| `www-authenticate` | *(absent)* |
| `access-control-allow-origin` | `*` *(explicit, not inherited)* |
| `access-control-allow-methods` | `GET` |
| Body | `{ "env": "staging", "version": "2.1.0", "status": "healthy" }` |

### `GET /api/demo/production` — Production With Drift

| Property | Value |
|---|---|
| Status Code | 200 |
| Latency | ~200ms artificial delay |
| `content-type` | `text/json` |
| `cache-control` | `public, max-age=3600` |
| `vary` | `Accept, Accept-Encoding` |
| `www-authenticate` | `Bearer realm="api"` |
| `access-control-allow-origin` | `https://app.example.com` |
| `access-control-allow-methods` | `GET, POST` |
| Body | `{ "env": "production", "version": "2.0.9", "status": "healthy" }` |

### Expected Diff Findings (5+ types in one comparison)

| Finding Code | Category | Staging (Left) | Production (Right) | Severity |
|---|---|---|---|---|
| `CONTENT_TYPE_DRIFT` | content | `application/json` | `text/json` | warning |
| `CACHE_HEADER_DRIFT` | cache | `no-store` | `public, max-age=3600` | critical |
| `AUTH_CHALLENGE_PRESENT` | security | *(absent)* | `Bearer realm="api"` | critical |
| `CORS_HEADER_DRIFT` | security | `*` / `GET` | `https://app.example.com` / `GET, POST` | warning |
| `TIMING_DRIFT` | timing | ~5ms | ~205ms | info |
| `UNKNOWN_DRIFT` (vary) | unknown | `Accept` | `Accept, Accept-Encoding` | warning |

This hits **5 categories** (content, cache, security, timing, unknown) and produces **2 critical** headline findings (`AUTH_CHALLENGE_PRESENT` + `CACHE_HEADER_DRIFT`), giving the LLM rich material for an explanation.

### Critique Responses (Verified Against Classifier Code)

**Risk 1: AUTH_CHALLENGE_PRESENT = Critical — VERIFIED CORRECT**

Checked `classify.ts` lines 317–355. The rule is:
- `www-authenticate` present on **one side only** → `severity: "critical"` (hardcoded, line 337)
- Present on **both sides but differs** → `severity: "warn"` (line 348)

This is independent of HTTP status code. Semantically correct: production demanding credentials that staging doesn't is a critical drift regardless of whether the response body is still 200. No change needed.

**Risk 1b: CONTENT_TYPE_DRIFT — PLAN CORRECTED**

The original plan had `application/json` vs `application/json; charset=utf-8`. This would **NOT** trigger `CONTENT_TYPE_DRIFT` because `classify.ts` line 55–58 normalizes content-type by stripping everything after `;`. Both normalize to `application/json`.

**Fix:** Changed production to `text/json` instead. This normalizes differently (`text/json` vs `application/json`) and will correctly trigger the finding.

**Risk 1c: CACHE_HEADER_DRIFT severity — actually CRITICAL, not warning**

Checked `cacheUtils.ts` — `no-store` is in `CACHE_CRITICAL_KEYWORDS` (constants.ts line 23). When one side has `no-store` and the other doesn't, the classifier returns `critical`. Updated the table.

**Risk 2: Worker CORS vs Explicit CORS — ADOPTED**

Both endpoints now set CORS headers **explicitly** rather than relying on `jsonResponse()`:
- Staging: `access-control-allow-origin: *`, `access-control-allow-methods: GET`
- Production: `access-control-allow-origin: https://app.example.com`, `access-control-allow-methods: GET, POST`

This makes the CORS drift deterministic and immune to future `getCorsHeaders()` refactors.

**Risk 3: Artificial Delay Stability — ADOPTED**

Will use the fallback pattern:
```typescript
await (globalThis.scheduler?.wait?.(200) ?? new Promise(r => setTimeout(r, 200)));
```
This works in both Workers runtime (`scheduler.wait`) and local dev (`setTimeout`).

### Implementation Detail: Artificial Delay

Uses a fallback pattern that works in both Workers runtime and local dev:
```typescript
await (globalThis.scheduler?.wait?.(200) ?? new Promise(r => setTimeout(r, 200)));
```
- Workers runtime: uses `scheduler.wait()` (Web Scheduler API, non-blocking)
- Local dev / wrangler dev: falls back to `setTimeout`
- No `@ts-ignore` needed with optional chaining

### Implementation Detail: CORS Header Drift (Explicit, Not Inherited)

Both endpoints set CORS headers **explicitly** on each response — they do **not** rely on `jsonResponse()` or `getCorsHeaders()`:

- **Staging:** `access-control-allow-origin: *`, `access-control-allow-methods: GET`
- **Production:** `access-control-allow-origin: https://app.example.com`, `access-control-allow-methods: GET, POST`

This makes the CORS drift deterministic and immune to future refactors of the Worker's infrastructure CORS helper. Both endpoints construct raw `Response` objects with explicit header sets.

### Where in the Code

All changes go in `src/api/routes.ts`. Two new handler functions (`handleDemoStaging`, `handleDemoProduction`) and two new route guards inserted before the final 404 line. No new files, no Workflow changes, no DO changes, no wrangler.toml changes.

---

## Frontend: "Try Demo" Button

### Behavior

1. User clicks "Try Demo"
2. Form pre-fills with:
   - Left URL: `${API_BASE}/api/demo/staging`
   - Right URL: `${API_BASE}/api/demo/production`
   - Left Label: "Staging"
   - Right Label: "Production"
3. User sees the filled form and clicks "Compare" to start
4. **No auto-submit** — user retains control and can see what's being compared

### Why Pre-fill, Not Auto-submit

- Auto-submitting removes user agency (confusing to suddenly see a loading spinner)
- Pre-filling lets the user see the demo URLs, understand the comparison, and consciously initiate it
- Follows the same UX pattern as clicking a history entry (which also pre-fills without submitting)

### Placement

Between the subtitle text and the ControlPlane form. Visually:

```
┌─────────────────────────────────────┐
│ cf_ai_env_drift_analyzer            │
│ Compare two environments...         │
│                                     │
│ [Try Demo]  Pre-fills staging vs.   │
│             production endpoints... │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ Left URL: [demo/staging    ]   │ │
│ │ Right URL: [demo/production]   │ │
│ │ [Swap] [Compare]               │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

### Styling

- **Outlined blue button** (border `#3b82f6`, white background) — visually distinct from the primary "Compare" button
- Gray hint text beside it explaining what it does
- Disabled during active comparison (same guard as the Compare button)
- CSS Modules only (per constitution.md)

### Code Changes

1. **`pages/src/lib/api.ts`** — Export the existing `getApiBase()` function (currently module-private)
2. **`pages/src/App.tsx`** — Import `getApiBase`, add `handleDemoClick()` function (mirrors `handleHistoryClick` pattern), render button JSX
3. **`pages/src/App.module.css`** — Add `.demoRow`, `.demoButton`, `.demoHint` classes

---

## Files Modified (Total: 4)

| File | What Changes | Lines Added (est.) |
|---|---|---|
| `src/api/routes.ts` | Two handler functions + two route guards | ~40 |
| `pages/src/lib/api.ts` | Add `export` to `getApiBase` | 1 |
| `pages/src/App.tsx` | Import, handler function, button JSX | ~20 |
| `pages/src/App.module.css` | Three new CSS classes | ~30 |

**No new files created.** No changes to wrangler.toml, shared types, Workflows, or Durable Objects.

---

## Verification Plan

### Backend Verification
```bash
# Start dev server
wrangler dev

# Test staging endpoint
curl -s http://localhost:8787/api/demo/staging -D -

# Expected: 200, content-type: application/json, cache-control: no-store, vary: Accept
# access-control-allow-origin: *, access-control-allow-methods: GET

# Test production endpoint
curl -s http://localhost:8787/api/demo/production -D -

# Expected: 200 (after ~200ms), content-type: text/json,
# cache-control: public, max-age=3600, www-authenticate: Bearer realm="api",
# access-control-allow-origin: https://app.example.com, access-control-allow-methods: GET, POST

# Test CORS preflight
curl -s -X OPTIONS http://localhost:8787/api/demo/staging -D -
# Expected: 204 (handled by existing OPTIONS catch-all)
```

### Frontend Verification
```bash
cd pages
npm run type-check   # Zero errors
npm test             # All existing tests pass
npm run build        # Build succeeds
```

### End-to-End Demo Walkthrough
1. Run `wrangler dev` (port 8787) and `npm --prefix pages run dev` (port 5173)
2. Open `http://localhost:5173`
3. Click "Try Demo" → verify form fills with demo URLs + labels
4. Click "Compare" → verify polling starts (ProgressIndicator appears)
5. Wait for completion → verify ResultDashboard shows
6. Verify findings include at minimum: `AUTH_CHALLENGE_PRESENT` (critical), `CACHE_HEADER_DRIFT` (critical), `CORS_HEADER_DRIFT`, `CONTENT_TYPE_DRIFT`, `TIMING_DRIFT`
7. Verify LLM explanation references the specific drift causes

---

## Optional Enhancement: Add Redirect Chain Drift

To also demonstrate `REDIRECT_CHAIN_CHANGED` (the only category not covered), we could add a third variant:

- `GET /api/demo/production` returns a `301` redirect to `/api/demo/production/final`
- `GET /api/demo/production/final` returns the actual response

This would add a redirect hop on the production side that staging doesn't have, triggering `REDIRECT_CHAIN_CHANGED` + `FINAL_URL_MISMATCH`. However, this adds complexity and the 5 existing findings already demonstrate the app comprehensively. **Recommendation: skip for now, add later if needed.**
