import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CREDIT_ACTIONS,
  STUDIO_VIDEO_UNITS,
  creditsFor,
  videoFeatureFor,
  videoUnitsFor,
  type CreditAction,
  type FeatureKey,
  type Meter,
  type UgcModelKey,
  type VideoResolution,
} from "@/lib/billing/catalog";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runWithScope } from "@/server/request-context";
import { HttpError } from "@/server/http-error";
import { getEntitlements, type Entitlements } from "./entitlements.server";
import { BrandFrozenError, SpendNotAllowedError, UpgradeRequiredError } from "./errors";
import { captureMeter, holdMeter, releaseMeter } from "./meters.server";

const admin = supabaseAdmin as unknown as SupabaseClient;

export type MeteredAction =
  | CreditAction
  | "studio_video"
  | {
      video: {
        ugcKey: UgcModelKey;
        seconds: number;
        resolution: VideoResolution;
        providerCostUsd?: number;
      };
    };

export type MeteredCharge = {
  id: string | null;
  accountId: string;
  meter: Meter;
  amount: number;
  mode: "off" | "shadow" | "on";
  /** Charge less than the hold for partial success. The rest is released. */
  setCapturedAmount: (amount: number) => void;
};

export type MeteredResult<T> = { result: T; balance: number | null; chargeId: string | null };

function price(
  action: MeteredAction,
  quantity: number,
): {
  actionName: string;
  meter: Meter;
  amount: number;
  feature: FeatureKey | null;
} {
  if (action === "studio_video") {
    return {
      actionName: action,
      meter: "video",
      amount: STUDIO_VIDEO_UNITS * quantity,
      feature: "ugc",
    };
  }
  if (typeof action === "string") {
    return {
      actionName: action,
      meter: "credits",
      amount: creditsFor(action, quantity),
      feature: CREDIT_ACTIONS[action].feature,
    };
  }
  const video = action.video;
  return {
    actionName: `video_${video.ugcKey}`,
    meter: "video",
    amount: videoUnitsFor(video) * quantity,
    feature: videoFeatureFor(video.ugcKey, video.resolution),
  };
}

function decision(
  entitlements: Entitlements,
  feature: FeatureKey | null,
  meter: Meter,
  amount: number,
) {
  if (entitlements.frozen) return { code: "brand_frozen", reason: "Brand is frozen" };
  if (entitlements.role === "viewer")
    return { code: "spend_not_allowed", reason: "Viewer cannot spend" };
  if (feature && !entitlements.features[feature].allowed) {
    return {
      code: "upgrade_required",
      reason: `Requires ${entitlements.features[feature].requiredPlan}`,
    };
  }
  if (entitlements.meters[meter].available < amount) {
    return { code: "insufficient_balance", reason: "Balance is too low" };
  }
  return { code: "would_charge", reason: null };
}

async function logShadow(args: {
  entitlements: Entitlements;
  workspaceId: string;
  action: string;
  meter: Meter;
  amount: number;
  code: string;
  reason: string | null;
}): Promise<void> {
  const { error } = await admin.from("billing_shadow_events").insert({
    account_id: args.entitlements.accountId,
    workspace_id: args.workspaceId,
    action: args.action,
    meter: args.meter,
    amount: args.amount,
    decision: args.code,
    reason: args.reason,
  });
  if (error) console.error("[billing] shadow event failed", error.code);
}

/** The caller must verify workspace membership before calling this function. */
export async function runMetered<T>(
  args: {
    workspaceId: string;
    userId: string;
    role: "owner" | "admin" | "editor" | "viewer";
    action: MeteredAction;
    quantity?: number;
    idempotencyKey: string;
    route?: string;
  },
  run: (charge: MeteredCharge) => Promise<T>,
): Promise<MeteredResult<T>> {
  const quantity = args.quantity ?? 1;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || !args.idempotencyKey.trim()) {
    throw new HttpError(400, "Invalid charge quantity or idempotency key.");
  }
  const priced = price(args.action, quantity);
  if (priced.amount <= 0) throw new HttpError(500, "Catalog action has no price.");
  const entitlements = await getEntitlements({
    workspaceId: args.workspaceId,
    userId: args.userId,
    role: args.role,
  });
  const mode = entitlements.enforcement;
  const would = decision(entitlements, priced.feature, priced.meter, priced.amount);
  if (mode === "shadow" && would.code !== "would_charge") {
    await logShadow({
      entitlements,
      workspaceId: args.workspaceId,
      action: priced.actionName,
      meter: priced.meter,
      amount: priced.amount,
      code: would.code,
      reason: would.reason,
    });
  }
  if (mode === "on") {
    if (entitlements.frozen) throw new BrandFrozenError();
    if (entitlements.role === "viewer") throw new SpendNotAllowedError();
    if (priced.feature && !entitlements.features[priced.feature].allowed) {
      throw new UpgradeRequiredError({
        feature: priced.feature,
        requiredPlan: entitlements.features[priced.feature].requiredPlan,
        currentPlan: entitlements.entitledPlan,
      });
    }
  }

  const key = `${args.userId}:${priced.actionName}:${args.idempotencyKey}`;
  const chargeId = mode === "on" ? crypto.randomUUID() : null;
  const held =
    mode === "on"
      ? await holdMeter({
          accountId: entitlements.accountId,
          workspaceId: args.workspaceId,
          userId: args.userId,
          action: priced.actionName,
          meter: priced.meter,
          amount: priced.amount,
          idempotencyKey: key,
        })
      : null;
  if (held?.replayed && held.state !== "held") {
    throw new HttpError(409, "This action already completed. Refresh to see its result.");
  }
  if (held?.replayed && held.id) {
    const { data, error } = await admin
      .from("meter_holds")
      .select("amount,action,user_id,workspace_id")
      .eq("id", held.id)
      .single();
    if (
      error ||
      !data ||
      Number(data.amount) !== priced.amount ||
      data.action !== priced.actionName ||
      data.user_id !== args.userId ||
      data.workspace_id !== args.workspaceId
    ) {
      throw new HttpError(409, "This request key was already used for a different action.");
    }
  }
  let capturedAmount = priced.amount;
  const charge: MeteredCharge = {
    id: chargeId,
    accountId: entitlements.accountId,
    meter: priced.meter,
    amount: priced.amount,
    mode,
    setCapturedAmount(amount) {
      if (!Number.isSafeInteger(amount) || amount < 0 || amount > priced.amount) {
        throw new HttpError(400, "Invalid captured amount.");
      }
      capturedAmount = amount;
    },
  };
  let result: T;
  try {
    result = await runWithScope(
      { billingAccountId: entitlements.accountId, billingChargeId: chargeId ?? undefined },
      () => run(charge),
    );
  } catch (error) {
    if (held?.id) {
      try {
        await releaseMeter({
          accountId: entitlements.accountId,
          holdId: held.id,
          idempotencyKey: `${key}:failed`,
          reason: "Action failed",
        });
      } catch (releaseError) {
        console.error("[billing] hold release failed", releaseError);
      }
    }
    throw error;
  }
  if (mode === "shadow" && would.code === "would_charge" && capturedAmount > 0) {
    await logShadow({
      entitlements,
      workspaceId: args.workspaceId,
      action: priced.actionName,
      meter: priced.meter,
      amount: capturedAmount,
      code: "would_charge",
      reason: null,
    });
  }
  if (!held?.id) return { result, balance: null, chargeId: null };
  if (capturedAmount === 0) {
    const released = await releaseMeter({
      accountId: entitlements.accountId,
      holdId: held.id,
      idempotencyKey: `${key}:zero`,
      reason: "No successful work",
    });
    return { result, balance: Number(released.available ?? 0), chargeId: null };
  }
  // An ambiguous capture response can be retried with this stable key.
  // Releasing here could undo a successful provider job.
  const captured = await captureMeter({
    accountId: entitlements.accountId,
    holdId: held.id,
    amount: capturedAmount,
    idempotencyKey: key,
    route: args.route,
    chargeId: chargeId ?? undefined,
  });
  return { result, balance: Number(captured.available ?? 0), chargeId };
}
