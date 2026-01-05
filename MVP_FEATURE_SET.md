# MVP Scope & Refinements — cf_ai_env_drift_analyzer

This document defines the finalized MVP feature set for `cf_ai_env_drift_analyzer`, along with deliberate refinements made to balance scope, extensibility, and delivery speed. It also outlines Phase 2 work that is explicitly out of scope for the MVP.

---

## 1. MVP Objective

Provide a clear, AI-generated explanation for *why the same HTTP request behaves differently across two environments*, using normalized, observable request/response signals and persistent historical context.

The MVP prioritizes **developer understanding and explainability** over automation or optimization.

---

## 2. Core Architectural Contracts

### 2.1 SignalEnvelope (Canonical Contract)

All observable behavior for a single environment is represented using a versioned `SignalEnvelope` schema.

- All signal providers normalize into this format
- Downstream components (diffing, storage, LLM prompting) depend only on this schema
- Fields are optional where signals may not be available
- `schema_version` is included for forward compatibility

This ensures that new signal sources can be added without refactoring existing logic.

---

### 2.2 Signal Providers

Signal providers are responsible for collecting raw data and normalizing it into `SignalEnvelope`.

#### MVP Provider
- **ActiveProbeProvider**
  - Worker performs a `GET` request to the target URL
  - Captures redirects, selected headers, and elapsed time

#### Supported by Design (Out of MVP Scope)
- HAR upload provider
- RUM beacon provider
- Edge proxy / middleware provider
- Logs or tracing provider

---

## 3. MVP Signal Collection

The MVP limits signal collection to **observable, request-level data**.

### 3.1 Routing Signals
- Final HTTP status code
- Redirect count
- Redirect chain locations

### 3.2 Response Headers (Whitelisted)
- `access-control-*`
- `cache-control`
- `vary`
- `content-type`
- `www-authenticate`
- `location`

### 3.3 Timing Signals
- Total elapsed request time (measured by the Worker)

### 3.4 Runner Context (Cloudflare Metadata)

The system captures Cloudflare metadata from `request.cf` for the **analysis runner context**, including:
- Colo
- ASN
- Country

This metadata represents where the analysis was executed from and is used for reproducibility and future multi-region probing. It is **not treated as authoritative information about the target environment**.

---

## 4. Drift Detection (Deterministic)

The MVP performs deterministic comparison between two `SignalEnvelope`s and classifies differences into:

### 4.1 Security Drift
- Presence or absence of CORS-related headers
- Indicators of authentication or policy enforcement
- Signals that may trigger browser preflight behavior

### 4.2 Routing Drift
- Redirect chain differences
- HTTP → HTTPS normalization
- Hostname normalization (e.g., `www` vs apex)

### 4.3 Cache Drift
- Cache-control directive differences
- Presence or absence of cache variance hints

The output is a structured, machine-readable diff.

---

## 5. AI Explanation (MVP Agent Behavior)

Using Workers AI (Llama 3.3), the agent:
- Summarizes observed differences
- Hypothesizes likely root causes
- Ranks causes by confidence
- Suggests 1–3 actionable next steps

The LLM operates only on:
- The structured diff
- Relevant historical context retrieved from Durable Objects

Speculative or ungrounded explanations are explicitly avoided.

---

## 6. Memory & State (SQLite-backed Durable Objects)

Each environment pair is backed by a SQLite-backed Durable Object.

### MVP Storage Strategy
- Store individual probe results
- Store comparison summaries
- Store known recurring differences

To control storage growth:
- Each environment pair retains a bounded number of recent records (ring buffer strategy)
- Oldest entries are deleted on insert once the limit is reached

This approach avoids scheduled background jobs while preserving recent historical context.

---

## 7. Workflow Orchestration

### Workflow: `CompareEnvironments`

1. Validate inputs and generate environment identifiers
2. Invoke signal provider(s) to produce two `SignalEnvelope`s
3. Compute deterministic drift diff
4. Load relevant historical context
5. Invoke LLM for explanation and recommendations
6. Persist probe and comparison data
7. Return structured response to the UI

Workflows are used to prevent timeouts and keep agent logic explicit and auditable.

---

## 8. User Interface (MVP)

- Chat-based UI built on Cloudflare Pages
- Primary action:
  > “Compare these two environments”
- Optional follow-up prompts:
  - “Explain this difference”
  - “What should I investigate first?”

Authentication and secret handling are explicitly excluded from the MVP.

---

## 9. Explicitly Out of Scope (MVP Guardrails)

The following features are intentionally deferred:

- Request body diffing
- Multiple HTTP methods
- Authentication flows (cookies, tokens)
- Secure storage of user-provided secrets
- Human-in-the-loop continuation with credentials
- Trace or log ingestion
- Synthetic probing from multiple regions
- Voice input
- Automated remediation

---

## 10. Phase 2 Work (Roadmap)

Phase 2 builds on the same architectural contracts and storage model.

### 10.1 Expanded Signal Providers
- HAR file upload
- RUM beacons from real users
- Edge proxy / middleware for continuous capture
- Trace and log correlation

### 10.2 Trend & Baseline Analysis
- SQL-based latency and behavior trends
- Baseline detection per environment
- Drift regression detection across deployments

### 10.3 Human-in-the-Loop Agent Interaction
- Workflow `waitForEvent()` for missing inputs
- Secure, scoped handling of auth headers or cookies
- Interactive remediation guidance

### 10.4 Multi-Region Probing
- Run probes from multiple colos
- Geo-aware drift explanations

### 10.5 Frontend Enhancement
- Frontend: React + Tailwind via Cloudflare Pages
- You can use a library like lucide-react for status icons and shadcn/ui for a professional-looking "Diff" view

---

## 11. MVP Success Criteria

The MVP is considered successful if a reviewer can:
1. Paste two URLs
2. Run a comparison
3. Receive a clear, structured explanation of differences
4. Understand why behavior diverges
5. Re-run the comparison and see memory-aware output

---

## 12. Scope Discipline

Any feature not listed in Sections 3–8 is considered out of scope for the MVP and should be implemented only after the MVP is complete and demoable.
