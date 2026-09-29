// POST /api/ugc/renders — start a UGC video render. Price, allowance and
// model capabilities are decided server-side; the client sends only choices
// and a per-click idempotency key (a double submit returns the same render).
import { StartRenderBody } from "@/lib/ugc/schemas";
import { defineRoute } from "@/server/route";
import { assertUgcEnabled } from "@/server/ugc/route-helpers";
import {
  activateUgcRender,
  cancelRender,
  kickRender,
  startRender,
} from "@/server/ugc/service.server";
import { getEntitlements } from "@/server/billing/entitlements.server";
import { ugcBillingColumnReady } from "@/server/billing/schema.server";
import { assertWithinLimit } from "@/server/billing/limits.server";
import { BrandFrozenError, UpgradeRequiredError } from "@/server/billing/errors";
import { beginDeferredMetered } from "@/server/billing/metered.server";
import { saveUgcBillingLink } from "@/server/billing/ugc-async.server";
import {
  videoFeatureFor,
  videoUnitsFor,
  type UgcModelKey,
  type VideoResolution,
} from "@/lib/billing/catalog";
import { isUgcModelKey } from "@/lib/ugc/models";
import { HttpError } from "@/server/http-error";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = defineRoute({
  name: "ugc/renders:create",
  auth: "workspace",
  minRole: "editor",
  body: StartRenderBody,
  workspaceId: ({ body }) => body.workspaceId,
  rateLimit: "ugc-render",
  handler: async ({ body, workspaceId, userId, role, supabase }) => {
    assertUgcEnabled(workspaceId);
    const entitlements = await getEntitlements({ workspaceId, userId, role });
    if (entitlements.enforcement === "on") {
      if (!(await ugcBillingColumnReady()))
        throw new HttpError(503, "Video billing is being set up. Please try again later.");
      if (entitlements.frozen) throw new BrandFrozenError();
      if (!entitlements.features.ugc.allowed) {
        throw new UpgradeRequiredError({
          feature: "ugc",
          requiredPlan: entitlements.features.ugc.requiredPlan,
          currentPlan: entitlements.entitledPlan,
        });
      }
      assertWithinLimit(entitlements, "renders");
    }
    const { render, created } = await startRender(
      supabase,
      {
        workspaceId,
        userId,
        projectId: body.projectId,
        idempotencyKey: body.idempotencyKey,
        model: body.model,
        durationSec: body.durationSec,
        aspectRatio: body.aspectRatio,
        resolution: body.resolution,
        referenceAssetIds: body.referenceAssetIds,
      },
      { deferKick: true },
    );
    if (!created) return Response.json({ render, created }, { status: 200 });
    if (!isUgcModelKey(render.model)) {
      await cancelRender(supabase, workspaceId, render.id);
      throw new HttpError(500, "Could not price this video model.");
    }
    const model = render.model as UgcModelKey;
    const resolution = render.resolution as VideoResolution;
    const units = videoUnitsFor({
      ugcKey: model,
      seconds: render.durationSec,
      resolution,
      providerCostUsd: render.estCostUsd,
    });
    const feature = videoFeatureFor(model, resolution);
    let charge;
    try {
      charge = await beginDeferredMetered({
        workspaceId,
        userId,
        role,
        actionName: `video_${model}`,
        meter: "video",
        amount: units,
        feature,
        idempotencyKey: body.idempotencyKey,
        route: "ugc/renders:create",
        expiresAt: new Date(Date.now() + 3 * 60 * 60_000).toISOString(),
      });
    } catch (error) {
      await cancelRender(supabase, workspaceId, render.id);
      throw error;
    }
    try {
      if (charge.mode !== "off")
        await saveUgcBillingLink({
          render_id: render.id,
          account_id: charge.accountId,
          workspace_id: workspaceId,
          hold_id: charge.holdId,
          charge_id: charge.chargeId,
          charge_key: `${userId}:video_${model}:${body.idempotencyKey}`,
          action: `video_${model}`,
          units,
          mode: charge.mode,
          shadow_decision: charge.shadowDecision,
        });
      await activateUgcRender(render.id);
    } catch (error) {
      await cancelRender(supabase, workspaceId, render.id).catch(() => {});
      await charge.release().catch(() => {});
      throw error;
    }
    kickRender(render.id);
    return Response.json({ render, created, videoUnits: units }, { status: 201 });
  },
});
