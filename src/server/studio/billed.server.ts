// A Studio job, charged. The one place that pairs `createStudioJob` with its
// credit or video hold, shared by the jobs route (a person pressing Generate)
// and Autopilot (the worker, acting as a stored member). Same price either way.
import "server-only";
import {
  studioChargeFor,
  studioJobRenders,
  studioTextOnlyRevision,
  type StudioCharge,
} from "@/lib/studio/billing";
import { isVariationsRequest, variationCount } from "@/lib/studio/variations";
import { studioVideoUnits } from "@/lib/ugc/duration";
import type { CreateJobInput, StudioJob } from "@/lib/studio/jobs";
import { createStudioJob } from "@/server/studio/runner.server";
import { beginDeferredMetered } from "@/server/billing/metered.server";
import {
  CREDIT_ACTIONS,
  creditsFor,
  videoFeatureFor,
  type CreditAction,
} from "@/lib/billing/catalog";
import { saveStudioBillingLink, settleStudioBilling } from "@/server/billing/studio-async.server";
import { runWithScope } from "@/server/request-context";
import type { WorkspaceRole } from "@/server/api-auth";
import { VIDEO_BILLING_HOLD_MS } from "@/lib/ugc/duration";
import { resolveStudioClips, resolveStudioReferences } from "./references.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { creationPointsFor, isCaptionRevision } from "@/lib/billing/creation";
import { getEntitlements } from "@/server/billing/entitlements.server";
import { requireBillingFeature } from "@/server/billing/feature.server";
import {
  captionEditsRemaining,
  linkCaptionEdit,
  reserveCaptionEdit,
  settleCaptionEdit,
} from "@/server/billing/creation.server";
import { HttpError } from "@/server/http-error";
import { quoteStudioVideo, shortClipCreditsForRecap } from "./video-quote.server";
import { shortClipPlan } from "@/lib/studio/short-clip";
import { resolvePhotoMode } from "@/lib/studio/photo-design/mode";
import { isClipEditEnabled, isPhotoDesignEnabled, isProductHeroEnabled } from "@/lib/feature-flags";
import { RECAP_AI_SECONDS } from "@/lib/studio/clip-edit";
import { pickFeaturedProduct, productPhotoControls } from "@/lib/products/feature";
import { settleVideoControls } from "@/lib/studio/video/settle";

const BILLING_ROUTE: Record<CreateJobInput["type"], string> = {
  social: "studio.social",
  image: "studio.captions",
  carousel: "studio.carousel",
  story: "studio.story",
  video: "video",
  article: "studio.article",
  script: "studio.script",
  ad: "studio.ad",
};

export { studioJobRenders } from "@/lib/studio/billing";

export type BilledStudioJob = {
  job: StudioJob;
  /** Refreshed from the wallet so held and spent credits stay distinct. */
  balance: number | null;
  /** What the job is priced at: credits, or video units for a video. */
  charge: { meter: "credits" | "video" | "creation"; amount: number };
};

export async function createBilledStudioJob(args: {
  /** The RLS client for a person's request, or the service client for a worker. */
  client: unknown;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  input: CreateJobInput;
  /**
   * Which product to pick when none was chosen: one the brief names
   * (default, what Studio shows a person before they press Generate), or,
   * for a worker acting without a person, also one for a selling brief.
   */
  autoProduct?: "named" | "any";
}): Promise<BilledStudioJob> {
  const { client, workspaceId, userId, role, input } = args;
  // A piece about a catalogue product (ADR-0035) must name one of this
  // workspace's products, and is made with that product's own photos unless
  // the person chose photos themselves. A product the brief names is picked
  // for the person too; a worker also features one for a selling brief that
  // names none (src/lib/products/feature.ts). Decided here, before pricing, so
  // the charge matches what runs.
  // An edit keeps what its piece had; "Generate again" is a new take and is
  // made the same way as the first one.
  const revision = Boolean(input.refine) || studioTextOnlyRevision(input);
  if (!input.controls.productId && !input.controls.noProduct && !revision) {
    const picked = await autoPickProduct(workspaceId, input, args.autoProduct ?? "named");
    if (picked) input.controls.productId = picked;
  }
  // Set when the product's own main photo was just chosen for a hero.
  let heroFromProduct = false;
  if (input.controls.productId) {
    const { productForGeneration } = await import("@/server/products/service.server");
    const product = await productForGeneration(workspaceId, input.controls.productId);
    if (!product) throw new HttpError(400, "That product is no longer in this workspace.");
    const photos = productPhotoControls({
      type: input.type,
      controls: input.controls,
      photoIds: product.kind === "product" ? product.photoAssetIds : [],
      revision,
      designEnabled: isPhotoDesignEnabled(workspaceId),
      heroEnabled: isProductHeroEnabled(workspaceId),
    });
    if (photos) {
      input.controls.referenceAssetIds = photos.referenceAssetIds;
      input.controls.referenceMode = photos.referenceMode;
      if (photos.referenceMode === "design") input.controls.photoFidelity = "exact";
      heroFromProduct = photos.referenceMode === "hero";
    }
  }
  // A product hero is only ever made from the picked product's own photo
  // (ADR-0040): anything else asking for it designs around the photos.
  if (input.controls.referenceMode === "hero" && !heroFromProduct) {
    const own =
      input.controls.productId && isProductHeroEnabled(workspaceId)
        ? await import("@/server/products/service.server").then(({ productForGeneration }) =>
            productForGeneration(workspaceId, input.controls.productId!),
          )
        : null;
    const ids = input.controls.referenceAssetIds ?? [];
    if (!own || own.kind !== "product" || ids.length !== 1 || !own.photoAssetIds.includes(ids[0])) {
      input.controls.referenceMode = "design";
      input.controls.photoFidelity = "exact";
    }
  }
  // "Post as is" with words or design asked for, a picture edit or more
  // versions designs with the photo instead; decided here so the price
  // matches what runs. Designing can be switched off per workspace.
  const photoMode = resolvePhotoMode(input);
  if (photoMode === "design" && !isPhotoDesignEnabled(workspaceId)) {
    if (input.controls.referenceMode === "design")
      throw new HttpError(404, "Designing with your own photos isn't available here.");
  } else input.controls.referenceMode = photoMode;
  // The brand's own clips or photos as a video: can be switched off per workspace.
  const ownFootage =
    input.type === "video" &&
    (input.controls.videoMode === "brand" || input.controls.videoMode === "recap");
  if (ownFootage && !isClipEditEnabled(workspaceId))
    throw new HttpError(404, "Making videos from your own clips isn't available here.");
  if (ownFootage) {
    // Priced on what really runs: animated photos are five seconds each, and
    // there is no model quote for footage that is the brand's own. Animated
    // photos keep the video option picked for them (Economy and Standard are
    // short clips, in credits).
    const animated = input.controls.videoMode === "recap" && input.controls.recapMotion === "ai";
    input.controls.videoPreview = false;
    delete input.controls.videoQuote;
    if (!animated) delete input.controls.videoModelKey;
    if (animated)
      input.controls.durationSec =
        (input.controls.referenceAssetIds?.length ?? 0) * RECAP_AI_SECONDS;
  }
  // A new AI video's kind, model and length in whole clips, decided before
  // pricing (src/lib/studio/video/settle.ts). A video with no model chosen is
  // made on Standard, never silently on Premium.
  if (!studioTextOnlyRevision(input))
    input.controls = settleVideoControls({
      type: input.type,
      controls: input.controls,
      brief: input.intent.brief,
      template: input.intent.template,
      source: {
        picture: Boolean(input.intent.sourceContentId),
        script: Boolean(input.intent.sourceScript),
        product: Boolean(input.controls.productId),
      },
    });
  // Reject foreign/deleted references before reserving credits or starting work.
  if (!studioTextOnlyRevision(input)) {
    await resolveStudioReferences(
      client as SupabaseClient,
      workspaceId,
      input.controls.referenceAssetIds,
    );
    if (ownFootage && input.controls.videoMode === "brand")
      await resolveStudioClips(
        client as SupabaseClient,
        workspaceId,
        input.controls.sourceVideoAssetIds,
      );
  }
  const action: StudioCharge = studioChargeFor({
    type: input.type,
    includeImage: input.controls.includeImage,
    length: input.controls.length,
    regenerate: Boolean(input.regenerate || input.parentJobId),
    storyMode: input.controls.storyMode,
    videoPreview: input.controls.videoPreview,
    textOnly: studioTextOnlyRevision(input),
    referenceMode: input.controls.referenceMode,
    referenceAssetIds: input.controls.referenceAssetIds,
    photoFidelity: input.controls.photoFidelity,
    articleQuality: input.controls.articleQuality,
    variations: isVariationsRequest(input),
    videoMode: input.controls.videoMode,
    recapMotion: input.controls.recapMotion,
    videoModelKey: input.controls.videoModelKey,
    durationSec: input.controls.durationSec,
    videoResolution: input.controls.videoResolution,
  });
  const billingRoute =
    studioTextOnlyRevision(input) && ["video", "image", "social"].includes(input.type)
      ? "studio.captions"
      : input.type === "story" && input.controls.storyMode === "video"
        ? "video"
        : BILLING_ROUTE[input.type];
  const video = action === "studio_video";
  // An AI clip of 8 s or less on Economy or Standard: credits, not Video Credits.
  const clip = action === "studio_short_clip" ? shortClipPlan(input) : null;
  const recapClips = clip && input.controls.videoMode === "recap";
  const videoQuote =
    (video || (clip && !recapClips)) && input.controls.videoModelKey
      ? quoteStudioVideo(input.controls)
      : null;
  // A person's Generate button carries the quote it showed, which must still
  // hold. A worker (Autopilot, Campaigns, MCP) shows no price and is charged
  // the server's quote.
  if (
    videoQuote &&
    input.controls.videoQuote &&
    (input.controls.videoQuote.hash !== videoQuote.hash ||
      input.controls.videoQuote.units !== videoQuote.units)
  )
    throw new HttpError(
      409,
      "Video settings or prices changed. Refresh the quote before generating.",
    );
  if (videoQuote)
    input.controls.videoQuote = {
      hash: videoQuote.hash,
      units: videoQuote.units,
      meter: videoQuote.meter,
      resolution: videoQuote.resolution,
      aspectRatio: videoQuote.aspectRatio,
    };
  const useCreation = input.controls.paymentSource === "creation" && !video;
  const entitlements = useCreation ? await getEntitlements({ workspaceId, userId, role }) : null;
  if (useCreation && !entitlements?.creation?.active)
    throw new HttpError(
      409,
      "Your creation allowance starts with your next plan renewal. Use wallet credits for this request.",
    );
  const points = useCreation ? creationPointsFor(input) : null;
  let captionEditId: string | null = null;
  let captionCostChargeId: string | null = null;
  if (useCreation && input.includedCaptionEdit) {
    if (
      entitlements?.enforcement === "on" &&
      Object.values(entitlements.meters).some((wallet) => wallet.debt > 0)
    )
      throw new HttpError(
        402,
        "Resolve the outstanding wallet balance before requesting another included edit.",
      );
    if (!isCaptionRevision(input))
      throw new HttpError(400, "Included edits cover captions, not new artwork or full rewrites.");
    await requireBillingFeature({ workspaceId, userId, role, feature: "studio", spending: true });
    if (entitlements?.enforcement === "on") {
      const claim = await reserveCaptionEdit({
        accountId: entitlements.accountId,
        workspaceId,
        userId,
        requestKey: input.idempotencyKey,
        parentJobId: input.parentJobId!,
      });
      captionEditId = claim?.id ?? null;
      captionCostChargeId = claim?.chargeId ?? null;
    }
    if (!captionEditId && entitlements?.enforcement === "on")
      throw new HttpError(
        409,
        "The included caption edits have been used. Refresh this creation to see the next edit's price.",
      );
  }
  const amount = captionEditId
    ? 0
    : (points ??
      (video
        ? (videoQuote?.units ?? studioVideoUnits(input.controls.durationSec))
        : clip
          ? (videoQuote?.units ?? shortClipCreditsForRecap(input.controls, clip.clips))
          : creditsFor(action as CreditAction) *
            (isVariationsRequest(input) ? variationCount(input.controls) : 1)));
  const meter = useCreation
    ? ("creation" as const)
    : video
      ? ("video" as const)
      : ("credits" as const);
  const price = { meter, amount };
  const actionName = captionEditId
    ? "studio_caption_included"
    : useCreation
      ? `creation:${action}`
      : (action as string);

  // All jobs have a durable billing link, including inline text work. This
  // makes cancellation, crash recovery and settlement use the same hold.
  {
    const charge = captionEditId
      ? {
          accountId: entitlements!.accountId,
          chargeId: captionCostChargeId,
          holdId: null,
          mode: "on" as const,
          shadowDecision: "included",
          release: () => settleCaptionEdit(captionEditId!, "released"),
        }
      : await beginDeferredMetered({
          workspaceId,
          userId,
          role,
          actionName,
          meter: price.meter,
          amount,
          feature:
            video || clip
              ? (videoQuote?.feature ??
                (clip ? videoFeatureFor(clip.ugcKey, clip.resolution) : "ugc"))
              : CREDIT_ACTIONS[action as CreditAction].feature,
          idempotencyKey: input.idempotencyKey,
          route: billingRoute,
          expiresAt: new Date(
            Date.now() + (studioJobRenders(input) ? VIDEO_BILLING_HOLD_MS : 15 * 60_000),
          ).toISOString(),
        });
    let job: StudioJob;
    let createdHere = false;
    let billingLinked = false;
    try {
      job = await runWithScope(
        {
          billingAccountId: charge.accountId,
          billingChargeId: charge.chargeId ?? undefined,
          billingMeter: price.meter,
          workspaceId,
          userId,
        },
        () =>
          createStudioJob({
            client,
            workspaceId,
            userId,
            input,
            onCreated: async (created) => {
              createdHere = true;
              if (captionEditId) await linkCaptionEdit(captionEditId, created.id);
              if (charge.mode !== "off")
                await saveStudioBillingLink({
                  job_id: created.id,
                  account_id: charge.accountId,
                  workspace_id: workspaceId,
                  hold_id: charge.holdId,
                  charge_id: charge.chargeId,
                  charge_key: `${userId}:${actionName}:${input.idempotencyKey}`,
                  action: actionName,
                  meter: price.meter,
                  amount,
                  route: billingRoute,
                  mode: charge.mode,
                  shadow_decision: charge.shadowDecision,
                  ...(captionEditId ? { caption_edit_id: captionEditId } : {}),
                });
              billingLinked = charge.mode !== "off";
            },
          }),
      );
    } catch (error) {
      await charge.release();
      throw error;
    }
    if (!createdHere || (charge.mode !== "off" && !billingLinked)) {
      // A replayed job belongs to the original reservation.
      await charge.release();
    } else if (charge.mode !== "off") {
      await settleStudioBilling(job);
      if (
        job.status === "succeeded" &&
        useCreation &&
        ["social", "image", "video", "ad"].includes(job.type)
      )
        job.captionEditsRemaining = await captionEditsRemaining(workspaceId, job.group_id);
    }
    return { job, balance: null, charge: price };
  }
}

/** The catalogue product a new piece is about when none was chosen. Fails open. */
async function autoPickProduct(
  workspaceId: string,
  input: CreateJobInput,
  mode: "named" | "any",
): Promise<string | null> {
  try {
    const { featureCandidates, recentlyFeaturedProducts } =
      await import("@/server/products/service.server");
    const products = await featureCandidates(workspaceId);
    if (!products.length) return null;
    const rotate = mode === "any";
    const pick = pickFeaturedProduct({
      text: [input.intent.brief, input.controls.campaign].filter(Boolean).join("\n"),
      goal: input.intent.goal,
      aim: input.intent.aim,
      products,
      recent: rotate ? await recentlyFeaturedProducts(workspaceId) : [],
      rotate,
    });
    return pick?.id ?? null;
  } catch (error) {
    console.warn("[studio] product pick skipped", error instanceof Error ? error.message : error);
    return null;
  }
}
