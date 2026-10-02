// A Studio job, charged. The one place that pairs `createStudioJob` with its
// credit or video hold, shared by the jobs route (a person pressing Generate)
// and Autopilot (the worker, acting as a stored member). Same price either way.
import "server-only";
import { studioChargeFor } from "@/lib/studio/billing";
import type { CreateJobInput, StudioJob } from "@/lib/studio/jobs";
import { STUDIO_FORMATS } from "@/lib/studio/formats";
import { createStudioJob } from "@/server/studio/runner.server";
import {
  beginDeferredMetered,
  runMetered,
  type MeteredAction,
} from "@/server/billing/metered.server";
import {
  CREDIT_ACTIONS,
  STUDIO_VIDEO_UNITS,
  creditsFor,
  type CreditAction,
} from "@/lib/billing/catalog";
import { saveStudioBillingLink } from "@/server/billing/studio-async.server";
import { runWithScope } from "@/server/request-context";
import type { WorkspaceRole } from "@/server/api-auth";

const BILLING_ROUTE: Record<CreateJobInput["type"], string> = {
  social: "studio.social",
  image: "studio.captions",
  carousel: "studio.carousel",
  video: "video",
  article: "studio.article",
  script: "studio.script",
  ad: "studio.ad",
};

/** Whether this request starts an image or video render (charged when it finishes). */
export function studioJobRenders(input: Pick<CreateJobInput, "type" | "controls">): boolean {
  const media = STUDIO_FORMATS[input.type].media;
  return (
    media === "video" ||
    media === "image" ||
    (media === "optional-image" && Boolean(input.controls.includeImage))
  );
}

export type BilledStudioJob = {
  job: StudioJob;
  /** Wallet balance after a synchronous charge; null when nothing was debited yet. */
  balance: number | null;
  /** What the job is priced at: credits, or video units for a video. */
  charge: { meter: "credits" | "video"; amount: number };
};

export async function createBilledStudioJob(args: {
  /** The RLS client for a person's request, or the service client for a worker. */
  client: unknown;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  input: CreateJobInput;
}): Promise<BilledStudioJob> {
  const { client, workspaceId, userId, role, input } = args;
  const action: MeteredAction = studioChargeFor({
    type: input.type,
    includeImage: input.controls.includeImage,
    length: input.controls.length,
    regenerate: Boolean(input.regenerate || input.parentJobId),
  });
  const billingRoute = BILLING_ROUTE[input.type];
  const video = action === "studio_video";
  const amount = video ? STUDIO_VIDEO_UNITS : creditsFor(action as CreditAction);
  const price = { meter: video ? ("video" as const) : ("credits" as const), amount };

  if (studioJobRenders(input)) {
    const charge = await beginDeferredMetered({
      workspaceId,
      userId,
      role,
      actionName: action as string,
      meter: price.meter,
      amount,
      feature: video ? "ugc" : CREDIT_ACTIONS[action as CreditAction].feature,
      idempotencyKey: input.idempotencyKey,
      route: billingRoute,
      expiresAt: new Date(Date.now() + 3 * 60 * 60_000).toISOString(),
    });
    let job: StudioJob;
    try {
      job = await runWithScope(
        { billingAccountId: charge.accountId, billingChargeId: charge.chargeId ?? undefined },
        () =>
          createStudioJob({
            client,
            workspaceId,
            userId,
            input,
            onCreated: async (created) =>
              charge.mode === "off"
                ? undefined
                : saveStudioBillingLink({
                    job_id: created.id,
                    account_id: charge.accountId,
                    workspace_id: workspaceId,
                    hold_id: charge.holdId,
                    charge_id: charge.chargeId,
                    charge_key: `${userId}:${action}:${input.idempotencyKey}`,
                    action: action as string,
                    meter: price.meter,
                    amount,
                    route: billingRoute,
                    mode: charge.mode,
                    shadow_decision: charge.shadowDecision,
                  }),
          }),
      );
    } catch (error) {
      await charge.release();
      throw error;
    }
    if (job.status === "succeeded") {
      await charge.capture();
    } else if (job.status !== "running" && job.status !== "queued") {
      await charge.release();
    }
    return { job, balance: null, charge: price };
  }

  const metered = await runMetered(
    {
      workspaceId,
      userId,
      role,
      action,
      idempotencyKey: input.idempotencyKey,
      route: billingRoute,
    },
    async (charge) => {
      const job = await createStudioJob({ client, workspaceId, userId, input });
      if (job.status !== "succeeded") charge.setCapturedAmount(0);
      return job;
    },
  );
  return { job: metered.result, balance: metered.balance, charge: price };
}
