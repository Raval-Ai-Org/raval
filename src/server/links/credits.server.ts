// The credit ledger. Every amount that moves goes through apply_credit_entry,
// which is idempotent on (workspace_id, idempotency_key) and takes an advisory
// lock per workspace.
//
// Idempotency keys are derived from row ids only — never from a timestamp or an
// attempt counter — so replaying any step after a crash is an exact no-op. That
// is what makes the order runner safe to resume from any state.
import "server-only";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HttpError } from "@/server/http-error";
import { DEFAULT_PRICING, type PricingConfig } from "@/lib/links/pricing";

export type CreditKind = "topup" | "hold" | "release" | "capture" | "refund" | "adjustment";

export type CreditBalance = {
  available: number;
  held: number;
  lifetimeToppedUp: number;
  lifetimeSpent: number;
};

export type CreditEntry = {
  workspaceId: string;
  kind: CreditKind;
  idempotencyKey: string;
  deltaAvailable?: number;
  deltaHeld?: number;
  orderId?: string | null;
  lineId?: string | null;
  reason?: string | null;
  actor?: string | null;
};

export type CreditResult =
  | { ok: true; replayed: boolean; available: number; held: number }
  | { ok: false; code: string; reason: string; available?: number; held?: number };

/** Server-side pricing configuration. The browser never supplies any of this. */
export function pricingConfig(): PricingConfig {
  const margin = Number(process.env.MELLOX_LINK_MARGIN);
  const creditsPerUsd = Number(process.env.MELLOX_CREDITS_PER_USD);
  return {
    margin: Number.isFinite(margin) && margin >= 1 ? margin : DEFAULT_PRICING.margin,
    creditsPerUsd:
      Number.isFinite(creditsPerUsd) && creditsPerUsd >= 1
        ? Math.trunc(creditsPerUsd)
        : DEFAULT_PRICING.creditsPerUsd,
  };
}

/** Hard ceiling on a single order, in provider USD. No input can raise it. */
export function maxOrderUsd(): number {
  const configured = Number(process.env.MELLOX_LINK_MAX_ORDER_USD);
  return Number.isFinite(configured) && configured > 0 ? configured : 500;
}

export async function getBalance(workspaceId: string): Promise<CreditBalance> {
  const { data, error } = await supabaseAdmin
    .from("workspace_credit_balances")
    .select("available, held, lifetime_topped_up, lifetime_spent")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) throw new HttpError(500, "We couldn't read your credit balance.");
  return {
    available: Number(data?.available ?? 0),
    held: Number(data?.held ?? 0),
    lifetimeToppedUp: Number(data?.lifetime_topped_up ?? 0),
    lifetimeSpent: Number(data?.lifetime_spent ?? 0),
  };
}

async function apply(entry: CreditEntry): Promise<CreditResult> {
  const { data, error } = await supabaseAdmin.rpc("apply_credit_entry", {
    p: {
      workspace_id: entry.workspaceId,
      kind: entry.kind,
      idempotency_key: entry.idempotencyKey,
      delta_available: entry.deltaAvailable ?? 0,
      delta_held: entry.deltaHeld ?? 0,
      order_id: entry.orderId ?? null,
      line_id: entry.lineId ?? null,
      reason: entry.reason ?? null,
      actor: entry.actor ?? null,
    },
  });

  if (error) throw new HttpError(500, "We couldn't update your credits.");
  const result = data as Record<string, unknown> | null;
  if (!result || result.ok !== true) {
    return {
      ok: false,
      code: String(result?.code ?? "unknown"),
      reason: String(result?.reason ?? "We couldn't update your credits."),
      available: typeof result?.available === "number" ? result.available : undefined,
      held: typeof result?.held === "number" ? result.held : undefined,
    };
  }
  return {
    ok: true,
    replayed: result.replayed === true,
    available: Number(result.available ?? 0),
    held: Number(result.held ?? 0),
  };
}

/** Credits bought. Keyed on the payment intent so a webhook replay is a no-op. */
export function recordTopUp(args: {
  workspaceId: string;
  credits: number;
  paymentIntentId: string;
  reason?: string;
  actor?: string | null;
}): Promise<CreditResult> {
  return apply({
    workspaceId: args.workspaceId,
    kind: "topup",
    idempotencyKey: `topup:${args.paymentIntentId}`,
    deltaAvailable: args.credits,
    reason: args.reason ?? "Credit purchase",
    actor: args.actor ?? null,
  });
}

/**
 * Moves credits from available to held at checkout. Nothing reaches the
 * provider without this having succeeded first.
 */
export function holdForOrder(args: {
  workspaceId: string;
  orderId: string;
  credits: number;
  actor?: string | null;
}): Promise<CreditResult> {
  return apply({
    workspaceId: args.workspaceId,
    kind: "hold",
    idempotencyKey: `order:${args.orderId}:hold`,
    deltaAvailable: -args.credits,
    deltaHeld: args.credits,
    orderId: args.orderId,
    reason: "Reserved for a link order",
    actor: args.actor ?? null,
  });
}

/** Gives a hold back in full. Only ever used when nothing was charged. */
export function releaseHold(args: {
  workspaceId: string;
  orderId: string;
  credits: number;
  reason: string;
}): Promise<CreditResult> {
  return apply({
    workspaceId: args.workspaceId,
    kind: "release",
    idempotencyKey: `order:${args.orderId}:release`,
    deltaAvailable: args.credits,
    deltaHeld: -args.credits,
    orderId: args.orderId,
    reason: args.reason,
  });
}

/**
 * Consumes a line's share of the hold. Captured at payment, not at
 * publication: payment is when Mellox's real money leaves, and a held balance
 * that outlives the spend understates what the workspace actually owes.
 */
export function captureLine(args: {
  workspaceId: string;
  orderId: string;
  lineId: string;
  credits: number;
}): Promise<CreditResult> {
  return apply({
    workspaceId: args.workspaceId,
    kind: "capture",
    idempotencyKey: `line:${args.lineId}:capture`,
    deltaHeld: -args.credits,
    orderId: args.orderId,
    lineId: args.lineId,
    reason: "Placement paid for",
  });
}

/**
 * Gives a captured line's credits back. This costs Mellox real, unrecoverable
 * provider money, which is why `refundCeilingReached` exists.
 */
export function refundLine(args: {
  workspaceId: string;
  orderId: string;
  lineId: string;
  credits: number;
  reason: string;
}): Promise<CreditResult> {
  return apply({
    workspaceId: args.workspaceId,
    kind: "refund",
    idempotencyKey: `line:${args.lineId}:refund`,
    deltaAvailable: args.credits,
    orderId: args.orderId,
    lineId: args.lineId,
    reason: args.reason,
  });
}

/** An operator correction. The caller supplies the key, so it stays auditable. */
export function adjust(args: {
  workspaceId: string;
  key: string;
  deltaAvailable?: number;
  deltaHeld?: number;
  reason: string;
  actor?: string | null;
}): Promise<CreditResult> {
  return apply({
    workspaceId: args.workspaceId,
    kind: "adjustment",
    idempotencyKey: `adjust:${args.key}`,
    deltaAvailable: args.deltaAvailable ?? 0,
    deltaHeld: args.deltaHeld ?? 0,
    reason: args.reason,
    actor: args.actor ?? null,
  });
}

const REFUND_CEILING_CREDITS = 100_000;

/**
 * A refund is money Mellox cannot get back from the provider, so there is a
 * monthly ceiling in code rather than only in policy. Past it, new orders are
 * refused until someone looks.
 */
export async function refundCeilingReached(): Promise<boolean> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("workspace_credit_ledger")
    .select("delta_available")
    .eq("kind", "refund")
    .gte("created_at", since)
    .limit(5000);

  if (error) return false;
  const total = (data ?? []).reduce((sum, row) => sum + Number(row.delta_available ?? 0), 0);
  return total >= REFUND_CEILING_CREDITS;
}
