// GET /api/ugc/renders/:id/download — a short-lived signed download link for
// the stored video (members only).
import { WorkspaceQuery } from "@/lib/ugc/schemas";
import { defineRoute } from "@/server/route";
import { idAfter } from "@/server/ugc/route-helpers";
import { renderDownload } from "@/server/ugc/service.server";

export const dynamic = "force-dynamic";

export const GET = defineRoute({
  name: "ugc/renders:download",
  auth: "workspace",
  query: WorkspaceQuery,
  workspaceId: ({ query }) => query.workspaceId,
  handler: async ({ request, workspaceId, supabase }) =>
    renderDownload(supabase, workspaceId, idAfter(request, "renders")),
});
