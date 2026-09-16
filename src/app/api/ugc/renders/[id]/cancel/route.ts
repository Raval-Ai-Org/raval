// POST /api/ugc/renders/:id/cancel — cancel a render that hasn't started
// rendering yet; its allowance hold is released.
import { WorkspaceQuery } from "@/lib/ugc/schemas";
import { defineRoute } from "@/server/route";
import { idAfter } from "@/server/ugc/route-helpers";
import { cancelRender } from "@/server/ugc/service.server";

export const dynamic = "force-dynamic";

export const POST = defineRoute({
  name: "ugc/renders:cancel",
  auth: "workspace",
  minRole: "editor",
  body: WorkspaceQuery,
  workspaceId: ({ body }) => body.workspaceId,
  handler: async ({ request, workspaceId, supabase }) => ({
    render: await cancelRender(supabase, workspaceId, idAfter(request, "renders")),
  }),
});
