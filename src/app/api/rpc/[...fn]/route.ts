import { resolveServerFn } from "@/server/fns";
import { runWithRequest, setRequestScope } from "@/server/request-context";
import { knownErrorResponse } from "@/server/route";

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
    const result = await runWithRequest(request, () => {
      setRequestScope({ route: `${moduleName}/${fnName}` });
      return serverFn.invoke(data, request.signal);
    });
    return json(200, { result: result ?? null });
  } catch (error) {
    // Auth failures → 401 (the client prompts a re-login), ZodError → 400,
    // provider errors → their own status. Same mapping as the /api kernel.
    const known = knownErrorResponse(error);
    if (known) return known;
    console.error(`[rpc] ${moduleName}/${fnName}`, error);
    // Handlers throw user-facing messages ("Workspace not found"), so the
    // message is passed through rather than replaced with a generic one.
    return json(500, { error: error instanceof Error ? error.message : "Request failed" });
  }
}
