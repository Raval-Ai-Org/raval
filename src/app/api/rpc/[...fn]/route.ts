import { resolveServerFn } from "@/server/fns";
import { runWithRequest } from "@/server/request-context";

export const dynamic = "force-dynamic";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Single transport for every server function. The browser stub posts
 * `{ data }` to /api/rpc/<module>/<name> with the Supabase bearer token; the
 * function's own middleware (requireSupabaseAuth) validates it and builds the
 * request-scoped Supabase client.
 */
export async function POST(request: Request, ctx: { params: Promise<{ fn: string[] }> }) {
  const { fn } = await ctx.params;
  const [moduleName, fnName, ...rest] = fn ?? [];

  if (!moduleName || !fnName || rest.length) {
    return json(404, { error: "Unknown server function" });
  }

  const serverFn = resolveServerFn(moduleName, fnName);
  if (!serverFn) {
    return json(404, { error: "Unknown server function" });
  }

  let data: unknown = null;
  try {
    const body = await request.text();
    data = body ? (JSON.parse(body)?.data ?? null) : null;
  } catch {
    return json(400, { error: "Invalid request body" });
  }

  try {
    const result = await runWithRequest(request, () => serverFn.invoke(data, request.signal));
    return json(200, { result: result ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    // Auth failures surface as 401 so the client can prompt a re-login; the
    // validators throw ZodError for bad input, which is a 400.
    if (/^Unauthorized/i.test(message)) return json(401, { error: message });
    if (error instanceof Error && error.name === "ZodError") {
      return json(400, { error: "Invalid request" });
    }
    console.error(`[rpc] ${moduleName}/${fnName}`, error);
    return json(500, { error: message });
  }
}
