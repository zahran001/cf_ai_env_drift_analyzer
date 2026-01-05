# Backend System Design Architecture

> A comprehensive system design for the backend of **cf_ai_env_drift_analyzer**, aligned with our MVP + refinements (SignalEnvelope contract, ActiveProbeProvider w/ manual redirects, SQLite-backed Durable Objects w/ ring buffer, Workflows orchestration, UI polling DO-backed status, Workers AI Llama 3.3).

## 1. Goals and Non-Goals

### MVP Goals

- Compare two environment URLs for a request (GET) and detect environment drift
- Collect observable signals (status, redirect chain, whitelisted headers, timing)
- Compute deterministic drift diff (routing/security/cache/timing)
- Use LLM to produce structured explanations + actions, grounded in diff + history
- Persist state and history with SQLite-backed Durable Objects
- Support UI via start + poll API (comparisonId), not long-lived connections

### MVP Non-Goals

- Auth/cookies/secret handling
- Multi-region synthetic probes
- RUM ingestion, HAR uploads
- Logs/traces integrations
- Automated remediation

## 2. High-Level Component Architecture

### Cloudflare Primitives

- **Worker** (API Gateway + Orchestrator): Handles `/api/*` routes, starts workflows, routes reads/writes to Durable Objects
- **Workflows** (Pipeline coordinator): Runs multi-step probe → diff → LLM → persist without timeout risk
- **Durable Objects** (SQLite state): Authoritative store for comparisons, probes, and bounded history
- **Workers AI** (Llama 3.3): Generates structured explanation from deterministic diff + history

### Logical Modules Inside Worker Codebase

- **`providers/`** — Signal collection sources (MVP: ActiveProbeProvider)
- **`analysis/`** — Deterministic diff computation + classification
- **`llm/`** — Prompt building + model invocation + JSON validation
- **`storage/`** — DO interface and SQL operations
- **`workflows/`** — Orchestration pipeline
- **`api/`** — HTTP routes

## 3. End-to-End Request Flow

### A. Start Comparison (UI → Worker)

1. React UI calls: `POST /api/compare` with `{ leftUrl, rightUrl }`
2. Worker validates input and computes an env-pair key (`pairKey`)
3. Worker obtains DO stub for that `pairKey` and creates a comparison record:
   - `status = running`
   - Returns a new `comparisonId`
4. Worker starts a Workflow run (`CompareEnvironments`) with `{ comparisonId, leftUrl, rightUrl, pairKey }`
5. Worker responds immediately: `{ comparisonId }`

### B. Workflow Execution (Worker/Workflows → Providers/Analysis/LLM → DO)

**Workflow steps:**

1. Probe left URL via `ActiveProbeProvider` → `SignalEnvelope`
2. Persist left probe envelope in DO
3. Probe right URL → `SignalEnvelope`
4. Persist right probe envelope
5. Compute deterministic `EnvDiff` + findings
6. Load small history snippet from DO (e.g., last comparison summary / recurring findings)
7. Call Workers AI with `{ diff, history, urls }` → structured explanation JSON
8. Persist final result JSON in DO; `status = completed`
9. On failure, persist error; `status = failed`

### C. Poll for Status/Result (UI → Worker → DO)

1. UI polls: `GET /api/compare/:comparisonId`
2. Worker routes to DO for the appropriate `pairKey` (either by embedding pairKey in comparisonId or via lookup table)
3. DO returns `{ status, result?, error? }`
4. UI stops polling on `completed`/`failed`

## 4. Data Contracts (Canonical Schemas)

### 4.1 SignalEnvelope (Canonical Inter-Step Contract)

**Purpose:** Normalize all signal sources into a stable schema so downstream logic never depends on provider specifics.

**Core fields (MVP):**

```typescript
{
  schema_version: "1.0"
  timestamp: number
  environment: { id: string, label?: string, target_url: string }
  runner_context: { colo?: string, asn?: number, country?: string }  // from request.cf
  routing: { redirect_chain: string[], final_url: string }
  response: { status: number, headers: Record<string,string> }  // whitelisted only
  timing: { duration_ms: number }
}
```

### 4.2 EnvDiff + Findings

**Purpose:** Deterministic, machine-readable drift description.

- **routing:** redirect chain diffs, final URL diffs, status diffs
- **security:** CORS header diffs, auth indicators (401/403 or www-authenticate)
- **cache:** cache-control/vary diffs
- **timing:** duration delta and threshold classification
- **findings[]:** List of normalized findings with: `id`, `category`, `severity`, `evidence`, `left_value`, `right_value`

### 4.3 LLM Explanation Output (Strict JSON)

**Purpose:** UI-friendly structured explanation grounded in diff.

```typescript
{
  summary: string
  ranked_causes: Array<{
    cause: string
    confidence: number  // 0..1
    evidence: string[]
  }>
  actions: Array<{
    action: string
    why: string
  }>
  notes?: string[]
}
```

**Validation:**

- Must parse as JSON
- Must contain required fields
- Confidence must be numeric 0..1
- If invalid: mark comparison failed with "invalid model output" (or fallback to deterministic-only result)

## 5. Durable Object Design (SQLite-Backed)

### 5.1 Why a DO Per Environment Pair?

- **Natural partitioning:** All comparisons between the same two environments share context/history
- **Strong consistency** for that pair
- **Easy ring-buffer retention**

### 5.2 Keying Strategy

You need a stable way to route `comparisonId` polls to the correct DO.

**Option A (Recommended):** Encode pairKey in comparisonId

```
comparisonId = "${pairKey}:${uuid}"
```

Poll request includes `comparisonId`; Worker extracts `pairKey` prefix → routes to correct DO without global lookup.

**Option B:** Global lookup DO

- A single "Index DO" maps `comparisonId` → `pairKey`
- Adds one more component; more complexity

**Use Option A for MVP.**

### 5.3 SQLite Schema (MVP)

**Inside each env-pair DO:**

**`comparisons` table:**

```sql
CREATE TABLE comparisons (
  id TEXT PRIMARY KEY,
  ts INTEGER,
  left_url TEXT,
  right_url TEXT,
  status TEXT CHECK(status IN ('running', 'completed', 'failed')),
  result_json TEXT NULL,
  error TEXT NULL
);
```

**`probes` table:**

```sql
CREATE TABLE probes (
  id TEXT PRIMARY KEY,
  comparison_id TEXT,
  ts INTEGER,
  side TEXT CHECK(side IN ('left', 'right')),
  url TEXT,
  envelope_json TEXT
);
```

**Optional (MVP-light):**

- `known_findings` table for recurring drift across comparisons

### 5.4 Retention / Ring Buffer

Avoid alarms in MVP. Do bounded retention on insert:

- Keep last N comparisons (e.g., 50) per DO
- On new insert, delete oldest rows beyond N (and associated probes)

## 6. ActiveProbeProvider Design (Manual Redirects)

### Responsibilities

- Execute a GET request to a target URL
- Capture redirect chain and final response
- Extract whitelisted headers
- Measure total duration
- Produce `SignalEnvelope`

### Redirect Handling Algorithm (MVP)

1. Start with `currentUrl = targetUrl`
2. For up to `maxRedirects` (10):
   - `fetch(currentUrl, { redirect: "manual" })`
   - If status is 301/302/303/307/308 and has `Location`:
     - Resolve location to absolute URL
     - Add to `redirect_chain`
     - **Loop detection:** If already visited, stop with error "redirect loop"
     - Set `currentUrl = nextUrl`, continue
   - Else: Final response reached; stop

### Header Whitelisting

Only collect:

- `access-control-*`
- `cache-control`
- `vary`
- `content-type`
- `www-authenticate`
- `location` (for debugging final redirect responses)

### Timeout Safety

Use `AbortController` per request or per full chain with a fixed total timeout (e.g., 10s).

## 7. Workflow Design (CompareEnvironments Pipeline)

### Why Workflows?

- Avoid Worker execution timeouts when doing 2 probes + LLM call
- Provide explicit, auditable steps

### Workflow Steps (MVP)

1. Validate URLs again (defense-in-depth)
2. DO: `createComparison` (status = `running`)
3. Probe left → persist probe
4. Probe right → persist probe
5. Compute deterministic `EnvDiff` → findings
6. DO: Load recent history snippet (last comparison result summary)
7. Call LLM: Explain diff
8. DO: Persist result + status = `completed`
9. **On any exception:** DO status = `failed` with error message

## 8. API Surface

### `POST /api/compare`

**Request:**

```json
{
  "leftUrl": "https://staging.example.com",
  "rightUrl": "https://prod.example.com",
  "leftLabel": "staging",
  "rightLabel": "prod"
}
```

**Response:**

```json
{
  "comparisonId": "pairKey:uuid"
}
```

### `GET /api/compare/:comparisonId`

**Response (running):**

```json
{
  "status": "running"
}
```

**Response (completed):**

```json
{
  "status": "completed",
  "result": { /* CompareResult */ }
}
```

**Response (failed):**

```json
{
  "status": "failed",
  "error": "..."
}
```

### Optional Debugging Endpoints (Dev Only)

- `GET /api/health`
- `GET /api/probe?url=...` (temporary)

## 9. CompareResult Shape (What You Persist and Return)

For MVP, a clean result object looks like:

```typescript
{
  "left": {
    "url": "https://staging.example.com",
    "envelope": { /* SignalEnvelope */ }
  },
  "right": {
    "url": "https://prod.example.com",
    "envelope": { /* SignalEnvelope */ }
  },
  "diff": { /* EnvDiff */ },
  "findings": [ /* DiffFinding[] */ ],
  "explanation": { /* LLMExplanation */ },
  "meta": {
    "created_at": 1704067200000,
    "runner_context": {
      "colo": "lhr",
      "asn": 1234,
      "country": "US"
    }
  }
}
```

> **Note:** You may choose not to return full envelopes to UI for brevity; but keeping them in storage is useful.

## 10. Security and Abuse Considerations (MVP-Safe)

Even in MVP, probing arbitrary URLs can be abused. Add guardrails:

### URL Validation

**Allow only:** `http://`, `https://`

**Reject:**

- `file://`, `ftp://`, etc.
- Localhost: `localhost`, `127.0.0.1`
- Private IP ranges: `10/8`, `172.16/12`, `192.168/16`
- Link-local: `169.254/16`

This helps mitigate SSRF-like probing.

### Rate Limiting (Light)

- Per-IP rate limit in Worker (basic in-memory or DO-based) or simple "soft cap"

### Header Privacy

- You only store **whitelisted headers**
- You do **not** accept user-provided Authorization headers in MVP

## 11. Observability (Simple But Effective)

### MVP Logging

- Log each `comparisonId` creation
- Log provider probe summary (status, duration, redirects)
- Log workflow completion/failure

### Future

- Add structured logs / trace IDs, but keep MVP lean

## 12. Deployment Topology

**Pages (React)** deployed separately.

**Worker backend** deployed and reachable at `/api/*`.

### Two Common Setups

| Setup | Description |
|-------|-------------|
| **Same-domain routing** | Pages + Worker behind same host (ideal UX) |
| **Separate domains** | UI calls Worker via env var (what you do locally now) |

For MVP, **separate is fine**; same-domain is polish.

## 13. Extensibility Points (Phase 2-Friendly)

Because everything downstream depends on `SignalEnvelope`, you can add:

- **HARUploadProvider** → Maps HAR timings + headers to envelope
- **RUMBeaconProvider** → Maps NavigationTiming to envelope.timing
- **ProxyProvider** → Always-on capture
- **Multi-region probing** → Run providers from multiple colos and store multiple envelopes per env per run
- **Trend analysis** → SQL queries across probes/comparisons

**No refactor required**—just new providers + richer analysis.

## 14. System Architecture Diagram

```
┌─────────────────────┐
│  React Pages UI     │
└──────────┬──────────┘
           │
           │ POST /api/compare (leftUrl, rightUrl)
           v
┌──────────────────────────────────────────────────────┐
│         Worker API Router                            │
└──────────┬──────────────────────────────┬────────────┘
           │                              │
           │ starts workflow              │ GET /api/compare/:id (poll)
           v                              │
    ┌──────────────────────┐              │
    │  Workflow:           │              │
    │  CompareEnvironments │              │
    └──────────┬───────────┘              │
               │                          │
               │ probe left/right         │
               v                          │
    ┌──────────────────────┐              │
    │ ActiveProbeProvider  │              │
    └──────────┬───────────┘              │
               │                          │
               │ SignalEnvelope           │
               v                          │
    ┌──────────────────────┐              │
    │  Deterministic Diff  │              │
    │  Engine              │              │
    └──────────┬───────────┘              │
               │ EnvDiff + Findings       │
               v                          │
    ┌──────────────────────┐              │
    │  Workers AI:         │              │
    │  Llama 3.3           │              │
    └──────────┬───────────┘              │
               │ Explanation JSON         │
               v                          │
┌──────────────────────────────────────────┐
│  Durable Object (SQLite) per env-pair  │◄─┘
│  - comparisons table                     │
│  - probes table                          │
│  - ring buffer                           │
└──────────────────────────────────────────┘
```

---