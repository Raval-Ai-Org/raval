// POST /api/ugc/renders/:id/post-draft — create (once) a draft post carrying
// the finished video and its caption, ready for Mellox's publishing flow.
import { WorkspaceQuery } from "@/lib/ugc/schemas";
import { defineRoute } from "@/server/route";
import { idAfter } from "@/server/ugc/route-helpers";
import { createPostDraft } from "@/server/ugc/service.server";

export const dynamic = "force-dynamic";

export const POST = defineRoute({
  name: "ugc/renders:post-draft",
  auth: "workspace",
  minRole: "editor",
  body: WorkspaceQuery,
  workspaceId: ({ body }) => body.workspaceId,
  rateLimit: "generate",
  handler: async ({ request, workspaceId, userId, supabase }) =>
    createPostDraft(supabase, workspaceId, idAfter(request, "renders"), userId),
});
