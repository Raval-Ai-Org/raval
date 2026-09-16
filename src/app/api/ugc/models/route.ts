// GET /api/ugc/models?workspaceId= — the video models this deployment offers
// (only capabilities each model really supports) plus the workspace's video
// allowance, so the studio can show a cost estimate before anyone generates.
import { WorkspaceQuery } from "@/lib/ugc/schemas";
import { defineRoute } from "@/server/route";
import { toModelView } from "@/server/ugc/models.server";
import { assertUgcEnabled } from "@/server/ugc/route-helpers";
import { getAllowance, modelCatalog } from "@/server/ugc/service.server";

export const dynamic = "force-dynamic";

export const GET = defineRoute({
  name: "ugc/models",
  auth: "workspace",
  query: WorkspaceQuery,
  workspaceId: ({ query }) => query.workspaceId,
  handler: async ({ workspaceId }) => {
    assertUgcEnabled(workspaceId);
    const { models, defaultModel } = modelCatalog();
    return {
      models: models.map(toModelView),
      defaultModel,
      allowance: await getAllowance(workspaceId),
    };
  },
});
