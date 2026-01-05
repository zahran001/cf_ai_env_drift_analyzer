# Minimal Frontend Setup (Vite + React on Cloudflare Pages)

**Project:** `cf_ai_env_drift_analyzer`

## Philosophy

This guide prioritizes the architectural contracts (shared types) and async flow (polling) over visual fluff, ensuring the frontend is a functional mirror of the backend architecture.

**Core principles:**
- Minimal UI (two URLs + Compare button)
- Typed API wrapper + polling hook
- No styling rabbit holes
- Uses `VITE_API_BASE_URL` for local backend
- Ready to swap in real backend later

## Goal

Create the smallest possible React UI that:
- Collects two URLs
- Calls `POST /api/compare`
- Polls `GET /api/compare/:comparisonId`
- Displays result JSON (or error)
- Then stop and move to backend

---

## 0) Expected repo layout

From repo root:

```
/pages   # Vite + React app (Cloudflare Pages)
/shared  # Shared TypeScript types (recommended)
/src     # Worker backend (later)
```

---

## 1) Create the Vite + React app in `/pages`

From the repo root:

```bash
mkdir pages
cd pages
npm create vite@latest . -- --template react-ts
npm install
npm run dev
```

You should see Vite running at: `http://localhost:5173`

---

## 2) Add API base env var for local backend

Create `pages/.env`:

```
VITE_API_BASE_URL=http://localhost:8787
```

**Notes:**
- During local dev, your Worker backend will run on port 8787.
- In production, you can set this to empty and use same-domain `/api` routing if desired.

---

## 3) Add a minimal Vite config

Create or replace `pages/vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/",
  server: { port: 5173 },
});
```

---

## 4) Add shared types (recommended)

From repo root, create `shared/api.ts`:

```typescript
export type CompareRequest = {
  leftUrl: string;
  rightUrl: string;
  leftLabel?: string;
  rightLabel?: string;
};

export type CompareStartResponse = {
  comparisonId: string;
};

export type CompareStatus = "running" | "completed" | "failed";

export type CompareStatusResponse<ResultT = unknown> = {
  status: CompareStatus;
  result?: ResultT;
  error?: string;
};
```

> If you don't want a `/shared` folder yet, you can paste these types into the frontend, but shared is cleaner.

---

## 5) Create typed API helper in the React app

Create `pages/src/lib/api.ts`:

```typescript
import type {
  CompareRequest,
  CompareStartResponse,
  CompareStatusResponse,
} from "../../../shared/api";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function startCompare(req: CompareRequest): Promise<CompareStartResponse> {
  return http<CompareStartResponse>("/api/compare", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function getCompareStatus<ResultT = unknown>(
  comparisonId: string
): Promise<CompareStatusResponse<ResultT>> {
  return http<CompareStatusResponse<ResultT>>(`/api/compare/${comparisonId}`, {
    method: "GET",
  });
}
```

---

## 6) Add a polling hook (UI polls for status)

Create `pages/src/hooks/useComparisonPoll.ts`:

```typescript
import { useEffect, useRef, useState } from "react";
import type { CompareStatusResponse } from "../../../shared/api";
import { getCompareStatus } from "../lib/api";

type PollState<ResultT> = {
  status: "idle" | "running" | "completed" | "failed";
  result: ResultT | null;
  error: string | null;
};

export function useComparisonPoll<ResultT = unknown>(
  comparisonId: string | null,
  intervalMs = 1200,
  maxAttempts = 200
) {
  const [state, setState] = useState<PollState<ResultT>>({
    status: "idle",
    result: null,
    error: null,
  });

  const attemptsRef = useRef(0);

  useEffect(() => {
    if (!comparisonId) {
      setState({ status: "idle", result: null, error: null });
      attemptsRef.current = 0;
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    setState({ status: "running", result: null, error: null });
    attemptsRef.current = 0;

    const tick = async () => {
      if (cancelled) return;

      attemptsRef.current += 1;
      if (attemptsRef.current > maxAttempts) {
        setState({
          status: "failed",
          result: null,
          error: "Timed out waiting for comparison result.",
        });
        return;
      }

      try {
        const resp: CompareStatusResponse<ResultT> =
          await getCompareStatus<ResultT>(comparisonId);

        if (resp.status === "running") {
          setState((s) => ({ ...s, status: "running" }));
        } else if (resp.status === "failed") {
          setState({
            status: "failed",
            result: null,
            error: resp.error ?? "Comparison failed.",
          });
          return;
        } else {
          setState({
            status: "completed",
            result: (resp.result ?? null) as ResultT | null,
            error: null,
          });
          return;
        }
      } catch (e: any) {
        setState({
          status: "failed",
          result: null,
          error: e?.message ?? "Request failed.",
        });
        return;
      }

      timer = window.setTimeout(tick, intervalMs);
    };

    timer = window.setTimeout(tick, 0);

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [comparisonId, intervalMs, maxAttempts]);

  return state;
}
```

---

## 7) Replace the default App UI with the minimal MVP UI

Replace `pages/src/App.tsx`:

```typescript
import { useState } from "react";
import { startCompare } from "./lib/api";
import { useComparisonPoll } from "./hooks/useComparisonPoll";

export default function App() {
  const [leftUrl, setLeftUrl] = useState("");
  const [rightUrl, setRightUrl] = useState("");
  const [comparisonId, setComparisonId] = useState<string | null>(null);

  const poll = useComparisonPoll<any>(comparisonId);

  async function onCompare() {
    setComparisonId(null);
    const { comparisonId } = await startCompare({ leftUrl, rightUrl });
    setComparisonId(comparisonId);
  }

  return (
    <div style={{ maxWidth: 900, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
      <h1>cf_ai_env_drift_analyzer</h1>
      <p>Compare two environments and get an explanation for drift (MVP UI).</p>

      <div style={{ display: "grid", gap: 8 }}>
        <input
          placeholder="Left URL (e.g., https://staging.example.com/api/health)"
          value={leftUrl}
          onChange={(e) => setLeftUrl(e.target.value)}
        />
        <input
          placeholder="Right URL (e.g., https://prod.example.com/api/health)"
          value={rightUrl}
          onChange={(e) => setRightUrl(e.target.value)}
        />
        <button
          onClick={onCompare}
          disabled={!leftUrl || !rightUrl || poll.status === "running"}
        >
          {poll.status === "running" ? "Comparing..." : "Compare"}
        </button>
      </div>

      <div style={{ marginTop: 20 }}>
        <strong>Status:</strong> {poll.status}
        {comparisonId && (
          <div style={{ opacity: 0.7, marginTop: 6 }}>
            comparisonId: <code>{comparisonId}</code>
          </div>
        )}

        {poll.error && (
          <pre style={{ marginTop: 12, padding: 12, background: "#fee" }}>
            {poll.error}
          </pre>
        )}

        {poll.status === "completed" && poll.result && (
          <pre style={{ marginTop: 12, padding: 12, background: "#f6f8fa", overflowX: "auto" }}>
            {JSON.stringify(poll.result, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
```

---

## 8) Sanity check: run the frontend

From `/pages`:

```bash
npm run dev
```

Open: `http://localhost:5173`

**Expected behavior for now:**
- Clicking Compare will fail (backend not built yet).
- That's fine — the skeleton is complete.

---

## 9) Cloudflare Pages deployment settings (later)

When you create the Pages project:

- **Root directory:** `pages`
- **Build command:** `npm run build`
- **Build output directory:** `dist`

---

## 10) Done criteria (stop here and move to backend)

You are done with frontend setup when:

✓ Vite + React runs locally
✓ The app has:
  - Two URL inputs
  - Compare button
  - Status display
  - Polling hook wired
✓ No additional UI work is required until backend returns real results

---

## Next step: Backend implementation

Start backend implementation with stable API contracts:

- `POST /api/compare` → `{ comparisonId }`
- `GET /api/compare/:id` → `{ status, result? }`


# Backend Tracker — Phase-by-Phase Plan (cf_ai_env_drift_analyzer)

SignalEnvelope contract → deterministic diff → ActiveProbeProvider (manual redirects) → SQLite DO ring buffer → LLM structured output → Workflows → API routes

This tracker breaks backend implementation into phases with clear deliverables and acceptance criteria.
Frontend is intentionally minimal and comes first; this document starts after frontend is done.

---

## Phase B0 — Backend Bootstrap

### Goals
- Set up Cloudflare Worker project scaffolding.
- Ensure local dev works end-to-end for `/api/health`.

### Tasks
- [ ] Initialize Worker (TypeScript) with Wrangler
- [ ] Add basic router in `src/worker.ts`
- [ ] Implement `GET /api/health` returning `{ ok: true }`
- [ ] Add `shared/` folder (if not already) for types used by both frontend/backend

### Deliverables
- `wrangler.toml`
- `src/worker.ts`
- `src/api/routes.ts` (or routing inline)
- `wrangler dev` runs on `http://localhost:8787`

### Acceptance Criteria
- `curl http://localhost:8787/api/health` returns HTTP 200 with JSON.

---

## Phase B1 — Contracts & Types (Schema Lock)

### Goals
- Define canonical schemas and API DTOs.
- Keep downstream code dependent only on these contracts.

### Tasks
- [ ] Define `SignalEnvelope` (versioned) in `shared/signal.ts`
- [ ] Define `EnvDiff` + `DiffFinding` in `shared/diff.ts`
- [ ] Define API DTOs in `shared/api.ts`
  - `CompareRequest`
  - `CompareStartResponse`
  - `CompareStatusResponse`
- [ ] (Optional) Define `CompareResult` output schema (can be partial until LLM phase)

### Deliverables
- `shared/signal.ts`
- `shared/diff.ts`
- `shared/api.ts`

### Acceptance Criteria
- All types compile; no backend logic yet required.

---

## Phase B2 — Deterministic Diff Engine (No AI)

### Goals
- Implement deterministic drift detection from two SignalEnvelopes.
- Output structured diff findings (no LLM).

### Tasks
- [ ] Implement `computeDiff(left, right) -> EnvDiff`
- [ ] Implement `classifyDiff(diff) -> { findings, severity, flags }`
- [ ] Cover drift categories:
  - Routing drift (redirect chain, final URL, status changes)
  - Security drift (CORS-related headers, www-authenticate presence)
  - Cache drift (cache-control, vary)
  - Timing drift (duration delta thresholds)

### Deliverables
- `src/analysis/diff.ts`
- `src/analysis/classify.ts`

### Acceptance Criteria
- Given two mocked SignalEnvelopes, diff output matches expected results.

---

## Phase B3 — Signal Provider Layer + ActiveProbeProvider (Manual Redirects)

### Goals
- Implement provider seam for signal collection.
- MVP provider performs active HTTP probes and returns SignalEnvelope.

### Tasks
- [ ] Create provider interface:
  - `probe(url, runnerContext) -> SignalEnvelope`
- [ ] Implement `ActiveProbeProvider`:
  - Use `fetch(..., { redirect: "manual" })`
  - Follow redirects manually:
    - maxRedirects = 10
    - detect loops (visited set)
    - resolve relative Location → absolute
  - Whitelist response headers:
    - `access-control-*`, `cache-control`, `vary`, `content-type`, `www-authenticate`, `location`
  - Measure total duration (ms)
- [ ] Attach runner context from inbound `request.cf` as `runner_context` (colo/asn/country)

### Deliverables
- `src/providers/types.ts`
- `src/providers/activeProbe.ts`

### Acceptance Criteria
- Temporary test endpoint (can be removed later):
  - `GET /api/probe?url=...` returns valid SignalEnvelope JSON
- Redirect chain is captured (when present).

---

## Phase B4 — Durable Object (SQLite) + Ring Buffer Retention

### Goals
- Create SQLite-backed Durable Object to store probe/comparison history.
- Implement bounded retention (ring buffer) without alarms.

### Tasks
- [ ] Design keying: DO instance per env-pair (`pairKey`)
- [ ] Implement SQLite schema in DO:
  - `comparisons(id, ts, left_url, right_url, status, result_json, error)`
  - `probes(id, comparison_id, ts, side, url, envelope_json)`
- [ ] Implement DO methods:
  - `createComparison(leftUrl, rightUrl) -> comparisonId`
  - `setStatus(comparisonId, status)`
  - `saveProbe(comparisonId, side, envelope)`
  - `saveResult(comparisonId, resultJson)`
  - `failComparison(comparisonId, error)`
  - `getComparison(comparisonId) -> status/result/error`
- [ ] Ring buffer:
  - keep last N comparisons (e.g., 50) per DO instance
  - delete oldest beyond N on insert

### Deliverables
- `src/storage/envPairDO.ts`
- `wrangler.toml` DO bindings

### Acceptance Criteria
- Can create a comparison record, set status, store probes, and retrieve it by `comparisonId`.

---

## Phase B5 — LLM Explanation Layer (Structured Output)

### Goals
- Use Workers AI (Llama 3.3) to convert deterministic diff + history into structured explanation.
- Enforce JSON output and validate it.

### Tasks
- [ ] Create prompt builder that takes:
  - `EnvDiff`
  - minimal historical context (e.g., last comparison summary or top findings)
  - URLs/labels
- [ ] Call Workers AI model (Llama 3.3)
- [ ] Require strict JSON output:
  - `summary`
  - `ranked_causes[]` (cause, confidence, evidence)
  - `actions[]` (action, why)
- [ ] Parse + validate output
- [ ] Update `PROMPTS.md` with exact prompts used

### Deliverables
- `src/llm/explain.ts`
- `src/llm/prompts.ts`
- `PROMPTS.md` updated

### Acceptance Criteria
- Given a known diff object, LLM returns valid structured JSON consistently (or fails gracefully).

---

## Phase B6 — Workflows Orchestration (CompareEnvironments Pipeline)

### Goals
- Coordinate probe → diff → LLM → persistence using Workflows.
- Store status/results in DO for UI polling.

### Tasks
- [ ] Implement workflow `CompareEnvironments`:
  1. Validate inputs + compute pairKey
  2. DO `createComparison` (status running)
  3. Probe left, save probe
  4. Probe right, save probe
  5. Compute diff deterministically
  6. Load history snippet from DO (optional)
  7. LLM explain
  8. Save final result to DO (completed) or error (failed)
- [ ] Ensure failures set DO status to failed with clear error messages

### Deliverables
- `src/workflows/compareEnvironments.ts`
- `wrangler.toml` workflow bindings/config

### Acceptance Criteria
- Starting a comparison triggers workflow and results are eventually persisted to DO.

---

## Phase B7 — Public API Endpoints (UI Contract)

### Goals
- Expose minimal API the React UI expects.
- UI polls DO-backed status, not workflow status.

### Tasks
- [ ] `POST /api/compare`
  - validates request
  - starts workflow
  - returns `{ comparisonId }`
- [ ] `GET /api/compare/:comparisonId`
  - reads from DO
  - returns `{ status, result?, error? }`
- [ ] Keep `/api/health`

### Deliverables
- `src/api/routes.ts`
- `src/worker.ts` wiring

### Acceptance Criteria
- UI can start a comparison and poll until completed/failed.

---

## Phase B8 — Hardening & MVP Polishing

### Goals
- Make MVP demo stable and reviewer-friendly.

### Tasks
- [ ] Input validation:
  - enforce `http/https` scheme
  - reject localhost/private IP ranges (optional but recommended)
- [ ] Fetch safety:
  - timeouts (AbortController)
  - max redirects
  - loop detection
- [ ] Clear error classification:
  - DNS/connection failure
  - timeout
  - 401/403 (auth required)
  - redirect loop
- [ ] Remove temporary endpoints (e.g., `/api/probe`) if desired
- [ ] Add “How to demo” notes in README

### Deliverables
- Improved error responses + stability

### Acceptance Criteria
- End-to-end compare is reliable for multiple public test URLs.
- Demo produces understandable results and does not hang indefinitely.

---

## Final MVP Success Criteria (Backend)

- `POST /api/compare` returns a usable `comparisonId`
- `GET /api/compare/:id` returns `running`, then `completed` with result (or `failed` with reason)
- Result includes:
  - deterministic diff findings
  - structured LLM explanation and recommended actions
- DO retains recent history (ring buffer)
