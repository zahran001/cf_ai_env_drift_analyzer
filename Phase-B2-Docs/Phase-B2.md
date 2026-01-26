# Phase B2 — Deterministic Finding Rules

This document defines the **authoritative, deterministic rulebook** for deriving `DiffFinding[]` from a structured `EnvDiff`.

If implemented **exactly as specified**, Phase **B2** is a pure, reproducible function with byte-stable output.

---

## Scope

These rules govern:

- How diffs are interpreted
- How findings are emitted
- How ordering, severity, and evidence are stabilized
- How edge cases (probe failure, partial data) are handled

LLM-generated explanations are **explicitly out of scope** for this phase.

---

## 1) Global Determinism Rules (Applies to All Findings)

### 1.1 Key Normalization

- All HTTP header keys MUST be normalized to **lowercase** before comparison.
- All `evidence.keys` arrays MUST be **lexicographically sorted** before persistence, hashing, or display.

### 1.2 Stable Evidence Shape

- `evidence.section` MUST be one of the predefined section identifiers.
- `evidence.keys` MUST encode **field-level or side-level specificity**.
- `evidence.note` MUST be optional and informational only; logic MUST NOT depend on it.

### 1.3 Evidence Key Vocabulary (Mandatory)

To avoid ambiguity, `evidence.keys` MUST use the following canonical key vocabulary per section:

- `section: "probe"`
  - `keys`: `undefined` OR `["left"]` OR `["right"]`
- `section: "status"`
  - `keys`: `undefined` (status is always implied)
- `section: "finalUrl"`
  - `keys`: `undefined` OR `["scheme"]` OR `["host"]` OR `["path"]` OR `["query"]` OR `["finalUrl"]`
- `section: "redirects"`
  - `keys`: `undefined` OR `["hopCount"]` OR `["chain"]` OR `["finalHost"]`
- `section: "headers"`
  - `keys`: **lowercased header names only**, e.g. `["cache-control", "vary"]`
- `section: "content"`
  - `keys`: `undefined` OR `["content-type"]` OR `["content-length"]` OR `["body-hash"]`
- `section: "timing"`
  - `keys`: `undefined` OR `["duration_ms"]`
- `section: "cf"`
  - `keys`: `undefined` OR `["colo"]` OR `["asn"]` OR `["country"]`

All keys MUST be lowercased (where applicable) and sorted lexicographically.

### 1.4 Sorting & Deduplication

- Findings MUST be sorted by:
    1. `severity` (`critical` > `warn` > `info`)
    2. `code` (lexicographically)
    3. `message` (lexicographically)
- Duplicate findings (same `code`, same `section`, same sorted `keys`) MUST be collapsed into one.

---

## 2) Normalization & Preprocessing Rules

These steps MUST occur before any finding generation.

- Normalize all header keys to lowercase.
- Header value trimming and internal whitespace collapsing is optional, but if applied, MUST be applied consistently.
- Redirect chains (`redirects.left` / `redirects.right`) MUST preserve observed order.
- If a section is unavailable due to probe failure, it MUST be `undefined` (not empty).
    - Exception: redirect arrays MAY be empty if explicitly known.


### 2.1 Category vs Evidence.section (Mandatory)

- `finding.category` MUST represent **semantic meaning** (why the drift matters):
  - `routing | security | cache | content | timing | platform | unknown`
- `evidence.section` MUST represent **where to look** in the diff/envelope for support.

Note: `finding.category` MUST NOT be `"headers"`. Header-based evidence should use `evidence.section: "headers"` while categorizing semantically (e.g., cache/security/unknown).

Example: a CORS header difference MUST have `category: "security"` while using `evidence.section: "headers"`.


---

## 3) Timing Drift Constants (MVP Defaults)

These constants MUST be fixed in code for determinism.

```tsx
MIN_TIMING_LEFT_MS  = 50
ABS_DELTA_WARN_MS  = 300
ABS_DELTA_CRIT_MS  = 1000
RATIO_WARN         = 1.5
RATIO_CRIT         = 2.5

```

Timing drift triggers only if:

- Both durations exist
- `max(left, right) >= MIN_TIMING_LEFT_MS`
- Either absolute delta OR ratio crosses a threshold

---

## 4) Finding Generation Rules

### Rule Group A — Probe Outcome Rules (Always Evaluated First)

### A1) Both Probes Failed → `PROBE_FAILURE` (critical)

**Trigger**

- `probe.leftOk === false && probe.rightOk === false`

**Finding**

- `code`: `PROBE_FAILURE`
- `category`: `unknown`
- `severity`: `critical`
- `message`: `"Both probes failed"`
- `evidence`: `[{ section: "probe" }]`

---

### A2) One Probe Failed, One Succeeded → `PROBE_FAILURE` (critical)

**Trigger**

- `probe.outcomeChanged === true`

**Finding**

- `message`: `"Left probe failed; right succeeded"` or vice versa

**Evidence**

```tsx
evidence: [
  { section: "probe", keys: ["left"] } // or ["right"]
]

```

---

### Rule Group B — Status & Routing Rules

### B1) HTTP Status Differs → `STATUS_MISMATCH`

- `critical` if 2xx vs 4xx/5xx or 3xx vs non-3xx
- `warn` otherwise

### B2) Final URL Differs → `FINAL_URL_MISMATCH`

- `critical` if scheme or host differs
- `warn` if only path/query differs

### B3) Redirect Chain Changed → `REDIRECT_CHAIN_CHANGED`

**Severity Rules (MVP outcome-focused):**
- `info` if no changes
- `warn` if hop count differs (any amount) — infrastructure observation
- `critical` only if final host differs — outcome change (user lands on different domain)

---

### Rule Group C — Security / Auth Rules

### C1) `www-authenticate` Drift → `AUTH_CHALLENGE_PRESENT`

- `critical` if present on only one side
- `warn` if value differs

### C2) CORS Drift → `CORS_HEADER_DRIFT`

**Evidence**

```tsx
keys: ["access-control-allow-credentials", "access-control-allow-origin"]

```

- Keys MUST be sorted
- `critical` if `access-control-allow-origin` differs

---

### Rule Group D — Cache & Content Rules

### D1) Cache-Control Drift → `CACHE_HEADER_DRIFT`

- `critical` if `no-store` or `private` appears on only one side

### D2) Vary Drift → `UNKNOWN_DRIFT` (vary)

### D3) Content-Type Drift → `CONTENT_TYPE_DRIFT`

**Normalization**

```tsx
normalize(v) = v.split(";")[0].trim().toLowerCase()

```

- `critical` if `text/html` vs `application/json`

### D4) Body Hash Drift → `BODY_HASH_DRIFT`

- `critical` if status and normalized content-type are unchanged

### D5) Content Length Drift → `CONTENT_LENGTH_DRIFT`

- `< 200 bytes` → `info`
- `≥ 200 bytes` → `warn`
- `≥ 2000 bytes` and same status → `critical`

---

### Rule Group E — Timing Rules

### E1) Timing Drift → `TIMING_DRIFT`

- Apply constants from §3
- Severity derived strictly from thresholds

---

### Rule Group F — Platform / Context Rules

### F1) CF Context Drift → `CF_CONTEXT_DRIFT`

**Evidence**

```tsx
keys: ["asn", "colo"]

```

- **Decision (2026-01-07):** Soft Correlation (Option B)
- Emitted if CF context (colo/asn/country) differs between probes
- Severity: `warn` if correlated with timing drift, `info` otherwise
  - (This means: always emit if CF differs, but severity depends on whether timing also drifts)

---

### Rule Group G — Generic Header Drift (Catch-All)

### G1) Remaining Allowlisted Header Drift → `UNKNOWN_DRIFT`

- Exclude keys already claimed by earlier rules
- `warn` if ≥ 3 headers differ

---

## 5) Finding Generation Order (Mandatory)

Findings MUST be generated in the following order before sorting/deduplication:

1. A1 / A2
2. B1
3. B2
4. B3
5. C1
6. C2
7. D1
8. D2
9. D3
10. D4
11. D5
12. E1
13. F1
14. G1

---

## 6) Max Severity Derivation

- `maxSeverity = max(findings.severity)`
- If no findings exist:
    - `findings = []`
    - `maxSeverity = "info"`

---

## 7) Enforcement Notes

- All emitted arrays MUST be ordered
- Side signaling MUST use `keys: ["left"]` / `["right"]`
- Semantic checks MUST be case-insensitive
- No rule may emit unordered or free-form structures

---

## Result

With this rulebook:

- Output is byte-stable across runs
- Findings are reproducible and hashable
- UI highlighting is deterministic
- Phase **B2** is fully testable as a pure function

---