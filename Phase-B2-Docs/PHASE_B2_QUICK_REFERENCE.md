# Phase B2 Quick Reference Card

**One-page summary of design decisions before implementation**

---

## Critical Ambiguities (Must Resolve)

| # | Issue | Decision | Impact |
|---|-------|----------|--------|
| 1 | CF context drift correlation with timing | **OPEN** — Clarify hard vs soft correlation | Rule F1 implementation |

---

## Evidence Key Vocabulary (Phase-B2.md §1.3)

```typescript
section → valid keys

"probe"        → undefined | "left" | "right"
"status"       → undefined
"finalUrl"     → undefined | "scheme" | "host" | "path" | "query" | "finalUrl"
"redirects"    → undefined | "hopCount" | "chain" | "finalHost"
"headers"      → [lowercase header names, e.g., "cache-control", "vary"]
"content"      → undefined | "content-type" | "content-length" | "body-hash"
"timing"       → undefined | "duration_ms"
"cf"           → undefined | "colo" | "asn" | "country"
```

---

## Finding Codes (13 Total)

**Rule Groups:** A1/A2 → B1–B3 → C1–C2 → D1–D5 → E1 → F1 → G1

| Code | Category | Severity Logic |
|------|----------|-----------------|
| PROBE_FAILURE | unknown | critical |
| STATUS_MISMATCH | routing | critical if 2xx vs 4xx/5xx or 3xx vs non-3xx |
| FINAL_URL_MISMATCH | routing | critical if scheme/host differ, warn if path/query |
| REDIRECT_CHAIN_CHANGED | routing | critical if hop count Δ ≥ 2 or final host differs |
| AUTH_CHALLENGE_PRESENT | security | critical if present on one side only, warn if value differs |
| CORS_HEADER_DRIFT | security | critical if access-control-allow-origin differs |
| CACHE_HEADER_DRIFT | cache | critical if no-store or private differs |
| CONTENT_TYPE_DRIFT | content | critical if text/html vs application/json |
| BODY_HASH_DRIFT | content | critical if status and content-type unchanged |
| CONTENT_LENGTH_DRIFT | content | info < 200B, warn 200–2000B, critical ≥ 2000B + same status |
| TIMING_DRIFT | timing | Based on thresholds (see below) |
| CF_CONTEXT_DRIFT | platform | warn if timing drift, else info (or omit?) |
| UNKNOWN_DRIFT | unknown | Catch-all for unclassified header drift |

---

## Timing Constants (Phase-B2.md §3)

```typescript
MIN_TIMING_LEFT_MS  = 50      // Min slower duration to trigger
ABS_DELTA_WARN_MS   = 300     // Absolute delta for "warn"
ABS_DELTA_CRIT_MS   = 1000    // Absolute delta for "critical"
RATIO_WARN          = 1.5     // Ratio for "warn"
RATIO_CRIT          = 2.5     // Ratio for "critical"
```

**Logic:** If both durations exist AND max(left, right) ≥ MIN → check delta OR ratio

---

## Finding Structure

```typescript
{
  id: string,                    // Format: "${code}:${section}:${sortedKeys.join(',')}"
  code: DiffFindingCode,         // One of 13 codes above
  category: FindingCategory,     // routing | security | cache | content | timing | platform | unknown
  severity: Severity,            // critical | warn | info
  message: string,               // Deterministic, non-LLM (e.g., "Status differs: 200 vs 500")
  left_value?: unknown,          // Raw value from left for UI
  right_value?: unknown,         // Raw value from right for UI
  evidence?: DiffEvidence[],     // Pointers to evidence sections
  recommendations?: string[],    // Small list of action hints
}
```

---

## Header Whitelist

**Allowed headers (only these captured):**
- `cache-control`, `content-type`, `vary`, `www-authenticate`, `location`
- All `access-control-*` headers

**Grouped in SignalEnvelope/EnvDiff:**
- `core: { cache-control?, content-type?, vary?, www-authenticate?, location? }`
- `accessControl?: { [key: string]: string }`

---

## Determinism Rules (Phase-B2.md §1)

1. **Key Normalization:** All HTTP header keys → lowercase
2. **Evidence Key Sorting:** All `evidence.keys` arrays → lexicographically sorted before persistence
3. **Finding Sorting:** By (severity DESC, code ASC, message ASC)
4. **Deduplication:** By (code, section, sorted keys) — collapse duplicates to one

---

## Content-Type Normalization

```typescript
normalize(v) = v.split(";")[0].trim().toLowerCase()
// "text/html; charset=utf-8" → "text/html"
```

---

## Status Code Classification

```
2xx vs 4xx/5xx  → critical
2xx vs 5xx      → critical
3xx vs non-3xx  → critical
else            → warn
```

---

## URL Component Classification

```
scheme differs OR host differs    → critical
path differs OR query differs     → warn
```

---

## Finding Generation Order (Phase-B2.md §5)

1. A1 / A2 (probe failure)
2. B1 (status mismatch)
3. B2 (final URL mismatch)
4. B3 (redirect chain changed)
5. C1 (auth challenge)
6. C2 (CORS header drift)
7. D1 (cache header drift)
8. D2 (vary drift → UNKNOWN_DRIFT)
9. D3 (content-type drift)
10. D4 (body hash drift)
11. D5 (content length drift)
12. E1 (timing drift)
13. F1 (CF context drift)
14. G1 (remaining header drift)

**Then:** Deduplicate → Sort → Compute maxSeverity

---

## Utility Modules to Build

| # | Module | Purpose |
|---|--------|---------|
| 1 | probeUtils.ts | Compile ProbeOutcomeDiff from envelopes |
| 2 | urlUtils.ts | Parse URL components, classify drift severity |
| 3 | classifiers.ts | Status code classification |
| 4 | headerDiff.ts | Compute HeaderDiff (added/removed/changed) |
| 5 | contentUtils.ts | Content-type normalization, content-length severity |
| 6 | redirectUtils.ts | Compare redirect chains |
| 7 | cacheUtils.ts | Parse cache-control directives |
| 8 | validators.ts | Validate evidence keys per Phase-B2.md |
| 9 | constants.ts | Timing thresholds, rule registry |
| 10 | shared/diff.ts | Dedup key & ID computation helpers |
| 11 | sorting.ts | Sort findings deterministically |

---

## ProbeOutcomeDiff Structure

```typescript
{
  leftOk: boolean,        // left envelope result.ok
  rightOk: boolean,       // right envelope result.ok
  leftErrorCode?: string, // left error code (if failed)
  rightErrorCode?: string,// right error code (if failed)
  outcomeChanged: boolean // leftOk !== rightOk
}
```

---

## Evidence Examples

**Rule A2 (One probe failed):**
```typescript
{ section: "probe", keys: ["left"] }  // or ["right"]
```

**Rule B2 (Final URL mismatch):**
```typescript
{ section: "finalUrl", keys: ["scheme"] }  // or ["host"], ["path"], etc.
```

**Rule C2 (CORS drift):**
```typescript
{ section: "headers", keys: ["access-control-allow-origin"] }  // sorted
```

**Rule D1 (Cache-Control drift):**
```typescript
{ section: "headers", keys: ["cache-control"] }
```

**Rule F1 (CF context drift):**
```typescript
{ section: "cf", keys: ["asn", "colo"] }  // sorted
```

---

## Sorting Implementation

```typescript
const SEVERITY_ORDER = { critical: 0, warn: 1, info: 2 };

sortFindings(findings) {
  return findings.sort((a, b) => {
    const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sev !== 0) return sev;
    const code = a.code.localeCompare(b.code);
    if (code !== 0) return code;
    return a.message.localeCompare(b.message);
  });
}
```

---

## Redirect Chain Severity Logic

```
hopCount delta ≥ 2           → critical
final host differs           → critical
else (chain structurally different) → warn
```

---

## Cache-Control Keywords

```typescript
// Critical if these appear on one side only:
"no-store"
"private"
```

---

## Content-Length Thresholds

```
delta < 200 bytes            → info
delta ≥ 200 && < 2000 bytes  → warn
delta ≥ 2000 && same status  → critical
delta ≥ 2000 && status changed → warn
```

---

## Next Steps Checklist

- [ ] Clarify CF context correlation (hard or soft?)
- [ ] Create `src/analysis/` module files
- [ ] Implement utilities in order (🔴 critical first)
- [ ] Write unit tests for each utility
- [ ] Implement `computeEnvDiff()` in classify.ts
- [ ] Write integration tests with Phase-B2.md examples
- [ ] Verify byte-stable output
