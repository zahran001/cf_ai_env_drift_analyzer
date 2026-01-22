import ipaddr from "ipaddr.js";
import type {
  SignalEnvelope,
  ProbeSuccess,
  ProbeResponseError,
  ProbeNetworkFailure,
  ProbeErrorCode,
  RedirectHop,
  ResponseMetadata,
  CoreResponseHeaders,
  AccessControlHeaders,
} from "@shared/signal";
import { SIGNAL_SCHEMA_VERSION } from "@shared/signal";
import type { ProviderRunnerContext } from "./types";
import { ISignalProvider } from "./types";

/**
 * SSRF Validation Result
 * Critique A: 3-layer SSRF validation with ipaddr.js
 */
type SSRFValidationResult = {
  safe: boolean;
  reason?: string;
  details?: { hostname?: string; ip?: string; range?: string };
};

/**
 * Probe timing and budget tracking
 * Critique B: Timeout budgeting with early-exit checks
 */
class DurationTracker {
  private readonly startTime: number;
  private readonly abortTimeoutMs: number;
  private readonly controller: AbortController;

  constructor(timeoutMs: number = 9000) {
    this.startTime = Date.now();
    this.abortTimeoutMs = timeoutMs;
    this.controller = new AbortController();

    // Set timeout to abort fetch operations
    setTimeout(() => {
      this.controller.abort();
    }, this.abortTimeoutMs);
  }

  /**
   * Get the abort signal for fetch operations
   */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /**
   * Get remaining time in milliseconds
   */
  getRemainingMs(): number {
    const elapsed = Date.now() - this.startTime;
    const remaining = this.abortTimeoutMs - elapsed;
    return Math.max(0, remaining);
  }

  /**
   * Check if we should continue execution (has time remaining)
   */
  shouldContinue(): boolean {
    return this.getRemainingMs() > 100; // Keep 100ms buffer
  }

  /**
   * Get total elapsed time
   */
  getElapsedMs(): number {
    return Date.now() - this.startTime;
  }
}

/**
 * Layer 1 + Layer 2 + Layer 3 SSRF validation
 * Critique A: Handles decimal, hex, octal IP representations + CIDR ranges
 * Returns reason to distinguish between invalid_url (malformed) vs SSRF (blocked for security)
 */
function validateUrlSafety(url: string): SSRFValidationResult & { isInvalidUrl?: boolean } {
  try {
    const parsed = new URL(url);

    // ===== LAYER 1: Scheme Check =====
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return {
        safe: false,
        reason: "invalid_scheme",
        isInvalidUrl: true,
        details: { hostname: parsed.hostname },
      };
    }

    const hostname = parsed.hostname;
    if (!hostname) {
      return { safe: false, reason: "no_hostname", isInvalidUrl: true };
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
    // ipaddr.process() normalizes and parses IP addresses (handles decimal/hex/octal)
    try {
      // Strip brackets from IPv6 addresses for ipaddr.process
      const hostForParsing = hostname.replace(/^\[(.+)\]$/, "$1");
      const ip = ipaddr.process(hostForParsing);

      // Check IPv4 ranges
      if (ip.kind() === "ipv4") {
        const ipv4 = ip as ipaddr.IPv4;

        // Blocked IPv4 ranges
        const blockedIPv4Ranges: Array<{ addr: string; prefix: number; name: string }> = [
          { addr: "10.0.0.0", prefix: 8, name: "10.0.0.0/8" },
          { addr: "172.16.0.0", prefix: 12, name: "172.16.0.0/12" },
          { addr: "192.168.0.0", prefix: 16, name: "192.168.0.0/16" },
          { addr: "127.0.0.0", prefix: 8, name: "127.0.0.0/8" },
          { addr: "169.254.0.0", prefix: 16, name: "169.254.0.0/16" },
        ];

        for (const { addr, prefix, name } of blockedIPv4Ranges) {
          if (ipv4.match(ipaddr.IPv4.parse(addr), prefix)) {
            return {
              safe: false,
              reason: "blocked_cidr_range",
              details: { hostname, ip: ipv4.toString(), range: name },
            };
          }
        }
      } else if (ip.kind() === "ipv6") {
        const ipv6 = ip as ipaddr.IPv6;

        // Blocked IPv6 ranges
        const blockedIPv6Ranges: Array<{ addr: string; prefix: number; name: string }> = [
          { addr: "::1", prefix: 128, name: "::1/128" },
          { addr: "fe80::", prefix: 10, name: "fe80::/10" },
        ];

        for (const { addr, prefix, name } of blockedIPv6Ranges) {
          if (ipv6.match(ipaddr.IPv6.parse(addr), prefix)) {
            return {
              safe: false,
              reason: "blocked_cidr_range",
              details: { hostname, ip: ipv6.toString(), range: name },
            };
          }
        }
      }
    } catch {
      // If ipaddr.process() fails, it's likely not an IP, so allow hostname
      // (DNS will fail later if it's truly invalid)
    }

    return { safe: true };
  } catch (err) {
    return {
      safe: false,
      reason: "invalid_url",
      isInvalidUrl: true,
      details: { hostname: "unknown" },
    };
  }
}

/**
 * Extract runner context from request.cf
 * Critique C: Safe fallbacks for local development
 */
function extractRunnerContext(cfContext?: Record<string, any>): ProviderRunnerContext {
  if (!cfContext) {
    return {
      colo: "LOCAL",
      country: "XX",
      asn: undefined,
    };
  }

  return {
    colo: cfContext.colo ?? "LOCAL",
    country: cfContext.country ?? "XX",
    asn: cfContext.asn,
    asOrganization: cfContext.asOrganization,
    tlsVersion: cfContext.tlsVersion,
    httpProtocol: cfContext.httpProtocol,
  };
}

/**
 * Resolve relative URL to absolute
 */
function resolveUrl(base: string, relative: string): string {
  try {
    return new URL(relative, base).toString();
  } catch {
    return relative;
  }
}

/**
 * Classify fetch errors into deterministic error codes
 */
function classifyFetchError(error: unknown): ProbeErrorCode {
  const message = String(error).toLowerCase();

  if (message.includes("abort") || message.includes("timeout")) {
    return "timeout";
  }
  if (message.includes("enotfound") || message.includes("dns")) {
    return "dns_error";
  }
  if (message.includes("certificate") || message.includes("tls")) {
    return "tls_error";
  }
  if (message.includes("ssrf")) {
    return "ssrf_blocked";
  }

  return "fetch_error";
}

/**
 * Classify HTTP status code as probe success or failure.
 *
 * Semantics:
 * - 2xx and 3xx: Probe succeeded (request was fulfilled or redirected)
 * - 4xx and 5xx: Probe failed (request was rejected or server errored)
 *
 * This ensures that status drift (e.g., 200 vs 404) is correctly captured
 * in outcomeChanged and severity classification.
 */
function classifyStatusOutcome(status: number): boolean {
  return status < 400;
}

/**
 * Filter and normalize response headers
 * Critique D: Sorted keys for deterministic JSON output
 */
function filterHeaders(headers: Headers): { core: CoreResponseHeaders; accessControl?: AccessControlHeaders } {
  const coreHeaders: Record<string, string> = {};
  const accessControlHeaders: Record<string, string> = {};

  // Whitelisted core headers (lowercase)
  const coreWhitelist = [
    "cache-control",
    "content-type",
    "vary",
    "www-authenticate",
    "location",
  ];

  // Iterate through headers using forEach (Headers iterator)
  headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();

    if (coreWhitelist.includes(lowerKey)) {
      coreHeaders[lowerKey] = value;
    } else if (lowerKey.startsWith("access-control-")) {
      accessControlHeaders[lowerKey] = value;
    }
  });

  // Sort core headers keys for deterministic output
  const sortedCoreHeaders: CoreResponseHeaders = {};
  for (const key of Object.keys(coreHeaders).sort()) {
    sortedCoreHeaders[key as keyof CoreResponseHeaders] = coreHeaders[key];
  }

  // Sort access control headers keys
  const sortedAccessControlHeaders: AccessControlHeaders = {};
  for (const key of Object.keys(accessControlHeaders).sort()) {
    sortedAccessControlHeaders[key] = accessControlHeaders[key];
  }

  return {
    core: sortedCoreHeaders,
    accessControl: Object.keys(sortedAccessControlHeaders).length > 0 ? sortedAccessControlHeaders : undefined,
  };
}

/**
 * Follow redirects manually (up to 10 hops)
 * Critique B: Timeout budgeting with early-exit checks
 */
async function followRedirects(
  initialUrl: string,
  tracker: DurationTracker
): Promise<
  | { finalUrl: string; redirects: RedirectHop[]; status: number; headers: Headers }
  | ProbeNetworkFailure
> {
  const redirects: RedirectHop[] = [];
  const visited = new Set<string>();
  let currentUrl = initialUrl;
  let maxHops = 10;

  while (maxHops > 0) {
    // Check remaining time budget (Critique B)
    if (!tracker.shouldContinue()) {
      return {
        ok: false,
        error: {
          code: "timeout" as ProbeErrorCode,
          message: "Timeout during redirect chain",
          details: { durationMs: tracker.getElapsedMs(), hopsCompleted: redirects.length },
        },
        durationMs: tracker.getElapsedMs(),
      };
    }

    try {
      const response = await fetch(currentUrl, {
        redirect: "manual",
        signal: tracker.signal,
      });

      const status = response.status;

      // Check for redirect status codes
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = response.headers.get("Location");

        if (!location) {
          return {
            ok: false,
            error: {
              code: "fetch_error" as ProbeErrorCode,
              message: `Redirect status ${status} without Location header`,
              details: { fromUrl: currentUrl, status },
            },
            durationMs: tracker.getElapsedMs(),
          };
        }

        const nextUrl = resolveUrl(currentUrl, location);

        if (visited.has(nextUrl)) {
          return {
            ok: false,
            error: {
              code: "fetch_error" as ProbeErrorCode,
              message: "Redirect loop detected",
              details: { loopUrl: nextUrl, chainLength: redirects.length },
            },
            durationMs: tracker.getElapsedMs(),
          };
        }

        redirects.push({
          fromUrl: currentUrl,
          toUrl: nextUrl,
          status,
        });

        visited.add(currentUrl);
        currentUrl = nextUrl;
        maxHops--;
        continue;
      }

      // Final response (not a redirect)
      return {
        finalUrl: response.url || currentUrl,
        redirects: redirects.length > 0 ? redirects : [],
        status,
        headers: response.headers,
      };
    } catch (err) {
      const code = classifyFetchError(err);
      return {
        ok: false,
        error: {
          code,
          message: `${code}: ${String(err)}`,
          details: { url: currentUrl },
        },
        durationMs: tracker.getElapsedMs(),
      };
    }
  }

  // Max redirects exceeded
  return {
    ok: false,
    error: {
      code: "fetch_error" as ProbeErrorCode,
      message: "Too many redirects (>10)",
      details: { chainLength: redirects.length },
    },
    durationMs: tracker.getElapsedMs(),
  };
}

/**
 * ActiveProbeProvider: Orchestrates SSRF validation, redirect following, and header filtering
 */
export class ActiveProbeProvider implements ISignalProvider {
  async probe(url: string, context?: ProviderRunnerContext): Promise<SignalEnvelope> {
    const capturedAt = new Date().toISOString();
    const tracker = new DurationTracker(9000);

    // Extract runner context with fallbacks (Critique C)
    const runnerContext = context || extractRunnerContext();

    // Validate SSRF before any network operations (Critique A)
    const validation = validateUrlSafety(url);
    if (!validation.safe) {
      // Distinguish between invalid_url (malformed) and ssrf_blocked (security rejection)
      const errorCode: ProbeErrorCode = validation.isInvalidUrl ? "invalid_url" : "ssrf_blocked";
      return {
        schemaVersion: SIGNAL_SCHEMA_VERSION,
        comparisonId: "unknown",
        probeId: "unknown",
        side: "left",
        requestedUrl: url,
        capturedAt,
        cf: runnerContext,
        result: {
          ok: false,
          error: {
            code: errorCode,
            message: `URL validation failed: ${validation.reason}`,
            details: validation.details,
          },
          durationMs: tracker.getElapsedMs(),
        },
      };
    }

    // Follow redirects and get final response
    const redirectResult = await followRedirects(url, tracker);

    // Handle probe failure
    if ("ok" in redirectResult) {
      return {
        schemaVersion: SIGNAL_SCHEMA_VERSION,
        comparisonId: "unknown",
        probeId: "unknown",
        side: "left",
        requestedUrl: url,
        capturedAt,
        cf: runnerContext,
        result: redirectResult,
      };
    }

    // Build response metadata from successful redirect result
    const { finalUrl, redirects, status, headers } = redirectResult as {
      finalUrl: string;
      redirects: RedirectHop[];
      status: number;
      headers: Headers;
    };

    const headerSnapshot = filterHeaders(headers);

    const response: ResponseMetadata = {
      status,
      finalUrl,
      headers: headerSnapshot,
    };

    // Classify response status: 2xx/3xx = success, 4xx/5xx = error response
    const isSuccessStatus = classifyStatusOutcome(status);

    const result: ProbeSuccess | ProbeResponseError = isSuccessStatus
      ? {
          ok: true,
          response,
          redirects: redirects.length > 0 ? redirects : undefined,
          durationMs: tracker.getElapsedMs(),
        }
      : {
          ok: false,
          response,
          redirects: redirects.length > 0 ? redirects : undefined,
          durationMs: tracker.getElapsedMs(),
        };

    return {
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      comparisonId: "unknown",
      probeId: "unknown",
      side: "left",
      requestedUrl: url,
      capturedAt,
      cf: runnerContext,
      result,
    };
  }
}

// Export singleton instance
export const activeProbeProvider = new ActiveProbeProvider();
