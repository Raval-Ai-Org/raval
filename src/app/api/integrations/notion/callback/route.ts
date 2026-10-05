import { completeNotionOAuth } from "@/server/connectors/notion/service.server";
import { workspacePath } from "@/lib/workspace/paths";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const state = query.get("state") ?? "";
  const code = query.get("code") ?? "";
  if (query.has("error") || !state || !code || state.length > 128 || code.length > 2048)
    return Response.redirect(
      new URL("/integrations/notion/result?status=cancelled", request.url),
      302,
    );
  try {
    const result = await completeNotionOAuth({ state, code });
    const target = workspacePath(result.workspaceId, "", {
      settings: "accounts",
      notion: "connected",
    });
    return new Response(null, {
      status: 302,
      headers: { Location: target, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  } catch {
    return Response.redirect(
      new URL("/integrations/notion/result?status=failed", request.url),
      302,
    );
  }
}
