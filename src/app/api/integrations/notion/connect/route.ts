import { requireUserId, checkWorkspaceMembership } from "@/server/api-auth";
import { startNotionOAuth } from "@/server/connectors/notion/oauth.server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await requireUserId(request);
  if (!auth.ok) return auth.response;
  const workspace = await checkWorkspaceMembership(
    auth,
    new URL(request.url).searchParams.get("workspaceId"),
    { minRole: "editor" },
  );
  if (!workspace.ok) return workspace.response;
  try {
    const url = await startNotionOAuth(auth.userId, workspace.workspaceId);
    return new Response(null, {
      status: 302,
      headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  } catch {
    return Response.json({ error: "Notion connection could not start." }, { status: 503 });
  }
}
