# CLAUDE.md — System Rulebook for cf_ai_env_drift_analyzer

**Authority:** This document governs all AI-assisted coding in this repository. Existing documentation (Backend_System_Architecture.md, MVP_FEATURE_SET.md, MVP_Tracker.md, README.md) is authoritative. This file enforces those contracts as rules.

---

## 1. Contract Enforcement

### 1.1 SignalEnvelope (Canonical Observable Schema)

All signal sources must normalize output to `SignalEnvelope` before any downstream processing.

**Required fields:**
- `schema_version`: "1.0" (string literal)
- `timestamp`: number (milliseconds since epoch)
- `environment`: { id: string, label?: string, target_url: string }
- `runner_context`: { colo?: string, asn?: number, country?: string }
- `routing`: { redirect_chain: string[], final_url: string }
- `response`: { status: number, headers: Record<string, string> }
- `timing`: { duration_ms: number }

**Header whitelist (only these are captured):**
- `access-control-*`
- `cache-control`
- `vary`
- `content-type`
- `www-authenticate`
- `location`

**Invariants:**
- Must not contain non-whitelisted headers
- Must not contain request bodies
- Must not contain auth/credential data
- Must never be modified downstream
- Must be persisted as-is in DO storage

---

### 1.2 EnvDiff + DiffFinding (Deterministic Output)

Diff computation must always output deterministic, machine-readable results.

**EnvDiff structure:**
- `routing`: { redirect_chain_diffs: Change[], final_url_diff: Change?, status_diff: Change? }
- `security`: { cors_header_diffs: Change[], auth_indicators: AuthSignal[] }
- `cache`: { cache_control_diff: Change?, vary_diff: Change? }
- `timing`: { duration_delta_ms: number, classification: "faster" | "slower" | "same" }
- `findings`: DiffFinding[]

**DiffFinding structure:**
- `id`: string (unique identifier within diff)
- `category`: "routing" | "security" | "cache" | "timing"
- `severity`: "info" | "warning" | "critical"
- `evidence`: string[]
- `left_value`: unknown
- `right_value`: unknown

**Invariants:**
- Diff output must be 100% deterministic (same inputs → same output every time)
- No LLM involvement in diff generation
- Must compile from two SignalEnvelopes
- Must be validated before persistence
- Must not contain subjective language

---

### 1.3 LLM Explanation Output (Structured JSON)

Workers AI output must conform to this schema before persistence.

**Required structure:**
```json
{
  "summary": "string",
  "ranked_causes": [
    {
      "cause": "string",
      "confidence": number,
      "evidence": ["string", "..."]
    }
  ],
  "actions": [
    {
      "action": "string",
      "why": "string"
    }
  ],
  "notes": ["string"] (optional)
}
```

**Invariants:**
- `confidence` must be numeric in range [0, 1]
- Must parse as valid JSON
- Must contain all required fields
- If validation fails, mark comparison as `failed` with error "invalid model output"
- Must be grounded in the EnvDiff (never speculative)
- Must load minimal historical context from DO before generation
- Must never reference unavailable signals or make assumptions

---

## 2. Platform & Primitive Stack

### 2.1 Execution Runtime

**Must use Cloudflare Workers only** for HTTP endpoint execution.

Invariants:
- Worker context available as `env`
- Request/response lifecycle same as standard Fetch API
- No Node.js APIs
- Worker timeout: standard (no custom timeouts)

---

### 2.2 Workflow Orchestration

**Must use Cloudflare Workflows** for multi-step pipelines.

Workflow: `CompareEnvironments`

**Execution steps (in order):**
1. Validate inputs and compute `pairKey`
2. DO: `createComparison(leftUrl, rightUrl)` → `comparisonId`, status = `running`
3. Probe left URL via ActiveProbeProvider → SignalEnvelope
4. DO: `saveProbe(comparisonId, "left", envelope)`
5. Probe right URL via ActiveProbeProvider → SignalEnvelope
6. DO: `saveProbe(comparisonId, "right", envelope)`
7. Compute deterministic `EnvDiff` from two envelopes
8. DO: Load history snippet (optional, last comparison summary or top findings)
9. Call Workers AI with `{ diff, history, urls }` → LLM explanation JSON
10. Validate LLM output
11. DO: `saveResult(comparisonId, resultJson)`, status = `completed`
12. **On any exception:** DO: `failComparison(comparisonId, errorMessage)`, status = `failed`

**Invariants:**
- All network operations must use `step.do()` or equivalent Workflow-safe fetch
- No long-running operations outside Workflow (Worker has strict timeouts)
- Failures at any step must propagate to status = `failed` with clear reason
- Workflow is the only entry point for comparison logic

---

### 2.3 Durable Objects (SQLite-Backed State)

**One DO instance per environment pair** (`pairKey`).

**SQLite schema:**

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

CREATE TABLE probes (
  id TEXT PRIMARY KEY,
  comparison_id TEXT,
  ts INTEGER,
  side TEXT CHECK(side IN ('left', 'right')),
  url TEXT,
  envelope_json TEXT
);
```

**DO methods:**
- `createComparison(leftUrl, rightUrl) → { comparisonId, status: "running" }`
- `saveProbe(comparisonId, side, envelope) → void`
- `saveResult(comparisonId, resultJson) → void` (sets status = "completed")
- `failComparison(comparisonId, error) → void` (sets status = "failed")
- `getComparison(comparisonId) → { status, result?, error? }`

**Ring Buffer Retention:**
- Keep last N comparisons per DO instance (default: 50)
- On insert, automatically delete oldest rows beyond N
- Delete associated probes when comparison is deleted
- No alarms; retention is synchronous on write

**Invariants:**
- DO is the authoritative source for comparison state
- Worker never stores comparison state locally
- Worker never makes decisions based on workflow state; always read from DO
- comparisonId encodes pairKey for stateless routing

---

### 2.4 Workers AI (Llama 3.3 Only)

**Only model permitted:** Llama 3.3 via Workers AI

**Constraints:**
- AI must never generate or modify raw signals
- AI must never generate or modify diffs
- AI must only generate explanations grounded in diff + history
- AI output must be validated as JSON before use
- Must include minimal historical context in prompt
- Must not speculate beyond available signals

---

## 3. Logic Separation (Module Boundaries)

### 3.1 Signal Providers (src/providers/)

**Responsibility:** Collect raw data, normalize to SignalEnvelope.

**Files:**
- `src/providers/types.ts` — Provider interface
- `src/providers/activeProbe.ts` — HTTP probe implementation

**Invariants:**
- No diff logic in providers
- No AI logic in providers
- Output must conform to SignalEnvelope schema exactly
- Must handle timeouts, redirects, and errors gracefully

---

### 3.2 Deterministic Diff Engine (src/analysis/)

**Responsibility:** Compare two SignalEnvelopes, produce EnvDiff.

**Files:**
- `src/analysis/diff.ts` — diff computation
- `src/analysis/classify.ts` — finding classification

**Invariants:**
- Pure function: same inputs → identical output every time
- No randomness, no timestamps in output
- No AI/LLM calls
- Must classify findings into routing/security/cache/timing
- Output must conform to EnvDiff schema exactly

---

### 3.3 AI Explanation (src/llm/)

**Responsibility:** Convert diff + history to structured explanation.

**Files:**
- `src/llm/explain.ts` — orchestration and JSON validation
- `src/llm/prompts.ts` — prompt building (update PROMPTS.md after changes)

**Invariants:**
- Must receive EnvDiff as input (never raw signals)
- Must receive history snippet from DO (not generated)
- Must call Workers AI with structured prompt
- Must validate JSON output before returning
- Must fail gracefully on invalid LLM output
- Must not catch and hide validation errors from caller

---

### 3.4 Storage Interface (src/storage/)

**Responsibility:** Interact with Durable Objects.

**Files:**
- `src/storage/envPairDO.ts` — DO methods and SQL

**Invariants:**
- Single source of truth for comparison state
- SQL changes require `npx wrangler migrations apply`
- Ring buffer implementation is synchronous
- No caching of DO state in Worker memory

---

### 3.5 Workflow Orchestration (src/workflows/)

**Responsibility:** Coordinate probe → diff → LLM → persist pipeline.

**Files:**
- `src/workflows/compareEnvironments.ts` — step-by-step workflow

**Invariants:**
- Workflow is the only place where probes, diff, and LLM are orchestrated
- Worker must not call these functions directly
- Worker routes `/api/compare` POST to workflow start only
- Workflow must persist state to DO at each step

---

## 4. Data Flow Rules

### 4.1 Frontend → Backend

**Frontend must never:**
- Poll Workflow status directly
- Access Durable Objects
- Call analysis or LLM functions
- Store comparison state

**Frontend must:**
1. `POST /api/compare` with `{ leftUrl, rightUrl }`
2. Receive `{ comparisonId }` immediately
3. Poll `GET /api/compare/:comparisonId` at regular intervals
4. Stop polling when status is `completed` or `failed`

---

### 4.2 Worker → Workflow

**Worker must:**
- Validate input (scheme, format, IP ranges)
- Compute `pairKey` from URLs
- Encode `pairKey` in `comparisonId` as prefix: `${pairKey}:${uuid}`
- Start Workflow with `{ comparisonId, leftUrl, rightUrl, pairKey }`
- Return immediately with `{ comparisonId }`

**Worker must not:**
- Wait for Workflow completion
- Cache Workflow results
- Make decisions based on Workflow state

---

### 4.3 Workflow → Durable Object

**Workflow must:**
- Call DO methods only via step.do()
- Persist probes after each provider call
- Persist final result before completion
- Set status field on every state change
- Propagate all errors to `failComparison`

**Workflow must not:**
- Assume DO response is cached
- Make multiple calls to same DO in single step

---

### 4.4 Worker → Durable Object (Poll)

**Worker must:**
- Extract `pairKey` from `comparisonId` prefix
- Route poll request to correct DO instance
- Return `{ status }` if running
- Return `{ status, result }` if completed
- Return `{ status, error }` if failed

---

## 5. Implementation Constraints

### 5.1 ActiveProbeProvider (Redirect Handling)

**Must use `fetch(..., { redirect: "manual" })`**

Redirect algorithm:
1. Initialize: `currentUrl = targetUrl`, `visited = new Set()`
2. For up to 10 iterations:
   - `fetch(currentUrl, { redirect: "manual", timeout: 10000 })`
   - If status is 301/302/303/307/308 and has `Location`:
     - Resolve `Location` to absolute URL
     - If URL already in `visited`: fail with "redirect loop"
     - Add `currentUrl` to `visited`
     - Add resolved URL to `redirect_chain`
     - Set `currentUrl = nextUrl`, continue
   - Else: Break; final response reached
3. Build final `SignalEnvelope` with captured chain

**Invariants:**
- Must not use `fetch(..., { redirect: "follow" })`
- Must detect redirect loops
- Must measure total duration including all redirects
- Must resolve relative Location headers to absolute URLs
- Must timeout at 10 seconds total

---

### 5.2 URL Validation (SSRF Protection)

**Must reject:**
- Non-http/https schemes (file://, ftp://, etc.)
- Localhost: 127.0.0.1, localhost, ::1
- Private IP ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
- Link-local: 169.254.0.0/16

**Must reject before:**
- Starting Workflow
- Calling any provider
- Creating DO comparison record

---

### 5.3 Workflow Network Operations

**All fetch calls must use `step.do()`**

```typescript
const result = await step.do('stepName', async () => {
  return fetch(url, options);
});
```

**Invariants:**
- No direct `fetch()` in Workflow steps
- Each step must be retry-safe
- Each step must use AbortController with timeout

---

### 5.4 SQLite Migrations

**Schema changes require:**
1. Create migration file: `migrations/YYYYMMDDHHMMSS_description.sql`
2. Run: `npx wrangler migrations apply --local` (dev)
3. Run: `npx wrangler migrations apply --remote` (production)
4. Never modify schema without migration

---

## 6. Development Workflow

### 6.1 Local Development Commands

**Frontend (from `/pages`):**
```bash
npm install
npm run dev        # Runs on http://localhost:5173
```

**Backend (from repository root):**
```bash
npm install
wrangler dev       # Runs on http://localhost:8787
```

**Frontend `.env` must contain:**
```
VITE_API_BASE_URL=http://localhost:8787
```

**Invariants:**
- Frontend and backend must run in parallel for local dev
- Backend must be running before frontend attempts API calls
- Both processes must be able to restart independently

---

### 6.2 Directory Ownership

```
/pages              — React + Vite UI only
/src                — Worker + Workflow + Providers + Analysis + LLM + Storage
/shared             — Shared TypeScript types (used by /pages and /src)
/migrations         — SQLite migration files
```

**Invariants:**
- `/pages` does not import from `/src`
- `/src` does not import from `/pages`
- `/shared` is the only cross-boundary module
- No sibling imports across `/src` submodules (use `/shared` for contracts)

---

### 6.3 Type Safety

**Must use TypeScript strictly.**

**Invariants:**
- All API boundaries must be typed (request/response DTOs)
- All Durable Object methods must be typed
- Workflow steps must type their outputs
- JSON parsing must be validated (not assumed)
- Use `as const` for enum-like values (status, category, severity)

---

## 7. Data Persistence & Retrieval

### 7.1 Comparison Lifecycle

```
POST /api/compare
  ↓
Worker validates + starts Workflow, returns comparisonId
  ↓
Workflow creates DO record (status = "running")
  ↓
Workflow saves probes to DO
  ↓
Workflow computes diff
  ↓
Workflow calls LLM
  ↓
Workflow saves result + status = "completed"
  (or status = "failed" on error)
  ↓
GET /api/compare/:comparisonId polls DO until !running
```

---

### 7.2 History Retrieval (Context for LLM)

Before calling LLM:
1. Load last N completed comparisons for this `pairKey`
2. Extract summary or top findings
3. Pass as `history` context to LLM prompt
4. LLM may reference this history in explanation

**Invariants:**
- History is optional; LLM must work without it
- History is read-only during comparison
- History is not modified during active comparison
- Only completed comparisons are used as history

---

## 8. Error Handling & Validation

### 8.1 Probe Errors

**Must handle gracefully:**
- DNS resolution failure → `{ status, error: "DNS error" }`
- Network timeout (10s) → `{ status, error: "Timeout" }`
- Redirect loop → `{ status, error: "Redirect loop detected" }`
- Non-whitelisted headers → Silently skip
- Missing status code → Fail probe with clear error

---

### 8.2 Diff Validation

Diff engine must validate before returning:
- Two SignalEnvelopes present
- No null fields that must be populated
- Findings array is populated or empty (never undefined)

---

### 8.3 LLM Output Validation

Before persisting, validate:
- JSON parses without error
- `summary` is string and non-empty
- `ranked_causes` is array
- Each cause has `confidence` as number in [0, 1]
- `actions` is array
- If any validation fails: mark comparison `failed` with error

---

### 8.4 Workflow Failure Propagation

**Any step failure must:**
1. Catch error
2. Call `step.do()` to update DO: `failComparison(comparisonId, errorMessage)`
3. Re-throw or return failure signal
4. Ensure status = `failed` is persisted

---

## 9. Security & Abuse Mitigation

### 9.1 Input Validation

**All inputs must be validated in Worker before Workflow:**
- `leftUrl` and `rightUrl` are non-empty, valid URLs
- Scheme is http or https only
- Hostname is not localhost, 127.0.0.1, or private IP range
- Hostname resolves (attempt via DNS or fail fast)

---

### 9.2 Header Privacy

**All stored headers are whitelisted; no secrets in storage:**
- Authorization headers: never captured
- Cookies: never captured
- X-* custom headers: only if whitelisted
- User-provided headers: never sent with probe

---

### 9.3 Rate Limiting (Optional but Recommended)

If rate limiting is implemented:
- Track per-IP or per-user
- Soft cap: reject with 429 if exceeded
- Store in DO for durability or in-memory for speed

---

## 10. Observability & Logging

### 10.1 Required Logging Points

Log at:
1. `comparisonId` creation (with pairKey)
2. Probe start and result (status, duration, redirects)
3. Diff generation (number of findings)
4. LLM call (tokens, latency, validation result)
5. Workflow completion or failure

**Log format:**
- Structured JSON (optional but recommended)
- Include `comparisonId` in all logs for tracing
- Never log request/response bodies or headers (unless explicitly non-sensitive)

---

### 10.2 Error Reporting

**Clear error messages must:**
- State which step failed
- Reference `comparisonId` for tracing
- Avoid exposing internal stack traces to frontend
- Be actionable for developer (DNS error vs timeout vs auth required)

---

## 11. Extensibility Points (Phase 2+)

### 11.1 New Signal Providers

New providers may be added to `src/providers/` if:
1. They normalize output to SignalEnvelope
2. They do not modify downstream (diff, LLM)
3. They are backward-compatible with existing schema_version

---

### 11.2 Expanded Analysis

New analysis functions may be added to `src/analysis/` if:
1. They remain deterministic
2. They output findings conforming to DiffFinding structure
3. They do not depend on external state

---

### 11.3 Richer LLM Context

LLM may accept additional context fields if:
1. Schema version in diff/envelope is incremented
2. LLM gracefully ignores unknown fields
3. Validation still passes for older versions

---

## 12. Deployment & Production

### 12.1 Wrangler Configuration

**wrangler.toml must define:**
- Worker entry point: `src/worker.ts`
- Durable Objects binding: `ENVPAIR_DO` with migration path
- Workflow binding: `COMPARE_WORKFLOW`
- Workers AI binding: `AI`
- Environment variables: `VITE_API_BASE_URL` (if same-domain routing)

---

### 12.2 Schema Versioning

**SignalEnvelope schema_version must be:**
- Incremented only on breaking changes
- Checked by diff engine before processing
- Included in error messages if version mismatch

---

### 12.3 Backward Compatibility

**When upgrading:**
- Old schema versions must be readable (convert or reject gracefully)
- Diff engine must handle version mismatches
- LLM must not break on new fields it doesn't recognize

---

## 13. Prohibited Actions

**Must never:**
- Modify SignalEnvelope after creation (outside provider)
- Call LLM before computing diff
- Access Workflow state directly from Worker
- Cache DO state in Worker memory across requests
- Store secrets or credentials in any form
- Accept user-provided headers in probe requests
- Follow redirects automatically (must use manual mode)
- Generate findings without deterministic algorithm
- Skip validation of LLM output
- Assume probe succeeded without checking status
- Use `fetch(..., { redirect: "follow" })`
- Modify comparison state outside DO methods
- Call Worker functions directly from Workflow
- Use timestamps for comparison logic (only for storage metadata)
- Speculate in LLM output (ground in diff only)

---

## 14. Required Documentation

**Must maintain:**
- `PROMPTS.md` — Exact prompts sent to Workers AI (update after every LLM change)
- This file (`CLAUDE.md`) — Updated when contracts change
- TypeScript types — All contracts in `/shared`

**Never:**
- Invent undocumented behavior
- Change contracts without updating all three

---

## 15. Code Review Checklist

Before merging any PR:
- [ ] No new SignalEnvelope fields without schema_version bump
- [ ] All Workflow network ops use step.do()
- [ ] Diff output is deterministic (test with same input twice)
- [ ] LLM output validated before persistence
- [ ] DO methods called only from Workflow
- [ ] Ring buffer retention verified
- [ ] Error propagated to DO.failComparison
- [ ] Frontend only polls DO via Worker API
- [ ] URL validation rejects private IPs
- [ ] Redirect algorithm uses redirect: "manual"
- [ ] PROMPTS.md updated if LLM prompt changed
- [ ] No new module imports across /pages ↔ /src boundary
- [ ] Types added to /shared, not duplicated

---

**Last Updated:** 2026-01-05
**Version:** 1.0 (MVP)
