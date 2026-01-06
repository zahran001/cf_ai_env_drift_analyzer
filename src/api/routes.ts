export async function router(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/api/health") {
    return Response.json({ ok: true });
  }

  return new Response("Not found", { status: 404 });
}
