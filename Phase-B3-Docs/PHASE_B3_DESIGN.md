# Phase B3 Design: Signal Provider Layer + ActiveProbeProvider

**Objective:** Implement the signal provider seam for active HTTP probing with manual redirect handling, deterministic probe ID generation, and SSRF protection.

**Status:** Research & Design Phase
**Previous Phase:** Phase B2 (Deterministic Classification) ✅ Complete
**Next Phase:** Phase B4 (Durable Objects + Storage)

---

## 1. Executive Summary

Phase B3 is the **critical bridge** between the deterministic analysis layer (Phase B2) and the storage/workflow layers (B4+). It transforms raw HTTP requests into normalized `SignalEnvelope` objects that the rest of the system depends on.

### What Phase B3 Does

1. **Defines provider interface contract** — so future providers (HAR, RUM, traces) can be plugged in
2. **Implements ActiveProbeProvider** — performs HTTP probes with **manual redirect handling** (never automatic)
3. **Enforces SSRF protection** — rejects localhost, private IPs, invalid schemes
4. **Generates deterministic probe IDs** — `${comparisonId}:${side}` for idempotency in Workflows
5. **Measures duration accurately** — includes all redirects in total time
6. **Whitelists response headers** — only captures 6 approved headers (cache-control, access-control-*, vary, content-type, www-authenticate, location)

### Key Constraint: Manual Redirects Only

**MUST use:** `fetch(..., { redirect: "manual" })`
**MUST NOT use:** `fetch(..., { redirect: "follow" })`

This requirement comes from:
- Need to capture exact redirect chain (fromUrl → toUrl + status)
- Need to detect redirect loops ourselves
- Need to measure total duration accurately
- Need to control timeout at each hop

---

## 2. Current State (Pre-Implementation)

### What's Already Built (Waiting for Providers)

| Layer | Status | Details |
|-------|--------|---------|
| **Phase B2 (Analysis)** | ✅ Complete | `classify.ts` + 14 deterministic rules, fully tested |
| **SignalEnvelope Schema** | ✅ Complete | Defined in `shared/signal.ts` (153 lines) |
| **Diff & Findings** | ✅ Complete | `shared/diff.ts` with 14 finding codes |
| **Mock Tests** | ✅ Complete | `mockEnvelopes.test.ts` with comprehensive coverage |
| **Test Infrastructure** | ✅ Complete | Jest setup, 11 test suites, 302 passing tests |

### What's Empty (Phase B3 Work)

| File | Status | Reason |
|------|--------|--------|
| `src/providers/types.ts` | ⛔ Empty | Needs provider interface definition |
| `src/providers/activeProbe.ts` | ⛔ Empty | Needs implementation |
| `src/api/routes.ts` | ⚠️ Partial | Only `/api/health`, needs `/api/compare` |
| `src/llm/client.ts` | ⛔ Empty | Phase B5 work |
| `src/storage/envPairDO.ts` | ⛔ Empty | Phase B4 work |
| `src/workflows/compareEnvironments.ts` | ⛔ Empty | Phase B6 work |

---

## 3. Provider Interface Design

### 3.1 Interface Definition

```typescript
// src/providers/types.ts

import type { SignalEnvelope } from "@shared/signal";

/**
 * Provider context: safe subset of Cloudflare request.cf
 * Attached to SignalEnvelope for reproducibility and multi-region support
 */
export type ProviderRunnerContext = {
  colo?: string;           // Cloudflare edge location (e.g., "SFO", "LON")
  country?: string;        // Country code from CF geo (e.g., "US", "GB")
  asn?: number;            // Autonomous system number
  asOrganization?: string; // ASN organization name
  tlsVersion?: string;     // TLS version used by the probe
  httpProtocol?: string;   // HTTP protocol version (h2, h3, etc.)
};

/**
 * Signal provider interface.
 * All providers must normalize output to SignalEnvelope.
 *
 * Implementations:
 * - ActiveProbeProvider (MVP)
 * - HAR upload provider (Phase 2)
 * - RUM beacon provider (Phase 2)
 */
export interface ISignalProvider {
  /**
   * Collect signal from target URL and normalize to SignalEnvelope
   *
   * @param url - Target URL to probe
   * @param context - Cloudflare runner context (from request.cf)
   * @returns Normalized SignalEnvelope with success or error outcome
   *
   * MUST return a SignalEnvelope in all cases (success or failure).
   * MUST set capturedAt to ISO 8601 timestamp.
   * MUST set result to either ProbeSuccess or ProbeFailure.
   */
  probe(url: string, context?: ProviderRunnerContext): Promise<SignalEnvelope>;
}

/**
 * Exported singleton instance of ActiveProbeProvider
 */
export const activeProbeProvider: ISignalProvider;
```

### 3.2 Provider Semantics

**Key contract invariants:**

1. **Always returns SignalEnvelope** — Never throws; failures encoded in `result.ok: false`
2. **Deterministic probe IDs** — `${comparisonId}:${side}` set by caller (not provider)
3. **Whitelisted headers only** — Only 6 response headers captured
4. **Safe runner context** — Only colo/asn/country (never auth, cookies, request body)
5. **Normalized output** — Same structure regardless of success/failure

---

## 4. ActiveProbeProvider Design

### 4.1 Redirect Algorithm (Core Complexity)

The MVP provider uses **manual redirect following** with strict constraints:

```typescript
Algorithm: followRedirects(targetUrl, maxHops=10, timeoutMs=10000)

Input: targetUrl (string)
Output: { finalUrl, redirectChain: RedirectHop[], totalDurationMs }

1. Initialize:
   currentUrl = targetUrl
   visited = new Set<string>()
   redirectChain: RedirectHop[] = []
   startTime = now()

2. Loop (up to maxHops iterations):
   a. Fetch currentUrl with:
      - method: "GET"
      - redirect: "manual" (CRITICAL)
      - timeout: (remaining time from startTime)
      - AbortController with timeout

   b. If fetch error (DNS, network, timeout, TLS):
      - Return error with current duration
      - Propagate error code (dns_error, timeout, tls_error, etc.)

   c. Record response:
      - Get response.status
      - Extract Location header (case-insensitive)

   d. If status is 301, 302, 303, 307, or 308:
      - Get Location value
      - If missing: error "redirect_missing_location"
      - Resolve Location to absolute URL (handle relative URLs)

      - Check if absolute URL already in visited:
        If yes: error "redirect_loop_detected"

      - Add currentUrl to visited
      - Add to redirectChain: { fromUrl: currentUrl, toUrl: absoluteUrl, status }
      - Set currentUrl = absoluteUrl
      - Continue loop

   e. Else (not a redirect status):
      - Break loop (final response reached)

3. Return:
   finalUrl = currentUrl
   redirectChain = [...chain up to this point]
   totalDurationMs = now() - startTime
```

### 4.2 URL Resolution (Relative → Absolute)

```typescript
function resolveUrl(baseUrl: string, relative: string): string | undefined {
  try {
    // If relative is already absolute, URL constructor handles it
    const resolved = new URL(relative, baseUrl);
    return resolved.toString();
  } catch {
    // Invalid URL or unresolvable
    return undefined;
  }
}
```

**Examples:**
- Base: `https://example.com/api/foo`, Relative: `/bar` → `https://example.com/bar`
- Base: `https://example.com/api/foo`, Relative: `//cdn.example.com` → `https://cdn.example.com`
- Base: `https://example.com/api/foo`, Relative: `https://final.com` → `https://final.com`
- Base: `https://example.com/api/foo`, Relative: `invalid` → Error

### 4.3 SSRF Protection (URL Validation)

```typescript
/**
 * Check if URL is safe to probe (reject private/internal networks)
 *
 * REJECTS:
 * - Non-http/https schemes (file://, ftp://, gopher://, etc.)
 * - localhost (127.0.0.1, ::1, localhost hostname)
 * - Private IP ranges:
 *   - 10.0.0.0/8
 *   - 172.16.0.0/12
 *   - 192.168.0.0/16
 * - Link-local addresses:
 *   - 169.254.0.0/16 (IPv4)
 *   - fe80::/10 (IPv6)
 * - Loopback (::1)
 *
 * ACCEPTS:
 * - Public IPv4 addresses
 * - Public IPv6 addresses (non-link-local)
 * - Public hostnames (resolved at runtime)
 */
function validateUrlSafety(url: string): { safe: boolean; reason?: string } {
  try {
    const parsed = new URL(url);

    // Check scheme
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { safe: false, reason: "invalid_scheme" };
    }

    const hostname = parsed.hostname;
    if (!hostname) {
      return { safe: false, reason: "no_hostname" };
    }

    // Check against blocked patterns
    const blocked = [
      "localhost",
      "127.0.0.1",
      "::1",
      // Private ranges (simplified; full validation would be more sophisticated)
      // For production, consider using a library like ip-address or ipaddr.js
    ];

    if (blocked.includes(hostname)) {
      return { safe: false, reason: "blocked_hostname" };
    }

    // In production, add IP range validation:
    // isPrivateIP(hostname) → reject 10.x, 172.16-31.x, 192.168.x
    // isLinkLocal(hostname) → reject 169.254.x, fe80::

    return { safe: true };
  } catch {
    return { safe: false, reason: "invalid_url" };
  }
}
```

### 4.4 Header Whitelisting

```typescript
/**
 * Whitelist of response headers to capture.
 * Only these 6 headers are stored in SignalEnvelope.
 */
const WHITELISTED_HEADERS = {
  // Core headers
  "cache-control": "core",
  "content-type": "core",
  "vary": "core",
  "www-authenticate": "core",
  "location": "core",
  // Access-Control headers (prefix-based)
  // Any header starting with "access-control-" is captured
};

function filterHeaders(rawHeaders: Record<string, string>): {
  core: CoreResponseHeaders;
  accessControl?: AccessControlHeaders;
} {
  const coreHeaders: CoreResponseHeaders = {};
  const acHeaders: Record<string, string> = {};

  for (const [key, value] of Object.entries(rawHeaders)) {
    const lower = key.toLowerCase();

    // Check if core header
    if (lower in WHITELISTED_HEADERS) {
      coreHeaders[lower as keyof CoreResponseHeaders] = value;
    }

    // Check if access-control-* prefix
    if (lower.startsWith("access-control-")) {
      acHeaders[lower] = value;
    }
  }

  return {
    core: coreHeaders,
    accessControl: Object.keys(acHeaders).length > 0 ? acHeaders : undefined,
  };
}
```

### 4.5 Error Handling Strategy

```typescript
/**
 * Map caught errors to stable ProbeErrorCode enum
 */
function classifyFetchError(error: Error, stage: "dns" | "connect" | "tls" | "timeout"): ProbeErrorCode {
  const message = error.message?.toLowerCase() ?? "";

  // Timeout errors
  if (message.includes("timeout") || stage === "timeout") {
    return "timeout";
  }

  // DNS errors
  if (message.includes("dns") || message.includes("enotfound") || stage === "dns") {
    return "dns_error";
  }

  // TLS/SSL errors
  if (message.includes("certificate") || message.includes("ssl") || message.includes("tls") || stage === "tls") {
    return "tls_error";
  }

  // SSRF-like (blocked)
  if (message.includes("blocked") || message.includes("forbidden")) {
    return "ssrf_blocked";
  }

  // Generic fetch error
  return "fetch_error";
}
```

### 4.6 Duration Measurement

```typescript
/**
 * Measure total time from first fetch to final response.
 * Includes all redirects and retry overhead.
 */
class DurationTracker {
  private startTime: number = Date.now();

  getDurationMs(): number {
    return Date.now() - this.startTime;
  }

  getRemainingMs(maxMs: number): number {
    const elapsed = this.getDurationMs();
    return Math.max(0, maxMs - elapsed);
  }
}
```

---

## 5. Implementation Checklist

### 5.1 src/providers/types.ts (75 lines)

- [ ] Export `ProviderRunnerContext` type
- [ ] Export `ISignalProvider` interface with `probe()` method signature
- [ ] Document interface semantics (always returns SignalEnvelope, no throws)
- [ ] Export singleton `activeProbeProvider` (implementation in activeProbe.ts)

### 5.2 src/providers/activeProbe.ts (250-300 lines)

**Core functions:**

- [ ] `validateUrlSafety(url)` — SSRF check
- [ ] `resolveUrl(base, relative)` — Relative → absolute URL resolution
- [ ] `classifyFetchError(error)` — Map fetch errors to error codes
- [ ] `filterHeaders(raw)` — Extract whitelisted headers
- [ ] `followRedirects(url, ctx)` — Main redirect algorithm
- [ ] `probe(url, context)` — Main provider function (orchestrator)

**Error paths:**

- [ ] Handle fetch timeout (AbortController)
- [ ] Handle DNS errors
- [ ] Handle TLS errors
- [ ] Handle redirect loop detection
- [ ] Handle missing Location header in redirect
- [ ] Handle invalid URL resolution
- [ ] Handle SSRF rejection (private IP)

**Success paths:**

- [ ] Capture redirect chain with fromUrl/toUrl/status
- [ ] Extract final URL and status
- [ ] Filter and attach response headers
- [ ] Measure total duration (ms)
- [ ] Attach runner context (cf metadata)
- [ ] Return SignalEnvelope with ProbeSuccess result

### 5.3 Tests: src/analysis/__tests__/activeProbe.test.ts (250-350 lines)

**Unit tests:**

- [ ] `validateUrlSafety()` — Accept public URLs, reject localhost/private IPs/invalid schemes
- [ ] `resolveUrl()` — Relative, absolute, protocol-relative paths
- [ ] `classifyFetchError()` — Map common error types
- [ ] `filterHeaders()` — Whitelist 6 headers, capture access-control-* prefix

**Integration tests (mock fetch):**

- [ ] Single successful response (no redirects)
- [ ] Redirect chain (2-3 hops)
- [ ] Redirect loop detection (same URL visited twice)
- [ ] Missing Location header (error case)
- [ ] Invalid relative URL (error case)
- [ ] Timeout on one hop (error case, total duration measured)
- [ ] DNS error on first request
- [ ] SSRF rejection (private IP)
- [ ] Header filtering (only 6 captured, access-control-* prefix)

**Determinism tests:**

- [ ] Same URL + context produces identical SignalEnvelope (JSON serialization)
- [ ] Multiple runs produce byte-identical redirectChain order
- [ ] Probe IDs are deterministic

---

## 6. Probe ID Generation (Idempotency)

### 6.1 Deterministic ID Format

```typescript
/**
 * Probe ID MUST be deterministic for Workflow idempotency.
 *
 * Format: ${comparisonId}:${side}
 *
 * This ensures that if Workflow step 4 retries (saving left probe),
 * the same probe record is updated, not duplicated.
 *
 * Example:
 * - comparisonId: "staging-prod:abc-123"
 * - side: "left"
 * - probeId: "staging-prod:abc-123:left"
 *
 * DO will use UNIQUE(comparison_id, side) constraint to enforce
 * single probe per side per comparison.
 */
function generateProbeId(comparisonId: string, side: "left" | "right"): string {
  return `${comparisonId}:${side}`;
}
```

### 6.2 Why This Matters

From CLAUDE.md §2.2 (Idempotency):

> "Cloudflare Workflows retry failed steps automatically. Every `step.do()` call must be idempotent."

**Scenario:**
1. Workflow step 4: `saveProbe(comparisonId, "left", envelope)` succeeds but times out returning
2. Cloudflare retries step 4 automatically
3. Without deterministic IDs, this would insert a duplicate probe record
4. With deterministic IDs (`${comparisonId}:left`), the second execution updates the existing record

**Critical invariant:**
- Probe ID is set by the **caller** (Workflow), not the provider
- Provider simply produces the SignalEnvelope
- Workflow attaches the probe ID when persisting to DO

---

## 7. Integration Points

### 7.1 Workflow Usage (Phase B6)

```typescript
// In src/workflows/compareEnvironments.ts (pseudocode)

// Step 1: Probe left
const leftEnvelope = await activeProbeProvider.probe(
  leftUrl,
  { colo: request.cf.colo, country: request.cf.country, asn: request.cf.asn }
);

// Step 2: Save left probe (with deterministic ID)
const leftProbeId = `${comparisonId}:left`;
await envPairDO.saveProbe(comparisonId, leftProbeId, leftEnvelope);

// Repeat for right...

// Step 5: Compute diff
const diff = classify(
  leftEnvelope,
  rightEnvelope
);
```

### 7.2 Test Endpoint (Temporary, Phase B3)

```typescript
// In src/api/routes.ts (temporary)

/**
 * Temporary endpoint to verify provider works.
 * Can be removed after Phase B3.
 *
 * GET /api/probe?url=https://example.com
 * Returns: { comparisonId: "test", probeId: "test:left", ...SignalEnvelope }
 */
router.get("/probe", async (req, ctx) => {
  const url = new URL(req.url).searchParams.get("url");
  if (!url) {
    return json({ error: "Missing url parameter" }, { status: 400 });
  }

  const envelope = await activeProbeProvider.probe(url, {
    colo: ctx.request.cf?.colo,
    country: ctx.request.cf?.country,
    asn: ctx.request.cf?.asn,
  });

  return json(envelope);
});
```

---

## 8. Design Decisions & Trade-Offs

### 8.1 Manual vs. Automatic Redirect Handling

**Decision:** Manual (required by CLAUDE.md)

**Rationale:**
- Need to capture exact redirect chain (fromUrl, toUrl, status)
- Need to measure total duration accurately
- Need to detect loops ourselves
- Need to control timeout per-hop
- Need to respect our max-redirects limit (10)

**Trade-off:** More code in provider, but explicit and auditable

### 8.2 Header Whitelisting Strategy

**Decision:** Only 6 core headers + access-control-* prefix

**Rationale:**
- MVP MVP_FEATURE_SET.md specifies exactly which headers to capture
- Prevents leaking sensitive data (Authorization, Set-Cookie, etc.)
- Matches downstream analysis layer expectations
- Can expand whitelist in Phase 2 without schema changes

**Trade-off:** Lost information about other headers, but acceptable for MVP

### 8.3 SSRF Protection Scope

**Decision:** Reject localhost, private IPs, link-local, invalid schemes

**Rationale:**
- Cloudflare Workers run at the edge; ability to probe internal networks is dangerous
- MVP assumes all probed URLs are public
- Can relax in Phase 2 with authenticated user context

**Trade-off:** Blocks legitimate internal probing (design trade-off, not implementation)

### 8.4 Error Handling: Always Success Envelope

**Decision:** Provider always returns SignalEnvelope; failures encoded in `result.ok: false`

**Rationale:**
- Simplifies caller logic (no exception handling needed)
- Uniform contract (same return type always)
- Matches SignalEnvelope design (ProbeSuccess | ProbeFailure union)

**Trade-off:** Caller must check `result.ok` instead of try-catch

### 8.5 Probe ID Generation Location

**Decision:** Caller generates ID, provider doesn't know about it

**Rationale:**
- Provider is agnostic to comparison/workflow context
- Enables idempotency (caller controls ID deterministically)
- Future providers (HAR, RUM) don't need to know about IDs

**Trade-off:** Extra line in Workflow code, but cleaner separation of concerns

---

## 9. Constraints & Assumptions

### 9.1 Constraints (Hard, Non-Negotiable)

1. **Must use `{ redirect: "manual" }`** — Never automatic follow
2. **Max 10 redirects** — Hard limit to prevent abuse
3. **10-second total timeout** — Includes all redirects
4. **Only 6 whitelisted headers** — Exactly as per MVP_FEATURE_SET.md
5. **No SSRF** — Reject private IPs, localhost, invalid schemes
6. **Deterministic probe IDs** — `${comparisonId}:${side}` format
7. **Always return SignalEnvelope** — Never throw, encode errors in result

### 9.2 Assumptions

1. **Input URLs are HTTP/HTTPS** — Not file://, gopher://, etc.
2. **Target servers support GET requests** — No POST/PUT/DELETE
3. **Redirect chains are acyclic** — Can detect via visited set
4. **Duration measurement is sufficient** — Don't need per-hop timings (Phase 2?)
5. **Headers are ASCII** — No exotic encodings
6. **Cloudflare request.cf is available** — Contains colo, country, asn

---

## 10. Testing Strategy

### 10.1 Unit Tests (Isolated Functions)

```typescript
describe("validateUrlSafety", () => {
  it("accepts public URLs", () => {
    expect(validateUrlSafety("https://example.com")).toBe(true);
    expect(validateUrlSafety("https://api.github.com")).toBe(true);
  });

  it("rejects localhost", () => {
    expect(validateUrlSafety("http://localhost:8000")).toBe(false);
    expect(validateUrlSafety("http://127.0.0.1")).toBe(false);
  });

  it("rejects private IPs", () => {
    expect(validateUrlSafety("http://10.0.0.1")).toBe(false);
    expect(validateUrlSafety("http://192.168.1.1")).toBe(false);
  });

  it("rejects invalid schemes", () => {
    expect(validateUrlSafety("file:///etc/passwd")).toBe(false);
    expect(validateUrlSafety("ftp://example.com")).toBe(false);
  });
});

describe("resolveUrl", () => {
  it("resolves relative paths", () => {
    const base = "https://example.com/api/foo";
    expect(resolveUrl(base, "/bar")).toBe("https://example.com/bar");
    expect(resolveUrl(base, "baz")).toBe("https://example.com/api/baz");
  });

  it("resolves protocol-relative URLs", () => {
    const base = "https://example.com/api";
    expect(resolveUrl(base, "//cdn.example.com")).toBe("https://cdn.example.com");
  });

  it("returns absolute URLs as-is", () => {
    const base = "https://example.com/api";
    expect(resolveUrl(base, "https://other.com")).toBe("https://other.com");
  });
});

describe("filterHeaders", () => {
  it("captures whitelisted core headers", () => {
    const raw = {
      "cache-control": "public, max-age=3600",
      "content-type": "application/json",
      "x-custom": "ignored",
    };
    const result = filterHeaders(raw);
    expect(result.core["cache-control"]).toBe("public, max-age=3600");
    expect(result.core["content-type"]).toBe("application/json");
    expect("x-custom" in result.core).toBe(false);
  });

  it("captures access-control-* headers", () => {
    const raw = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST",
      "other": "ignored",
    };
    const result = filterHeaders(raw);
    expect(result.accessControl?.["access-control-allow-origin"]).toBe("*");
    expect(result.accessControl?.["access-control-allow-methods"]).toBe("GET, POST");
  });
});
```

### 10.2 Integration Tests (With Mocked Fetch)

```typescript
describe("ActiveProbeProvider.probe()", () => {
  // Mock fetch for controlled testing
  const mockFetch = jest.fn();
  global.fetch = mockFetch;

  it("captures simple successful response (no redirects)", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("OK", {
        status: 200,
        headers: {
          "cache-control": "public, max-age=3600",
          "content-type": "application/json",
        },
      })
    );

    const envelope = await activeProbeProvider.probe("https://example.com", {
      colo: "SFO",
    });

    expect(envelope.result.ok).toBe(true);
    if (envelope.result.ok) {
      expect(envelope.result.response.status).toBe(200);
      expect(envelope.result.response.finalUrl).toBe("https://example.com");
      expect(envelope.result.redirects).toBeUndefined(); // or []
      expect(envelope.result.durationMs).toBeGreaterThan(0);
    }
  });

  it("captures redirect chain", async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response("", {
          status: 302,
          headers: { location: "/redirect-1" },
        })
      )
      .mockResolvedValueOnce(
        new Response("", {
          status: 307,
          headers: { location: "https://final.example.com" },
        })
      )
      .mockResolvedValueOnce(
        new Response("Final", {
          status: 200,
          headers: { "cache-control": "no-cache" },
        })
      );

    const envelope = await activeProbeProvider.probe("https://example.com", {
      colo: "LON",
    });

    expect(envelope.result.ok).toBe(true);
    if (envelope.result.ok) {
      expect(envelope.result.redirects).toHaveLength(2);
      expect(envelope.result.redirects?.[0]).toEqual({
        fromUrl: "https://example.com",
        toUrl: "https://example.com/redirect-1",
        status: 302,
      });
      expect(envelope.result.redirects?.[1].toUrl).toBe("https://final.example.com");
      expect(envelope.result.response.finalUrl).toBe("https://final.example.com");
    }
  });

  it("detects redirect loops", async () => {
    const loopUrl = "https://example.com/loop";
    mockFetch
      .mockResolvedValueOnce(
        new Response("", {
          status: 302,
          headers: { location: loopUrl },
        })
      )
      .mockResolvedValueOnce(
        new Response("", {
          status: 302,
          headers: { location: loopUrl },
        })
      );

    const envelope = await activeProbeProvider.probe("https://example.com", {});

    expect(envelope.result.ok).toBe(false);
    if (!envelope.result.ok) {
      expect(envelope.result.error.code).toBe("redirect_loop"); // or custom code
    }
  });

  it("handles DNS errors gracefully", async () => {
    mockFetch.mockRejectedValueOnce(new Error("DNS lookup failed"));

    const envelope = await activeProbeProvider.probe("https://invalid-domain-xyz.com", {});

    expect(envelope.result.ok).toBe(false);
    if (!envelope.result.ok) {
      expect(envelope.result.error.code).toBe("dns_error");
      expect(envelope.result.durationMs).toBeGreaterThan(0); // Should measure failure too
    }
  });

  it("handles timeouts", async () => {
    mockFetch.mockImplementationOnce(() => {
      return new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Timeout")), 100);
      });
    });

    const envelope = await activeProbeProvider.probe("https://slow.example.com", {});

    expect(envelope.result.ok).toBe(false);
    if (!envelope.result.ok) {
      expect(envelope.result.error.code).toBe("timeout");
    }
  });

  it("rejects SSRF targets", async () => {
    const envelope = await activeProbeProvider.probe("http://localhost:8000", {});

    expect(envelope.result.ok).toBe(false);
    if (!envelope.result.ok) {
      expect(envelope.result.error.code).toBe("invalid_url"); // or ssrf_blocked
    }
  });

  it("measures duration including all redirects", async () => {
    // Simulate 3 hops with some delay
    mockFetch
      .mockImplementationOnce(() => delay(50).then(() => redirect(302, "/hop1")))
      .mockImplementationOnce(() => delay(50).then(() => redirect(302, "/hop2")))
      .mockImplementationOnce(() => delay(50).then(() => response(200, "OK")));

    const envelope = await activeProbeProvider.probe("https://example.com", {});

    if (envelope.result.ok) {
      // Should be roughly 150ms (3 hops × 50ms)
      expect(envelope.result.durationMs).toBeGreaterThanOrEqual(150);
      expect(envelope.result.durationMs).toBeLessThan(300); // Allow some overhead
    }
  });
});
```

### 10.3 Determinism Tests

```typescript
describe("ActiveProbeProvider determinism", () => {
  it("produces identical SignalEnvelopes for same input", async () => {
    const url = "https://example.com";
    const ctx = { colo: "SFO", country: "US" };

    // Note: This test would need deterministic mocking (date, random, etc.)
    const envelope1 = await activeProbeProvider.probe(url, ctx);
    const envelope2 = await activeProbeProvider.probe(url, ctx);

    // Should be byte-identical JSON (same probeId, capturedAt, etc.)
    // Note: capturedAt will differ slightly, so check structure instead
    expect(envelope1.result).toEqual(envelope2.result);
  });
});
```

---

## 11. Implementation Order

### Phase B3 Execution Path

1. **Week 1:**
   - [ ] Define `src/providers/types.ts` (75 lines)
   - [ ] Implement `src/providers/activeProbe.ts` (250-300 lines)
   - [ ] Add test suite (250-350 lines)
   - [ ] Verify: `npm test` passes for all provider tests

2. **Week 2:**
   - [ ] Add temporary `/api/probe?url=...` test endpoint
   - [ ] Manual testing against real public URLs
   - [ ] Verify redirect chains are captured correctly
   - [ ] Verify SSRF protection blocks private IPs
   - [ ] Verify error handling for DNS/timeout/TLS

3. **Completion:**
   - [ ] All Phase B3 tests passing
   - [ ] Ready to integrate into Workflow (Phase B6)
   - [ ] Ready to use in `/api/compare` endpoint (Phase B7)

---

## 12. Success Criteria (Phase B3 Done)

✅ **Requirements Met:**

- [ ] `src/providers/types.ts` defines ISignalProvider interface
- [ ] `src/providers/activeProbe.ts` implements:
  - Manual redirect following (max 10 hops)
  - Redirect loop detection
  - SSRF validation (rejects localhost, private IPs)
  - Header whitelisting (6 approved headers)
  - Duration measurement (ms)
  - Error handling with stable error codes
  - Runner context attachment (cf metadata)

✅ **Tests Pass:**

- [ ] 25+ unit tests for isolated functions
- [ ] 8+ integration tests with mocked fetch
- [ ] All tests deterministic and idempotent
- [ ] Full test coverage for error paths

✅ **Contract Adherence:**

- [ ] Always returns SignalEnvelope (never throws)
- [ ] Probe IDs are deterministic format: `${comparisonId}:${side}`
- [ ] Output matches shared/signal.ts schema exactly
- [ ] Uses only whitelisted response headers

✅ **Integration Ready:**

- [ ] Temporary `/api/probe` endpoint works
- [ ] Can handle public URLs (example.com, api.github.com, etc.)
- [ ] Can handle redirects (2-3 hops typical)
- [ ] Fails gracefully on invalid input

✅ **Documentation:**

- [ ] README updated with provider architecture
- [ ] Code comments explain redirect algorithm
- [ ] Error codes documented
- [ ] Examples shown for each error case

---

## 13. Appendix: Related Files Reference

| File | Purpose | Status |
|------|---------|--------|
| `shared/signal.ts` | SignalEnvelope schema | ✅ Complete |
| `CLAUDE.md` | System rulebook (§3.1, §5.1, §5.2) | ✅ Reference |
| `MVP_Tracker.md` | Phase B3 task list | ✅ Reference |
| `Backend_System_Architecture.md` | System design | ✅ Reference |
| `src/analysis/classify.ts` | Phase B2 (downstream) | ✅ Complete |
| `src/analysis/__tests__/mockEnvelopes.test.ts` | Test examples | ✅ Reference |

---

## 14. Questions for Implementation

Before starting coding, clarify:

1. **IP Range Validation:** Should we use a library (ipaddr.js) or implement manually?
   - Trade-off: Library adds dependency, but handles IPv6/edge cases
   - Recommendation: Manual for MVP, upgrade in Phase 2

2. **Timeout Strategy:** Single 10s timeout or per-hop timeouts?
   - Current design: Single 10s total (includes all hops)
   - Alternative: Per-hop timeout (e.g., 3s each, max 10 hops = 30s)
   - Recommendation: Single 10s (safer for edge execution)

3. **Redirect Loop Limit:** Should we count hops or visited URLs?
   - Current design: Max 10 hops OR infinite with visited set
   - Recommendation: Both (10 hops max AND visited set)

4. **Error Codes:** Should we define custom codes or use standard HTTP?
   - Current design: Custom ProbeErrorCode enum (dns_error, timeout, etc.)
   - Recommendation: Custom (cleaner downstream handling)

5. **Test Infrastructure:** Mock fetch globally or per-test?
   - Recommendation: Jest mocking per describe() block

---

**Document Version:** 1.0
**Created:** 2026-01-13
**Author:** Claude (Architecture Phase)
**Status:** Design Complete, Ready for Implementation
