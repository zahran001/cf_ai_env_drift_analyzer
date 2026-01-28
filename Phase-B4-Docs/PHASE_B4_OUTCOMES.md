# Phase B4 — Test Outcomes (MVP)

| Test ID | Goal | Left URL | Right URL | Outcome | Key Signals / Findings | Max Severity | Notes |
|---|---|---|---|---|---|---|---|
| A1 | Baseline (identical URLs) | `https://example.com/` | `https://example.com/` | ✅ PASS | No findings; outcome unchanged | `info` | Control case (zero diff) |
| A2 | Same host, different scheme | `http://example.com/` | `https://example.com/` | ✅ PASS | `FINAL_URL_MISMATCH (scheme)` | `info` | Severity tuned low for scheme-only drift |
| B1 | Status mismatch (200 vs 404) | `https://example.com/` | `https://example.com/this-does-not-exist` | ✅ PASS | `STATUS_MISMATCH (200 vs 404)`; `outcomeChanged=true` | `critical` | Correctly treated as outcome-level drift |
| C1 | Redirect vs no redirect (signal) | `https://example.com/` | `http://example.com/` | ✅ PASS (notes) | `FINAL_URL_MISMATCH (scheme)` | `info` | No explicit redirect-chain finding emitted in this case |
| C2 | Redirect chain length drift | `https://httpbin.org/redirect/1` | `https://httpbin.org/redirect/3` | ✅ PASS | `REDIRECT_CHAIN_CHANGED (hopCount 1→3)` | `warn` | Severity tuned down from `critical` → `warn` |
| D1 | Cache-Control header drift | `https://httpbin.org/response-headers?cache-control=no-store` | `https://httpbin.org/response-headers?cache-control=public,max-age=3600` | ✅ PASS | `CACHE_HEADER_DRIFT (cache-control)` | `warn` | Header capture/diff fixed; severity calibrated |
| D2 | CORS allow-origin drift | `https://postman-echo.com/response-headers?Access-Control-Allow-Origin=*` | `https://postman-echo.com/response-headers?Access-Control-Allow-Origin=https%3A%2F%2Fexample.com` | ✅ PASS | `CORS_HEADER_DRIFT (access-control-allow-origin)` | `warn` | Endpoint corrected (httpbin didn’t vary ACAO); severity tuned to `warn` |
| E1 | Signal/LLM grounding (content diff out-of-scope) | `https://httpbin.org/html` | `https://example.com/` | ✅ PASS (Signal/LLM) | `FINAL_URL_MISMATCH (host,path)`; optional header drift surfaced | `critical` | Body diffing excluded in MVP; evaluated on observable drift + grounded explanation |
| E2 | Routing drift (signal) | `https://httpbin.org/json` | `https://httpbin.org/anything` | ✅ PASS | `FINAL_URL_MISMATCH (path)` | `warn` | Clean routing-only signal |
| F1 | SSRF guardrail (loopback blocked) | — | `http://127.0.0.1/...` (blocked) | ✅ PASS | Input rejected (loopback not allowed) | — | Validator prevents loopback targets |
| F2 | SSRF guardrail (link-local blocked) | — | `http://169.254.x.x/...` (blocked) | ✅ PASS | Input rejected (link-local not allowed) | — | Validator prevents link-local targets |
| G1 | Re-run determinism / stability (3 runs) | `https://httpbin.org/response-headers?access-control-allow-origin=*` | `https://httpbin.org/response-headers?access-control-allow-origin=https://example.com` | ✅ PASS | Same finding + severity across 3 runs; unique IDs each run | `warn` | Validates stability / no state bleed |

