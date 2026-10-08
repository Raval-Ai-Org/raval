import { resolveServerFn } from "@/server/fns";
import { getRequestScope, runWithRequest, setRequestScope } from "@/server/request-context";
import { knownErrorResponse } from "@/server/route";
import { readJsonBody, RequestBodyTooLargeError } from "@/server/request-body";

export const dynamic = "force-dynamic";

function json(status: number, body: unknown, extra?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    // Results are per user and often carry balances: never cache them.
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extra },
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
    data = ((await readJsonBody(request)) as { data?: unknown } | null)?.data ?? null;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return json(413, { error: error.message });
    return json(400, { error: "Invalid request body" });
  }

  try {
    const { result, billingChanged } = await runWithRequest(request, async () => {
      setRequestScope({ route: `${moduleName}/${fnName}` });
      const value = await serverFn.invoke(data, request.signal);
      return { result: value, billingChanged: getRequestScope().billingChanged === true };
    });
    // The wallet moved (a charge or a refund): the browser refreshes its balance.
    return json(
      200,
      { result: result ?? null },
      billingChanged ? { "x-billing-changed": "1" } : undefined,
    );
  } catch (error) {
    // Auth failures → 401 (the client prompts a re-login), ZodError → 400,
    // provider errors → their own status. Same mapping as the /api kernel.
    const known = knownErrorResponse(error);
    if (known) return known;
    console.error(`[rpc] ${moduleName}/${fnName}`, error);
    return json(500, { error: "Request failed" });
  }
}
