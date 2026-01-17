import { activeProbeProvider } from "../providers/activeProbe";
import type { ProviderRunnerContext } from "../providers/types";
import type { Env } from "../env";

export async function router(request: Request, env: Env): Promise<Response> {
  void env; // Will be used by route handlers in Step 7+
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/api/health") {
    return Response.json({ ok: true });
  }

  // Temporary test endpoint for active probe
  // GET /api/probe?url=https://example.com
  if (request.method === "GET" && url.pathname === "/api/probe") {
    const targetUrl = url.searchParams.get("url");

    if (!targetUrl) {
      return Response.json(
        { error: "Missing 'url' query parameter" },
        { status: 400 }
      );
    }

    try {
      // Extract runner context from Cloudflare request context
      const cfContext: ProviderRunnerContext = {
        colo: (request as any).cf?.colo,
        country: (request as any).cf?.country,
        asn: (request as any).cf?.asn,
      };

      // Execute probe
      const envelope = await activeProbeProvider.probe(targetUrl, cfContext);

      return Response.json(envelope, {
        status: envelope.result.ok ? 200 : 400,
        headers: { "content-type": "application/json" },
      });
    } catch (err) {
      return Response.json(
        { error: `Probe execution failed: ${String(err)}` },
        { status: 500 }
      );
    }
  }

  return new Response("Not found", { status: 404 });
}
