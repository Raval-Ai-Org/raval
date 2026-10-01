import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Meter } from "@/lib/billing/catalog";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HttpError } from "@/server/http-error";
import { setRequestScope } from "@/server/request-context";
import { InsufficientBalanceError, LimitReachedError } from "./errors";

const admin = supabaseAdmin as unknown as SupabaseClient;

export type MeterResult = {
  ok: boolean;
  replayed?: boolean;
  code?: string;
  reason?: string;
  id?: string;
  charge_id?: string;
  grant_id?: string;
  state?: string;
  available?: number;
  held?: number;
  available_any?: number;
  debt?: number;
  used?: number;
  max?: number;
};

async function meterRpc(
  name:
    | "meter_grant"
    | "meter_hold"
    | "meter_capture"
    | "meter_release"
    | "meter_rollover"
    | "meter_clawback",
  payload: Record<string, unknown>,
): Promise<MeterResult> {
  const { data, error } = await admin.rpc(name, { p: payload });
  if (error) throw new HttpError(503, "Billing balance is temporarily unavailable.");
  const result = data as MeterResult | null;
  if (!result || typeof result.ok !== "boolean") {
    throw new HttpError(503, "Billing balance is temporarily unavailable.");
  }
  if (!result.ok && result.code !== "insufficient_balance" && result.code !== "brand_cap") {
    throw new HttpError(409, result.reason ?? "Billing balance could not be updated.");
  }
  // Tell the browser to refresh its balance with this response.
  // A replayed entry changed nothing, so it never triggers a refresh.
  if (result.ok && !result.replayed) setRequestScope({ billingChanged: true });
  return result;
}

export async function grantMeter(args: {
  accountId: string;
  meter: Meter;
  amount: number;
  source: string;
  restriction?: "any" | "ai_only";
  idempotencyKey: string;
  periodStart?: string;
  expiresAt?: string;
  workspaceId?: string;
  providerRef?: string;
  reason?: string;
  actor?: string;
}): Promise<MeterResult> {
  return meterRpc("meter_grant", {
    account_id: args.accountId,
    meter: args.meter,
    amount: args.amount,
    source: args.source,
    restriction: args.restriction ?? "ai_only",
    idempotency_key: args.idempotencyKey,
    period_start: args.periodStart,
    expires_at: args.expiresAt,
    workspace_id: args.workspaceId,
    provider_ref: args.providerRef,
    reason: args.reason,
    actor: args.actor,
  });
}

export async function holdMeter(args: {
  accountId: string;
  meter: Meter;
  amount: number;
  action: string;
  idempotencyKey: string;
  workspaceId?: string;
  userId?: string;
  expiresAt?: string;
  requireAny?: boolean;
}): Promise<MeterResult> {
  const result = await meterRpc("meter_hold", {
    account_id: args.accountId,
    meter: args.meter,
    amount: args.amount,
    action: args.action,
    idempotency_key: args.idempotencyKey,
    workspace_id: args.workspaceId,
    user_id: args.userId,
    expires_at: args.expiresAt ?? new Date(Date.now() + 15 * 60_000).toISOString(),
    require_any: args.requireAny ?? false,
  });
  if (!result.ok) {
    if (result.code === "brand_cap") {
      throw new LimitReachedError({
        limit: "monthly_brand_credits",
        used: Number(result.used ?? 0),
        max: Number(result.max ?? 0),
      });
    }
    throw new InsufficientBalanceError({
      meter: args.meter,
      needed: args.amount,
      available: Number(result.available ?? 0),
      options: args.meter === "video" ? ["video_pack", "upgrade"] : ["credit_pack", "upgrade"],
    });
  }
  return result;
}

export async function captureMeter(args: {
  accountId: string;
  holdId: string;
  amount?: number;
  idempotencyKey: string;
  route?: string;
  finalize?: boolean;
  chargeId?: string;
}): Promise<MeterResult> {
  return meterRpc("meter_capture", {
    account_id: args.accountId,
    hold_id: args.holdId,
    amount: args.amount,
    idempotency_key: args.idempotencyKey,
    route: args.route,
    finalize: args.finalize ?? true,
    charge_id: args.chargeId,
  });
}

export async function releaseMeter(args: {
  accountId: string;
  holdId: string;
  idempotencyKey: string;
  reason?: string;
}): Promise<MeterResult> {
  return meterRpc("meter_release", {
    account_id: args.accountId,
    hold_id: args.holdId,
    idempotency_key: args.idempotencyKey,
    reason: args.reason,
  });
}

export async function rolloverMeter(args: {
  accountId: string;
  meter: "credits" | "video";
  windowStart: string;
  cap: number;
  expiresAt: string;
}): Promise<MeterResult> {
  return meterRpc("meter_rollover", {
    account_id: args.accountId,
    meter: args.meter,
    window_start: args.windowStart,
    cap: args.cap,
    expires_at: args.expiresAt,
  });
}

export async function clawbackMeter(args: {
  accountId: string;
  grantId: string;
  amount: number;
  idempotencyKey: string;
  reason: string;
}): Promise<MeterResult> {
  return meterRpc("meter_clawback", {
    account_id: args.accountId,
    grant_id: args.grantId,
    amount: args.amount,
    idempotency_key: args.idempotencyKey,
    reason: args.reason,
  });
}
