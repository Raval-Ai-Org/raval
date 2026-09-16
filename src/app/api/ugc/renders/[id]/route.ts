// GET /api/ugc/renders/:id — render status. A due render nobody is working on
// is advanced once during the read, so progress never depends on cron alone.
import { WorkspaceQuery } from "@/lib/ugc/schemas";
import { defineRoute } from "@/server/route";
import { idAfter } from "@/server/ugc/route-helpers";
import { getRenderView } from "@/server/ugc/service.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = defineRoute({
  name: "ugc/renders:get",
  auth: "workspace",
  query: WorkspaceQuery,
  workspaceId: ({ query }) => query.workspaceId,
  handler: async ({ request, workspaceId, supabase }) => ({
    render: await getRenderView(supabase, workspaceId, idAfter(request, "renders")),
  }),
});
