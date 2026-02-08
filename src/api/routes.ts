import type { Env } from "../env";
import type { CompareError } from "@shared/api";
import type { CfContextSnapshot } from "@shared/signal";
import { computePairKeySHA256 } from "../utils/pairKey";
import { validateProbeUrl } from "./validate";

/**
 * CORS headers for local development.
 * In production (same-domain Pages routing), these are harmless.
 */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** Wrap Response.json with CORS headers. */
function jsonResponse(data: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    headers.set(k, v);
  }
  return new Response(JSON.stringify(data), {
    ...init,
    headers,
    status: init?.status ?? 200,
  });
}

/** Build a CompareError-shaped error response. */
function errorResponse(
  error: CompareError,
  status: number
): Response {
  return jsonResponse({ error }, { status });
}

/**
 * Extract runner context from Cloudflare request.cf object.
 * Used to provide geographical/network context to probes for LLM awareness.
 */
function extractRunnerContext(request: Request): CfContextSnapshot {
  const cf = (request as any).cf as Record<string, any> | undefined;

  if (!cf) {
    return {
      colo: "LOCAL",
      country: "XX",
    };
  }

  return {
    colo: cf.colo ?? "LOCAL",
    country: cf.country ?? "XX",
    asn: cf.asn ?? undefined,
    asOrganization: cf.asOrganization ?? undefined,
    tlsVersion: cf.tlsVersion ?? undefined,
    httpProtocol: cf.httpProtocol ?? undefined,
  };
}

export async function router(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Health check endpoint
  if (request.method === "GET" && url.pathname === "/api/health") {
    return jsonResponse({ ok: true });
  }

  // POST /api/compare - Start a new comparison
  if (request.method === "POST" && url.pathname === "/api/compare") {
    return handlePostCompare(request, env);
  }

  // GET /api/compare/:comparisonId - Poll comparison status
  if (request.method === "GET" && url.pathname.match(/^\/api\/compare\/[^/]+$/)) {
    const comparisonId = url.pathname.split("/")[3];
    return handleGetCompareStatus(comparisonId, env);
  }

  return new Response("Not found", { status: 404 });
}

/**
 * POST /api/compare - Start comparison workflow.
 *
 * Request: CompareRequest { leftUrl, rightUrl, leftLabel?, rightLabel? }
 * Response: { comparisonId: string } (status 202 Accepted)
 *
 * Steps:
 * 1. Validate URLs (format, scheme, IP ranges)
 * 2. Compute pairKey (SHA-256 hash of sorted URLs)
 * 3. Generate comparisonId = ${pairKeyPrefix}-${uuid} (stable routing)
 * 4. Start Workflow with stable inputs (including optional labels)
 * 5. Return immediately with comparisonId for polling
 */
async function handlePostCompare(request: Request, env: Env): Promise<Response> {
  try {
    console.log(`[Worker] POST /api/compare received`);
    const body = (await request.json()) as {
      leftUrl?: string;
      rightUrl?: string;
      leftLabel?: string;
      rightLabel?: string;
    };
    const { leftUrl, rightUrl, leftLabel, rightLabel } = body;
    console.log(`[Worker] Parsed URLs: left="${leftUrl}", right="${rightUrl}"`);

    // Validate inputs
    if (!leftUrl || !rightUrl) {
      console.log(`[Worker] ERROR: Missing leftUrl or rightUrl`);
      return errorResponse(
        { code: "invalid_request", message: "Missing leftUrl or rightUrl" },
        400
      );
    }

    // Validate URLs (SSRF protection)
    console.log(`[Worker] Validating leftUrl...`);
    const leftValidation = validateProbeUrl(leftUrl);
    if (!leftValidation.valid) {
      console.log(`[Worker] ERROR: Invalid leftUrl: ${leftValidation.reason}`);
      const code = classifyValidationError(leftValidation.reason);
      return errorResponse(
        { code, message: `Invalid leftUrl: ${leftValidation.reason}` },
        400
      );
    }

    console.log(`[Worker] Validating rightUrl...`);
    const rightValidation = validateProbeUrl(rightUrl);
    if (!rightValidation.valid) {
      console.log(`[Worker] ERROR: Invalid rightUrl: ${rightValidation.reason}`);
      const code = classifyValidationError(rightValidation.reason);
      return errorResponse(
        { code, message: `Invalid rightUrl: ${rightValidation.reason}` },
        400
      );
    }

    // Compute pairKey using SHA-256
    console.log(`[Worker] Computing pairKey...`);
    const pairKey = await computePairKeySHA256(leftUrl, rightUrl);
    console.log(`[Worker] pairKey computed: ${pairKey}`);

    // Generate stable comparisonId
    // Format: ${pairKeyPrefix}-${uuid} where pairKeyPrefix is first 40 chars of SHA-256
    // Cloudflare Workflows enforce: ID length ≤ 100 chars, regex: ^[a-zA-Z0-9_][a-zA-Z0-9-_]*$
    // Calculation: 40 (pairKeyPrefix) + 1 (hyphen) + 36 (UUID) = 77 chars ✅ under 100 limit
    const pairKeyPrefix = pairKey.substring(0, 40);
    const uuid = crypto.randomUUID();
    const comparisonId = `${pairKeyPrefix}-${uuid}`;
    console.log(`[Worker] comparisonId generated: ${comparisonId}`);

    // Extract runner context for LLM awareness (geographical/network info)
    const runnerContext = extractRunnerContext(request);
    console.log(`[Worker] runnerContext extracted: colo=${runnerContext.colo}, country=${runnerContext.country}`);

    // Start Workflow with stable inputs (including optional labels)
    // Per CLAUDE.md 4.2: Worker validates input, computes pairKey,
    // encodes pairKey in comparisonId, starts Workflow, returns immediately
    await env.COMPARE_WORKFLOW.create({
      id: comparisonId,
      params: {
        comparisonId,
        leftUrl,
        rightUrl,
        leftLabel,
        rightLabel,
        pairKey: pairKeyPrefix,
        runnerContext,
      },
    });

    console.log(`[Worker] Started workflow ${comparisonId} for ${leftUrl} <-> ${rightUrl}`);

    return jsonResponse({ comparisonId }, { status: 202 });
  } catch (err) {
    console.error(`[Worker] CAUGHT ERROR:`, err);
    if (err instanceof Error) {
      console.error(`[Worker] Error stack:`, err.stack);
    }
    return errorResponse(
      { code: "internal_error", message: `Failed to start comparison: ${String(err)}` },
      500
    );
  }
}

/**
 * Map validation failure reasons to CompareErrorCode.
 */
function classifyValidationError(reason: string): CompareError["code"] {
  const lower = reason.toLowerCase();
  if (lower.includes("localhost") || lower.includes("private") ||
      lower.includes("loopback") || lower.includes("link-local") ||
      lower.includes("blocked") || lower.includes("any-address") ||
      lower.includes("ipv6-mapped")) {
    return "ssrf_blocked";
  }
  return "invalid_url";
}

/**
 * GET /api/compare/:comparisonId - Poll comparison status.
 *
 * Response shape matches CompareStatusResponse from shared/api.ts:
 * - 200 + { status: "running" } — Still processing
 * - 200 + { status: "completed", result: CompareResult } — Done
 * - 200 + { status: "failed", error: CompareError } — Failed
 * - 404 + { error: CompareError } — Not found
 * - 500 + { error: CompareError } — Server error
 *
 * Per CLAUDE.md section 4.4:
 * 1. Extract pairKey from comparisonId prefix
 * 2. Get DO stub: env.ENVPAIR_DO.idFromName(pairKey)
 * 3. Call stub.getComparison(comparisonId) via RPC
 * 4. Return status (Worker does NOT cache)
 */
async function handleGetCompareStatus(
  comparisonId: string,
  env: Env
): Promise<Response> {
  try {
    // Extract pairKeyPrefix from comparisonId format: ${pairKeyPrefix}-${uuid}
    // Note: pairKeyPrefix is first 40 chars of SHA-256 hex, UUID is 36 chars
    // Total format: 40 hex chars + hyphen + 36 UUID chars = 77 total
    const pairKeyPrefix = comparisonId.substring(0, comparisonId.length - 37);

    if (!pairKeyPrefix) {
      return errorResponse(
        { code: "invalid_request", message: "Invalid comparisonId format" },
        400
      );
    }

    // Get stable DO instance for this pairKeyPrefix
    const doId = env.ENVPAIR_DO.idFromName(pairKeyPrefix);
    const stub = env.ENVPAIR_DO.get(doId);

    // Fetch authoritative state from DO (fresh every request, no caching)
    const state = await (stub as any).getComparison(comparisonId);

    if (!state) {
      return errorResponse(
        { code: "invalid_request", message: "Comparison not found" },
        404
      );
    }

    return jsonResponse(state, { status: 200 });
  } catch (err) {
    return errorResponse(
      { code: "internal_error", message: `Failed to poll comparison: ${String(err)}` },
      500
    );
  }
}
