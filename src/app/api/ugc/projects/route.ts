// /api/ugc/projects — list a workspace's UGC ads, or create one from a product.
import { CreateProjectBody, WorkspaceQuery } from "@/lib/ugc/schemas";
import { defineRoute } from "@/server/route";
import { assertUgcEnabled } from "@/server/ugc/route-helpers";
import { createProject, listProjects } from "@/server/ugc/service.server";

export const dynamic = "force-dynamic";

export const GET = defineRoute({
  name: "ugc/projects:list",
  auth: "workspace",
  query: WorkspaceQuery,
  workspaceId: ({ query }) => query.workspaceId,
  handler: async ({ workspaceId, supabase }) => ({
    projects: await listProjects(supabase, workspaceId),
  }),
});

export const POST = defineRoute({
  name: "ugc/projects:create",
  auth: "workspace",
  minRole: "editor",
  body: CreateProjectBody,
  workspaceId: ({ body }) => body.workspaceId,
  rateLimit: "generate",
  handler: async ({ body, workspaceId, userId, supabase }) => {
    assertUgcEnabled(workspaceId);
    return {
      project: await createProject(supabase, {
        workspaceId,
        userId,
        title: body.title,
        product: body.product,
        brief: body.brief,
        referenceAssetIds: body.referenceAssetIds,
      }),
    };
  },
});
