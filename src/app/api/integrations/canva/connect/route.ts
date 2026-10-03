import { requireUserId, checkWorkspaceMembership } from "@/server/api-auth";
import { startCanvaOAuth } from "@/server/connectors/canva/oauth.server";
import { safeReturnPath } from "@/server/connectors/return-url";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await requireUserId(request);
  if (!auth.ok) return auth.response;
  const params = new URL(request.url).searchParams;
  const workspace = await checkWorkspaceMembership(auth, params.get("workspaceId"), {
    minRole: "editor",
  });
  if (!workspace.ok) return workspace.response;
  try {
    const url = await startCanvaOAuth({
      userId: auth.userId,
      workspaceId: workspace.workspaceId,
      returnPath: safeReturnPath(params.get("returnPath")),
    });
    return new Response(null, {
      status: 302,
      headers: { location: url, "cache-control": "no-store", "referrer-policy": "no-referrer" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Canva connection could not start." }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
}
