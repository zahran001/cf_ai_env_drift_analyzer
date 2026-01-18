import type { Env } from "../env";
import { computePairKeySHA256 } from "../utils/pairKey";
import { validateProbeUrl } from "./validate";

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
    const body = (await request.json()) as { leftUrl?: string; rightUrl?: string };
    const { leftUrl, rightUrl } = body;

    // Validate inputs
    if (!leftUrl || !rightUrl) {
      return Response.json(
        { error: "Missing leftUrl or rightUrl" },
        { status: 400 }
      );
    }

    // Validate URLs (SSRF protection)
    const leftValidation = validateProbeUrl(leftUrl);
    if (!leftValidation.valid) {
      return Response.json(
        { error: `Invalid leftUrl: ${leftValidation.reason}` },
        { status: 400 }
      );
    }

    const rightValidation = validateProbeUrl(rightUrl);
    if (!rightValidation.valid) {
      return Response.json(
        { error: `Invalid rightUrl: ${rightValidation.reason}` },
        { status: 400 }
      );
    }

    // Compute pairKey using SHA-256
    const pairKey = await computePairKeySHA256(leftUrl, rightUrl);

    // Generate stable comparisonId
    const uuid = crypto.randomUUID();
    const comparisonId = `${pairKey}:${uuid}`;

    // TODO: Start Workflow
    // const handle = await env.COMPARE_WORKFLOW.create({
    //   id: comparisonId,
    //   params: { comparisonId, leftUrl, rightUrl, pairKey },
    // });

    // Note: env is used by TODO Workflow initialization above
    void env;

    return Response.json(
      { comparisonId },
      { status: 202 } // Accepted; processing in background
    );
  } catch (err) {
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
    // Extract pairKey from comparisonId format: ${pairKey}:${uuid}
    const pairKey = comparisonId.split(":")[0];

    if (!pairKey) {
      return Response.json(
        { error: "Invalid comparisonId format" },
        { status: 400 }
      );
    }

    // Get stable DO instance for this pairKey
    // idFromName ensures same DO is used for same URL pair
    const doId = env.ENVPAIR_DO.idFromName(pairKey);
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
