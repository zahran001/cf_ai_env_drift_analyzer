import type { Env } from "../env";
import type { CfContextSnapshot } from "@shared/signal";
import { computePairKeySHA256 } from "../utils/pairKey";
import { validateProbeUrl } from "./validate";

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

  // Health check endpoint
  if (request.method === "GET" && url.pathname === "/api/health") {
    return Response.json({ ok: true });
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

  // DEPRECATED: /api/probe endpoint removed for security (SSRF vector)
  // This was a temporary test endpoint that bypassed URL validation.
  // Per CLAUDE.md section 9.1, all probing must go through Workflow with proper validation.
  // Direct probe calls must never be exposed in production.
  // See PHASE_B4_IMPLEMENTATION_FINAL.md for details.
  /*
  if (request.method === "GET" && url.pathname === "/api/probe") {
    const targetUrl = url.searchParams.get("url");
    ...
  }
  */

  return new Response("Not found", { status: 404 });
}

/**
 * POST /api/compare - Start comparison workflow.
 *
 * Request: { leftUrl: string, rightUrl: string }
 * Response: { comparisonId: string } (status 202 Accepted)
 *
 * Steps:
 * 1. Validate URLs (format, scheme, IP ranges)
 * 2. Compute pairKey (SHA-256 hash of sorted URLs)
 * 3. Generate comparisonId = ${pairKey}:${uuid} (stable routing)
 * 4. Start Workflow with stable inputs
 * 5. Return immediately with comparisonId for polling
 */
async function handlePostCompare(request: Request, env: Env): Promise<Response> {
  try {
    console.log(`[Worker] POST /api/compare received`);
    const body = (await request.json()) as { leftUrl?: string; rightUrl?: string };
    const { leftUrl, rightUrl } = body;
    console.log(`[Worker] Parsed URLs: left="${leftUrl}", right="${rightUrl}"`);

    // Validate inputs
    if (!leftUrl || !rightUrl) {
      console.log(`[Worker] ERROR: Missing leftUrl or rightUrl`);
      return Response.json(
        { error: "Missing leftUrl or rightUrl" },
        { status: 400 }
      );
    }

    // Validate URLs (SSRF protection)
    console.log(`[Worker] Validating leftUrl...`);
    const leftValidation = validateProbeUrl(leftUrl);
    if (!leftValidation.valid) {
      console.log(`[Worker] ERROR: Invalid leftUrl: ${leftValidation.reason}`);
      return Response.json(
        { error: `Invalid leftUrl: ${leftValidation.reason}` },
        { status: 400 }
      );
    }

    console.log(`[Worker] Validating rightUrl...`);
    const rightValidation = validateProbeUrl(rightUrl);
    if (!rightValidation.valid) {
      console.log(`[Worker] ERROR: Invalid rightUrl: ${rightValidation.reason}`);
      return Response.json(
        { error: `Invalid rightUrl: ${rightValidation.reason}` },
        { status: 400 }
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
    // Full SHA-256 (64 chars) would exceed: 64 + 1 + 36 = 101 chars ✗
    const pairKeyPrefix = pairKey.substring(0, 40);
    const uuid = crypto.randomUUID();
    const comparisonId = `${pairKeyPrefix}-${uuid}`;
    console.log(`[Worker] pairKeyPrefix: ${pairKeyPrefix}`);
    console.log(`[Worker] comparisonId generated: ${comparisonId}`);

    // Extract runner context for LLM awareness (geographical/network info)
    const runnerContext = extractRunnerContext(request);
    console.log(`[Worker] runnerContext extracted: colo=${runnerContext.colo}, country=${runnerContext.country}`);

    // Start Workflow with stable inputs
    // Per CLAUDE.md 4.2: Worker validates input, computes pairKey,
    // encodes pairKey in comparisonId, starts Workflow, returns immediately
    console.log(`[Worker] About to call env.COMPARE_WORKFLOW.create() with comparisonId=${comparisonId}`);
    console.log(`[Worker] Workflow binding type:`, typeof env.COMPARE_WORKFLOW);
    console.log(`[Worker] Workflow binding methods:`, Object.keys(env.COMPARE_WORKFLOW || {}).join(", "));

    const workflowHandle = await env.COMPARE_WORKFLOW.create({
      id: comparisonId,
      params: {
        comparisonId,
        leftUrl,
        rightUrl,
        pairKey: pairKeyPrefix, // Use prefix for DO routing (matches comparisonId format)
        runnerContext,
      },
    });

    console.log(`[Worker] Workflow created successfully`);
    console.log(`[Worker] Workflow handle:`, workflowHandle);

    console.log(`[Worker] Started workflow ${comparisonId} for ${leftUrl} <-> ${rightUrl}`);

    return Response.json(
      { comparisonId },
      { status: 202 } // Accepted; processing in background
    );
  } catch (err) {
    console.error(`[Worker] CAUGHT ERROR:`, err);
    console.error(`[Worker] Error type:`, typeof err);
    console.error(`[Worker] Error message:`, String(err));
    if (err instanceof Error) {
      console.error(`[Worker] Error stack:`, err.stack);
    }
    return Response.json(
      { error: `Failed to start comparison: ${String(err)}` },
      { status: 500 }
    );
  }
}

/**
 * GET /api/compare/:comparisonId - Poll comparison status.
 *
 * Response:
 * - 200 + { status: "running" } — Still processing
 * - 200 + { status: "completed", result: {...} } — Done, with result
 * - 200 + { status: "failed", error: "..." } — Failed with error
 * - 404 + { error: "Comparison not found" } — Invalid ID or expired
 * - 500 + { error: "..." } — Server error
 *
 * Per CLAUDE.md section 4.4:
 * 1. Extract pairKey from comparisonId prefix (before `:`)
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
    // So we extract everything except the last 37 characters (hyphen + UUID)
    const pairKeyPrefix = comparisonId.substring(0, comparisonId.length - 37);

    if (!pairKeyPrefix) {
      return Response.json(
        { error: "Invalid comparisonId format" },
        { status: 400 }
      );
    }

    // Get stable DO instance for this pairKeyPrefix
    // idFromName ensures same DO is used for same URL pair (via prefix)
    const doId = env.ENVPAIR_DO.idFromName(pairKeyPrefix);
    const stub = env.ENVPAIR_DO.get(doId);

    // ✅ CORRECT: Call DO method via RPC (enabled in wrangler.toml)
    // Fetch authoritative state from DO
    // Worker does NOT cache this; fresh fetch every request
    // Type assertion: with rpc=true in wrangler.toml, stub methods are available
    const state = await (stub as any).getComparison(comparisonId);

    // ✅ CORRECT: Return 404 if comparison not found
    if (!state) {
      return Response.json(
        { error: "Comparison not found", comparisonId },
        { status: 404 }
      );
    }

    return Response.json(state, { status: 200 });
  } catch (err) {
    return Response.json(
      { error: `Failed to poll comparison: ${String(err)}` },
      { status: 500 }
    );
  }
}
