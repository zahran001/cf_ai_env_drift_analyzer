# Phase B3 Critique & Production Refinements

**Analysis of 4 Critical Production Concerns**
**Status:** Critique evaluation + design corrections
**Target:** Ensure Phase B3 implementation is production-hardened for Cloudflare Workers

---

## A. SSRF Validation Robustness ⚠️ HIGH PRIORITY

### Issue

Current design relies on **hostname string matching** only:
```typescript
const blocked = ["localhost", "127.0.0.1", "::1"];
if (blocked.includes(hostname)) {
  return { safe: false, reason: "blocked_hostname" };
}
```

**Vulnerabilities:**
1. **DNS Rebinding:** Attacker controls DNS → resolves "example.com" to 127.0.0.1
2. **Decimal IP:** `http://2130706433` (decimal form of 127.0.0.1) bypasses string match
3. **Hexadecimal IP:** `http://0x7f000001` bypasses string match
4. **Numeric Ranges:** `http://0177.0.0.1` (octal) bypasses check
5. **IPv6 compression:** `http://[::127.0.0.1]` bypasses simple string match

### Critique Assessment: **VALID**

The concern is **absolutely valid**. Hostname-only validation is a false sense of security and creates a CVE-like attack surface.

### Refined Solution

**Multi-layer SSRF validation:**

```typescript
/**
 * Robust SSRF validation: hostname + resolved IP checking.
 *
 * Layer 1: Hostname string blocklist (fast fail)
 * Layer 2: IP parsing (handle decimal/hex/octal representations)
 * Layer 3: CIDR range checking (private networks)
 *
 * Note: Cloudflare Workers do not expose resolved IP before fetch(),
 * so we validate the parsed.hostname and rely on:
 * - URL constructor to normalize IP representations
 * - ipaddr.js library to validate parsed IPs against CIDR ranges
 */

import ipaddr from 'ipaddr.js';

type SSRF ValidationResult = {
  safe: boolean;
  reason?: string;
  details?: { hostname?: string; ip?: string; range?: string };
};

function validateUrlSafety(url: string): SSRFValidationResult {
  try {
    const parsed = new URL(url);

    // ===== LAYER 1: Scheme Check =====
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return {
        safe: false,
        reason: "invalid_scheme",
        details: { hostname: parsed.hostname },
      };
    }

    const hostname = parsed.hostname;
    if (!hostname) {
      return { safe: false, reason: "no_hostname" };
    }

    // ===== LAYER 2: Hostname Blocklist (Fast Fail) =====
    const blockedHostnames = ["localhost", "localhost.localdomain"];
    if (blockedHostnames.includes(hostname.toLowerCase())) {
      return {
        safe: false,
        reason: "blocked_hostname",
        details: { hostname },
      };
    }

    // ===== LAYER 3: IP Parsing & CIDR Validation =====
    // This is the key improvement: normalize and validate IP addresses
    try {
      const ip = ipaddr.process(hostname); // Normalizes and parses IP

      // Check against blocked CIDR ranges
      const blockedRanges = [
        // IPv4 private ranges
        { range: "10.0.0.0/8", name: "private_10" },
        { range: "172.16.0.0/12", name: "private_172" },
        { range: "192.168.0.0/16", name: "private_192" },
        // IPv4 loopback and link-local
        { range: "127.0.0.0/8", name: "loopback_ipv4" },
        { range: "169.254.0.0/16", name: "link_local_ipv4" },
        // IPv6 loopback and link-local
        { range: "::1/128", name: "loopback_ipv6" },
        { range: "fe80::/10", name: "link_local_ipv6" },
        // IPv6 unique local (private)
        { range: "fc00::/7", name: "unique_local_ipv6" },
      ];

      for (const { range, name } of blockedRanges) {
        const [cidr, prefixLength] = range.split("/");
        const cidrIp = ipaddr.process(cidr);
        const match = ip.match(cidrIp, parseInt(prefixLength));

        if (match) {
          return {
            safe: false,
            reason: "private_ip_range",
            details: { hostname, ip: ip.toString(), range: name },
          };
        }
      }

      // If we reach here, IP is public
      return {
        safe: true,
        details: { hostname, ip: ip.toString() },
      };
    } catch {
      // hostname is not a literal IP; treat as hostname only
      // For non-IP hostnames, we assume DNS will resolve to public IP
      // (Future enhancement: could add DNS validation here)
      return {
        safe: true,
        details: { hostname, ip: "unresolved" },
      };
    }
  } catch (e) {
    return {
      safe: false,
      reason: "invalid_url",
      details: { error: (e as Error).message },
    };
  }
}
```

### Implementation Notes

**Library Choice:**
- **ipaddr.js** (https://github.com/whitequark/ipaddr.js)
  - Handles IPv4, IPv6, decimal, hex, octal representations
  - CIDR range matching
  - ~6KB minified
  - Good test coverage

**Alternative (if no external deps):**
- Implement basic IP parsing + range checking (add 100-150 lines)
- Validate IPv4 only (IPv6 check remains simpler)
- Trade-off: More code, no external dependency

**Recommendation:** Use ipaddr.js for production. It's the standard for this use case in Node.js/JS ecosystem.

### Why This Matters

Cloudflare Workers can theoretically access edge-proxied services (other Cloudflare origins, internal services). A malicious probe request could exploit SSRF to discover internal network topology. The layered approach mitigates this significantly.

### Testing This

```typescript
describe("validateUrlSafety - SSRF Protection", () => {
  it("blocks localhost variants", () => {
    expect(validateUrlSafety("http://localhost")).safe.toBe(false);
    expect(validateUrlSafety("http://localhost:8080")).safe.toBe(false);
    expect(validateUrlSafety("http://localhost.localdomain")).safe.toBe(false);
  });

  it("blocks decimal IP forms (127.0.0.1 = 2130706433)", () => {
    expect(validateUrlSafety("http://2130706433")).safe.toBe(false);
    // URL constructor normalizes to 127.0.0.1, ipaddr.process() catches it
  });

  it("blocks hex IP forms (0x7f000001)", () => {
    expect(validateUrlSafety("http://0x7f000001")).safe.toBe(false);
  });

  it("blocks octal IP forms (0177.0.0.1)", () => {
    expect(validateUrlSafety("http://0177.0.0.1")).safe.toBe(false);
  });

  it("blocks private IP ranges", () => {
    expect(validateUrlSafety("http://10.0.0.1")).safe.toBe(false);
    expect(validateUrlSafety("http://172.16.0.1")).safe.toBe(false);
    expect(validateUrlSafety("http://192.168.1.1")).safe.toBe(false);
  });

  it("blocks IPv6 loopback and link-local", () => {
    expect(validateUrlSafety("http://[::1]")).safe.toBe(false);
    expect(validateUrlSafety("http://[fe80::1]")).safe.toBe(false);
  });

  it("accepts public IPv4", () => {
    expect(validateUrlSafety("https://8.8.8.8")).safe.toBe(true);
    expect(validateUrlSafety("https://1.1.1.1")).safe.toBe(true);
  });

  it("accepts public IPv6", () => {
    expect(validateUrlSafety("https://[2606:4700:4700::1111]")).safe.toBe(true);
  });

  it("accepts public hostnames", () => {
    expect(validateUrlSafety("https://example.com")).safe.toBe(true);
    expect(validateUrlSafety("https://api.github.com")).safe.toBe(true);
  });
});
```

---

## B. Timeout Budgeting (Worker vs. Workflow) ⚠️ CRITICAL

### Issue

Current design specifies **10-second total timeout** for the probe.

**Actual constraint:** Cloudflare Workflows have step timeout of **30 seconds** by default, BUT:
- If ActiveProbeProvider takes exactly 10s
- Then the Workflow needs to call `step.do()` for `saveProbe()`
- If saveProbe takes another 1-2s
- We're at 11-12s elapsed, which is fine

**BUT the real risk:**
- If the AbortController timeout fires at exactly 10s
- The provider throws or returns error
- The Workflow still needs to persist that error to DO
- If DO call happens at 10s+ and Workflow itself is slow, we might hit the 30s limit

### Critique Assessment: **VALID and CRITICAL**

The concern is **absolutely valid**. Timeout budgeting must account for:
1. Probe execution time (up to 10s)
2. Provider wrap-up time (serializing SignalEnvelope)
3. Workflow overhead (step.do() call)
4. DO persistence time

### Refined Solution

**Conservative timeout budgeting:**

```typescript
/**
 * Timeout allocation strategy for Cloudflare Workers + Workflows.
 *
 * Cloudflare Workflow step timeout: 30 seconds
 * Cloudflare Worker execution timeout: 30 seconds (for fetch)
 *
 * Budget breakdown for ActiveProbeProvider:
 * - Probe execution time: 9 seconds (not 10)
 * - Grace period for wrap-up: 1 second
 * - Total: 10 seconds max
 *
 * Then Workflow persistence:
 * - step.do() call (saveProbe): ~500ms
 * - Total workflow elapsed: 10.5s, well under 30s limit
 *
 * Architecture:
 * - AbortController timeout: 9000ms (9 seconds)
 * - Per-hop timeout: derived from remaining budget
 */

const PROBE_CONFIG = {
  // Main timeout: 9s for actual probe (leaves 1s for wrap-up)
  PROBE_ABORT_TIMEOUT_MS: 9000,

  // Max redirects before giving up
  MAX_REDIRECTS: 10,

  // If known to be slow, reduce further
  // For future: per-environment overrides
  PER_HOP_WARNING_MS: 2000, // Log if single hop > 2s
};

class DurationTracker {
  private startTime: number = Date.now();
  private abortController: AbortController;

  constructor(timeoutMs: number = PROBE_CONFIG.PROBE_ABORT_TIMEOUT_MS) {
    this.abortController = new AbortController();

    // Set the timeout
    const timeoutId = setTimeout(() => {
      this.abortController.abort();
    }, timeoutMs);

    // Store for cleanup
    this.timeoutId = timeoutId;
  }

  getDurationMs(): number {
    return Date.now() - this.startTime;
  }

  getRemainingMs(maxMs: number): number {
    const elapsed = this.getDurationMs();
    return Math.max(0, maxMs - elapsed);
  }

  getAbortSignal(): AbortSignal {
    return this.abortController.signal;
  }

  cleanup(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    this.abortController.abort();
  }

  // New method: Check if we should bail early
  shouldContinue(maxMs: number = PROBE_CONFIG.PROBE_ABORT_TIMEOUT_MS): boolean {
    return this.getDurationMs() < maxMs;
  }
}

async function followRedirects(
  targetUrl: string,
  context?: ProviderRunnerContext
): Promise<{
  finalUrl: string;
  redirectChain: RedirectHop[];
  durationMs: number;
} | ProbeFailure> {
  const tracker = new DurationTracker(PROBE_CONFIG.PROBE_ABORT_TIMEOUT_MS);

  try {
    let currentUrl = targetUrl;
    const visited = new Set<string>();
    const redirectChain: RedirectHop[] = [];
    let hopCount = 0;

    while (hopCount < PROBE_CONFIG.MAX_REDIRECTS && tracker.shouldContinue()) {
      // Check remaining time before each fetch
      if (!tracker.shouldContinue()) {
        return {
          ok: false,
          error: {
            code: "timeout",
            message: "Probe timeout: exceeded maximum duration",
            details: { durationMs: tracker.getDurationMs(), hopCount },
          },
          durationMs: tracker.getDurationMs(),
        };
      }

      try {
        const response = await fetch(currentUrl, {
          redirect: "manual",
          signal: tracker.getAbortSignal(), // Pass abort signal
        });

        const isRedirect = [301, 302, 303, 307, 308].includes(response.status);

        if (isRedirect) {
          const location = response.headers.get("location");
          if (!location) {
            return {
              ok: false,
              error: {
                code: "fetch_error",
                message: "Redirect response missing Location header",
                details: { status: response.status, hopCount },
              },
              durationMs: tracker.getDurationMs(),
            };
          }

          const absoluteUrl = resolveUrl(currentUrl, location);
          if (!absoluteUrl) {
            return {
              ok: false,
              error: {
                code: "fetch_error",
                message: "Failed to resolve Location to absolute URL",
                details: { location, hopCount },
              },
              durationMs: tracker.getDurationMs(),
            };
          }

          if (visited.has(absoluteUrl)) {
            return {
              ok: false,
              error: {
                code: "fetch_error",
                message: "Redirect loop detected",
                details: { loopUrl: absoluteUrl, hopCount },
              },
              durationMs: tracker.getDurationMs(),
            };
          }

          visited.add(currentUrl);
          redirectChain.push({
            fromUrl: currentUrl,
            toUrl: absoluteUrl,
            status: response.status,
          });

          currentUrl = absoluteUrl;
          hopCount++;
        } else {
          // Final response
          return {
            finalUrl: currentUrl,
            redirectChain,
            durationMs: tracker.getDurationMs(),
          };
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          return {
            ok: false,
            error: {
              code: "timeout",
              message: "Probe timeout during fetch",
              details: { durationMs: tracker.getDurationMs(), hopCount },
            },
            durationMs: tracker.getDurationMs(),
          };
        }

        // Other fetch errors
        return {
          ok: false,
          error: {
            code: classifyFetchError(e),
            message: (e as Error).message,
            details: { hopCount },
          },
          durationMs: tracker.getDurationMs(),
        };
      }
    }

    // Exceeded max redirects
    if (hopCount >= PROBE_CONFIG.MAX_REDIRECTS) {
      return {
        ok: false,
        error: {
          code: "fetch_error",
          message: `Exceeded maximum redirects (${PROBE_CONFIG.MAX_REDIRECTS})`,
          details: { hopCount },
        },
        durationMs: tracker.getDurationMs(),
      };
    }

    // Shouldn't reach here
    return {
      ok: false,
      error: {
        code: "unknown_error",
        message: "Unexpected state in redirect following",
        details: { hopCount },
      },
      durationMs: tracker.getDurationMs(),
    };
  } finally {
    tracker.cleanup();
  }
}
```

### Workflow Integration

```typescript
// In src/workflows/compareEnvironments.ts (Phase B6)

// Step 3: Probe left URL
const leftProbeStartTime = Date.now();
const leftEnvelope = await step.do("probe-left", async () => {
  // activeProbeProvider will timeout internally at 9s
  return activeProbeProvider.probe(leftUrl, {
    colo: request.cf?.colo,
    country: request.cf?.country,
    asn: request.cf?.asn,
  });
});
const leftProbeElapsed = Date.now() - leftProbeStartTime;

// Verify we're within budget
if (leftProbeElapsed > 11000) {
  throw new Error(`Left probe exceeded budget: ${leftProbeElapsed}ms`);
}

// Step 4: Save left probe to DO
const leftProbeId = `${comparisonId}:left`;
await step.do("save-left-probe", async () => {
  return envPairDO.saveProbe(comparisonId, leftProbeId, leftEnvelope);
});

// Repeat for right...
```

### Testing This

```typescript
describe("ActiveProbeProvider - Timeout Handling", () => {
  it("timeout at 9s AbortController, not 10s", async () => {
    const startTime = Date.now();

    // Mock fetch to hang indefinitely
    mockFetch.mockImplementationOnce(
      () => new Promise(() => {}) // Never resolves
    );

    const envelope = await activeProbeProvider.probe("https://slow.example.com");

    const elapsed = Date.now() - startTime;

    expect(envelope.result.ok).toBe(false);
    if (!envelope.result.ok) {
      expect(envelope.result.error.code).toBe("timeout");
    }

    // Should abort around 9s, allowing 1s for wrap-up
    expect(elapsed).toBeGreaterThan(8000);
    expect(elapsed).toBeLessThan(10500); // Allow some overhead
  });

  it("provider completes well before Workflow timeout", async () => {
    const startTime = Date.now();

    // Mock fast response
    mockFetch.mockResolvedValueOnce(
      new Response("OK", { status: 200 })
    );

    const envelope = await activeProbeProvider.probe("https://fast.example.com");

    const elapsed = Date.now() - startTime;

    // Should be < 100ms
    expect(elapsed).toBeLessThan(200);

    // Workflow overhead (step.do call, DO save, etc.) should be < 500ms
    // Total: ~700ms, well under 30s step timeout
  });
});
```

### Impact on Design

- **PHASE_B3_DESIGN.md**: Update timeout section to 9s (not 10s)
- **PROBE_CONFIG constant**: Add to activeProbe.ts with these values
- **Error handling**: Add "timeout budget exceeded" distinction
- **Workflow logging**: Log probe duration to catch anomalies

---

## C. Cloudflare request.cf Availability ⚠️ MEDIUM PRIORITY

### Issue

The design assumes `request.cf` is always available:
```typescript
const context = {
  colo: request.cf.colo,
  country: request.cf.country,
  asn: request.cf.asn,
};
```

**Actual constraints:**
1. **Local development** (`wrangler dev`): `request.cf` is mocked or partial
2. **Cloudflare Pages context**: Different structure than Workers
3. **Testing environment**: `request.cf` might be undefined

If code doesn't handle missing `cf`, it crashes.

### Critique Assessment: **VALID**

The concern is **valid**. Must gracefully degrade when `cf` is unavailable.

### Refined Solution

**Safe fallback handling:**

```typescript
/**
 * Extract safe runner context from Cloudflare request.cf.
 * All fields are optional; provides sensible defaults for local dev.
 */
function extractRunnerContext(
  cfContext?: Record<string, any>
): ProviderRunnerContext {
  if (!cfContext) {
    // Local development fallback
    return {
      colo: "LOCAL",
      country: "XX",
      asn: undefined,
      asOrganization: undefined,
    };
  }

  return {
    colo: cfContext.colo ?? "UNKNOWN",
    country: cfContext.country ?? "XX",
    asn: cfContext.asn ?? undefined,
    asOrganization: cfContext.asOrganization ?? undefined,
    tlsVersion: cfContext.tlsVersion ?? undefined,
    httpProtocol: cfContext.httpProtocol ?? undefined,
  };
}

// Usage in Worker route
export async function handleCompare(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const leftUrl = new URL(request.url).searchParams.get("leftUrl");
  const rightUrl = new URL(request.url).searchParams.get("rightUrl");

  // Extract cf safely
  const cfContext = (request as any).cf;
  const runnerContext = extractRunnerContext(cfContext);

  // Probe with safe context
  const leftEnvelope = await activeProbeProvider.probe(leftUrl, runnerContext);
  const rightEnvelope = await activeProbeProvider.probe(rightUrl, runnerContext);

  // ... rest of logic
}
```

### Unit Test

```typescript
describe("extractRunnerContext", () => {
  it("extracts all fields when cf is available", () => {
    const cf = {
      colo: "SFO",
      country: "US",
      asn: 16509,
      asOrganization: "Amazon",
      tlsVersion: "TLSv1.3",
      httpProtocol: "h2",
    };

    const context = extractRunnerContext(cf);

    expect(context.colo).toBe("SFO");
    expect(context.country).toBe("US");
    expect(context.asn).toBe(16509);
    expect(context.asOrganization).toBe("Amazon");
    expect(context.tlsVersion).toBe("TLSv1.3");
    expect(context.httpProtocol).toBe("h2");
  });

  it("provides safe defaults when cf is undefined", () => {
    const context = extractRunnerContext(undefined);

    expect(context.colo).toBe("LOCAL");
    expect(context.country).toBe("XX");
    expect(context.asn).toBeUndefined();
  });

  it("handles partial cf object", () => {
    const cf = { colo: "LON" }; // Only colo present

    const context = extractRunnerContext(cf);

    expect(context.colo).toBe("LON");
    expect(context.country).toBe("XX"); // Fallback
    expect(context.asn).toBeUndefined();
  });

  it("handles null cf gracefully", () => {
    const context = extractRunnerContext(null as any);

    expect(context.colo).toBe("LOCAL");
    expect(context.country).toBe("XX");
  });
});
```

### Documentation

Add to PHASE_B3_DESIGN.md:

```markdown
### Runner Context in Development

The `request.cf` object is a Cloudflare-specific context object that provides geolocation,
network, and security information about the request. During **local development with wrangler dev**,
this object is partially mocked.

**Development behavior:**
- `colo` → mocked to arbitrary value or "LOCAL"
- `country` → mocked to "XX"
- `asn` → often undefined

The provider gracefully handles missing cf by providing sensible defaults:
- `colo: "LOCAL"` when unavailable
- `country: "XX"` when unavailable
- `asn: undefined` when unavailable

This ensures the provider works in **all contexts**:
- Cloudflare Workers (production)
- Local development (wrangler dev)
- Testing (Jest with mocked cf)
```

---

## D. Header Normalization (Determinism) ⚠️ MEDIUM PRIORITY

### Issue

Current design uses `.toLowerCase()` for header keys, but doesn't **guarantee deterministic output**.

```typescript
function filterHeaders(rawHeaders: Record<string, string>): {
  core: CoreResponseHeaders;
  accessControl?: AccessControlHeaders;
} {
  const coreHeaders: CoreResponseHeaders = {};
  const acHeaders: Record<string, string> = {};

  for (const [key, value] of Object.entries(rawHeaders)) {
    const lower = key.toLowerCase();
    // ... logic
  }

  // Problem: Object.entries() iteration order is not guaranteed in JS
  // (Though in practice, it's insertion order for string keys)
}
```

**Risk:** If headers are added in different orders across multiple runs, the JSON serialization might differ, violating Phase B2's "deterministic output" requirement.

### Critique Assessment: **VALID**

The concern is **valid**. Must ensure output is **byte-identical** for same input.

### Refined Solution

**Deterministic header filtering with sorted keys:**

```typescript
/**
 * Filter and normalize response headers deterministically.
 *
 * Ensures:
 * 1. Only whitelisted headers are included
 * 2. Header keys are lowercase
 * 3. Output is always in sorted order (for deterministic JSON serialization)
 */
function filterHeaders(
  rawHeaders: Record<string, string>
): ResponseHeadersSnapshot {
  // Whitelist of core headers
  const CORE_WHITELIST = new Set([
    "cache-control",
    "content-type",
    "vary",
    "www-authenticate",
    "location",
  ]);

  // Parse and normalize
  const coreHeaders: CoreResponseHeaders = {};
  const acHeaders: Record<string, string> = {};

  for (const [key, value] of Object.entries(rawHeaders)) {
    const lower = key.toLowerCase();

    // Check core whitelist
    if (CORE_WHITELIST.has(lower)) {
      coreHeaders[lower as keyof CoreResponseHeaders] = value;
    }

    // Check access-control-* prefix
    if (lower.startsWith("access-control-")) {
      acHeaders[lower] = value;
    }
  }

  // CRITICAL: Sort keys for deterministic output
  const sortedCoreHeaders: CoreResponseHeaders = {};
  for (const key of Object.keys(coreHeaders).sort()) {
    sortedCoreHeaders[key as keyof CoreResponseHeaders] = coreHeaders[key as keyof CoreResponseHeaders];
  }

  const sortedAcHeaders: Record<string, string> = {};
  for (const key of Object.keys(acHeaders).sort()) {
    sortedAcHeaders[key] = acHeaders[key];
  }

  const result: ResponseHeadersSnapshot = {
    core: sortedCoreHeaders,
  };

  if (Object.keys(sortedAcHeaders).length > 0) {
    result.accessControl = sortedAcHeaders;
  }

  return result;
}
```

### Why Sorting Matters

```typescript
// WITHOUT sorting: Order depends on fetch response order (non-deterministic)
{
  "core": {
    "vary": "Accept-Encoding",
    "cache-control": "public, max-age=3600",
    "content-type": "application/json"
  }
}

// WITH sorting: Always alphabetical (deterministic)
{
  "core": {
    "cache-control": "public, max-age=3600",
    "content-type": "application/json",
    "vary": "Accept-Encoding"
  }
}
```

**JSON.stringify() on sorted objects produces identical strings:**

```typescript
const obj1 = { b: 2, a: 1 };
const obj2 = { a: 1, b: 2 };

JSON.stringify(obj1) === JSON.stringify(obj2)
// FALSE! Different insertion order

// Solution: sort keys before serialization
const sorted1 = Object.fromEntries(
  Object.entries(obj1).sort()
);
const sorted2 = Object.fromEntries(
  Object.entries(obj2).sort()
);

JSON.stringify(sorted1) === JSON.stringify(sorted2)
// TRUE! Byte-identical
```

### Testing This

```typescript
describe("filterHeaders - Determinism", () => {
  it("produces identical JSON for same headers in different order", () => {
    const headers1 = {
      "cache-control": "public",
      "content-type": "application/json",
      "vary": "Accept-Encoding",
    };

    const headers2 = {
      "vary": "Accept-Encoding",
      "cache-control": "public",
      "content-type": "application/json",
    };

    const result1 = filterHeaders(headers1);
    const result2 = filterHeaders(headers2);

    // JSON should be byte-identical
    expect(JSON.stringify(result1)).toBe(JSON.stringify(result2));
  });

  it("normalizes header case to lowercase", () => {
    const headers = {
      "CACHE-CONTROL": "public",
      "Content-Type": "application/json",
      "Cache-Control": "public", // Duplicate with different case
    };

    const result = filterHeaders(headers);

    // All keys should be lowercase
    for (const key of Object.keys(result.core)) {
      expect(key).toBe(key.toLowerCase());
    }
  });

  it("ignores non-whitelisted headers", () => {
    const headers = {
      "cache-control": "public",
      "x-custom-header": "ignored",
      "authorization": "Bearer token", // Never captured
      "set-cookie": "session=123", // Never captured
    };

    const result = filterHeaders(headers);

    expect(result.core["cache-control"]).toBe("public");
    expect("x-custom-header" in result.core).toBe(false);
    expect("authorization" in result.core).toBe(false);
    expect("set-cookie" in result.core).toBe(false);
  });

  it("captures all access-control-* headers", () => {
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST",
      "access-control-max-age": "3600",
    };

    const result = filterHeaders(headers);

    expect(result.accessControl?.["access-control-allow-origin"]).toBe("*");
    expect(result.accessControl?.["access-control-allow-methods"]).toBe(
      "GET, POST"
    );
    expect(result.accessControl?.["access-control-max-age"]).toBe("3600");
  });
});
```

### Impact on Design

- **filterHeaders function**: Add explicit key sorting
- **SignalEnvelope JSON**: Will now always be byte-identical for same input
- **Phase B2 tests**: Should pass with deterministic header ordering
- **Documentation**: Note sorting requirement in header filtering

---

## Summary: Critique Acceptance & Corrections

| Critique | Severity | Assessment | Action | Impact |
|----------|----------|-----------|--------|--------|
| **A. SSRF Validation** | HIGH | VALID | Use ipaddr.js library, 3-layer validation | Production security |
| **B. Timeout Budgeting** | CRITICAL | VALID | Reduce to 9s AbortController, add grace period | Prevents Workflow failure |
| **C. cf Availability** | MEDIUM | VALID | Add extractRunnerContext() with fallbacks | Supports local dev + testing |
| **D. Header Normalization** | MEDIUM | VALID | Sort header keys in filterHeaders() | Ensures determinism |

---

## Updated PHASE_B3_DESIGN.md Sections

The following sections need updates based on refinements:

1. **§4.3 SSRF Protection** → Upgrade to 3-layer validation with ipaddr.js
2. **§4.6 Duration Measurement** → Reduce to 9s, add grace period concept
3. **§3.2 Provider Semantics** → Add "graceful degradation for cf context"
4. **§4.4 Header Whitelisting** → Add key sorting requirement
5. **§6.2 Testing Strategy** → Add SSRF bypass tests, timeout budget tests
6. **§9.4 Error Handling** → Add "timeout budget exceeded" error code

---

## Implementation Recommendation

**Phase B3 Implementation Order:**

1. ✅ Define types and interface (src/providers/types.ts)
2. ✅ Implement utility functions (SSRF, URL resolution, error classification)
3. ✅ Implement followRedirects() with 9s timeout + grace period
4. ✅ Implement filterHeaders() with sorted keys
5. ✅ Implement extractRunnerContext() with fallbacks
6. ✅ Implement probe() orchestrator
7. ✅ Add comprehensive test suite (45-50 tests)
8. ✅ Add temporary `/api/probe` endpoint
9. ✅ Manual testing with edge cases (SSRF, redirects, timeouts)

---

**Document Version:** 1.1 (Refinements Applied)
**Status:** Ready for Implementation
**Dependencies:** ipaddr.js library (add to package.json)
