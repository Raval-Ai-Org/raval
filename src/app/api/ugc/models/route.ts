// GET /api/ugc/models?workspaceId= — the video models this deployment offers
// (only capabilities each model really supports) plus the workspace's video
// allowance, so the studio can show the video balance before generation.
import { WorkspaceQuery } from "@/lib/ugc/schemas";
import { defineRoute } from "@/server/route";
import { toModelView } from "@/server/ugc/models.server";
import { assertUgcEnabled } from "@/server/ugc/route-helpers";
import { getAllowance, modelCatalog } from "@/server/ugc/service.server";
import { getEntitlements } from "@/server/billing/entitlements.server";
import { videoFeatureFor, type UgcModelKey } from "@/lib/billing/catalog";

export const dynamic = "force-dynamic";

export const GET = defineRoute({
  name: "ugc/models",
  auth: "workspace",
  query: WorkspaceQuery,
  workspaceId: ({ query }) => query.workspaceId,
  handler: async ({ workspaceId, userId, role }) => {
    assertUgcEnabled(workspaceId);
    const { models, defaultModel } = modelCatalog();
    const entitlements = await getEntitlements({ workspaceId, userId, role });
    const available = models.filter(
      (model) =>
        entitlements.enforcement !== "on" ||
        entitlements.features[videoFeatureFor(model.key as UgcModelKey, model.defaultResolution)]
          .allowed,
    );
    return {
      models: available.map(toModelView),
      defaultModel: available.some((model) => model.key === defaultModel)
        ? defaultModel
        : (available[0]?.key ?? defaultModel),
      allowance: await getAllowance(workspaceId),
    };
  },
});
