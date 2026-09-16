// POST /api/ugc/renders — start a UGC video render. Price, allowance and
// model capabilities are decided server-side; the client sends only choices
// and a per-click idempotency key (a double submit returns the same render).
import { StartRenderBody } from "@/lib/ugc/schemas";
import { defineRoute } from "@/server/route";
import { assertUgcEnabled } from "@/server/ugc/route-helpers";
import { startRender } from "@/server/ugc/service.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = defineRoute({
  name: "ugc/renders:create",
  auth: "workspace",
  minRole: "editor",
  body: StartRenderBody,
  workspaceId: ({ body }) => body.workspaceId,
  rateLimit: "ugc-render",
  handler: async ({ body, workspaceId, userId, supabase }) => {
    assertUgcEnabled(workspaceId);
    const { render, created } = await startRender(supabase, {
      workspaceId,
      userId,
      projectId: body.projectId,
      idempotencyKey: body.idempotencyKey,
      model: body.model,
      durationSec: body.durationSec,
      aspectRatio: body.aspectRatio,
      resolution: body.resolution,
      referenceAssetIds: body.referenceAssetIds,
    });
    return Response.json({ render, created }, { status: created ? 201 : 200 });
  },
});
