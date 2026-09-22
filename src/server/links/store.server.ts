// Row access for the link marketplace. Every write that a provider cycle makes
// is fenced by the lock token, so a process that has been taken over cannot
// change anything after the fact.
import "server-only";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database, Json } from "@/integrations/supabase/types";
import { ProviderLockLostError } from "./provider-lock.server";

/** The generated update shapes, so a typo in a column name fails to compile. */
export type OrderPatch = Database["public"]["Tables"]["link_orders"]["Update"];
export type LinePatch = Database["public"]["Tables"]["link_order_lines"]["Update"];

export type OrderStatus =
  | "cart"
  | "held"
  | "queued"
  | "awaiting_lock"
  | "preflight"
  | "ordering"
  | "ordered"
  | "paying"
  | "paid"
  | "publishing"
  | "published"
  | "partially_published"
  | "blocked_balance"
  | "needs_operator"
  | "failed"
  | "cancelled";

export type LineStatus =
  | "pending"
  | "in_basket"
  | "paid"
  | "awaiting_publication"
  | "published"
  | "live"
  | "lost"
  | "unconfirmed"
  | "failed"
  | "cancelled";

export type EventType =
  | "cart_changed"
  | "checkout"
  | "credits_held"
  | "credits_released"
  | "queued"
  | "lock_acquired"
  | "lock_lost"
  | "preflight_ok"
  | "preflight_failed"
  | "order_submitted"
  | "order_confirmed"
  | "order_unknown"
  | "basket_reconciled"
  | "basket_foreign_item"
  | "pay_submitted"
  | "pay_confirmed"
  | "pay_unknown"
  | "pay_failed"
  | "credits_captured"
  | "credits_refunded"
  | "link_attributed"
  | "verification"
  | "link_lost"
  | "gave_up"
  | "operator_action"
  | "cancelled"
  | "failed";

export type OrderRow = {
  id: string;
  workspace_id: string;
  campaign_id: string | null;
  target_url: string;
  keyword: string;
  language: string;
  content_mode: "auto" | "prompt" | "own";
  recommendations: string | null;
  own_title: string | null;
  own_content: string | null;
  status: OrderStatus;
  substate: string | null;
  line_count: number;
  quoted_usd: number;
  provider_total_usd: number | null;
  provider_charged_usd: number | null;
  charged_is_estimated: boolean;
  balance_before_usd: number | null;
  credit_rate: number;
  credits_held: number;
  credits_captured: number;
  credits_refunded: number;
  provider_order_content_ids: number[];
  provider_basket_ids: number[];
  request_fingerprint: string | null;
  locked_by: string | null;
  lease_until: string | null;
  lock_token: string | null;
  attempt_count: number;
  order_post_attempts: number;
  pay_post_attempts: number;
  next_attempt_at: string | null;
  in_flight_since: string | null;
  failure_code: string | null;
  last_error: string | null;
  needs_operator: boolean;
  operator_note: string | null;
  idempotency_key: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  checkout_at: string | null;
  ordered_at: string | null;
  paid_at: string | null;
  settled_at: string | null;
};

export type LineRow = {
  id: string;
  workspace_id: string;
  order_id: string;
  donor_id: number;
  donor_domain: string;
  unit_price_usd: number;
  credits_price: number;
  status: LineStatus;
  provider_order_content_id: number | null;
  provider_basket_id: number | null;
  provider_link_id: number | null;
  published_url: string | null;
  published_at: string | null;
  provider_cost_usd: number | null;
  attribution: string;
  attribution_detail: Record<string, unknown>;
  opportunity_id: string | null;
  verification: string;
  verified_at: string | null;
  first_live_at: string | null;
  lost_at: string | null;
  consecutive_missing: number;
  next_check_at: string | null;
  give_up_at: string | null;
  settled: "open" | "captured" | "refunded";
  created_at: string;
  updated_at: string;
};

export const ORDER_COLS =
  "id, workspace_id, campaign_id, target_url, keyword, language, content_mode, " +
  "recommendations, own_title, own_content, status, substate, line_count, quoted_usd, " +
  "provider_total_usd, provider_charged_usd, charged_is_estimated, balance_before_usd, " +
  "credit_rate, credits_held, credits_captured, credits_refunded, " +
  "provider_order_content_ids, provider_basket_ids, request_fingerprint, locked_by, " +
  "lease_until, lock_token, attempt_count, order_post_attempts, pay_post_attempts, " +
  "next_attempt_at, in_flight_since, failure_code, last_error, needs_operator, " +
  "operator_note, idempotency_key, created_by, created_at, updated_at, checkout_at, " +
  "ordered_at, paid_at, settled_at";

export const LINE_COLS =
  "id, workspace_id, order_id, donor_id, donor_domain, unit_price_usd, credits_price, " +
  "status, provider_order_content_id, provider_basket_id, provider_link_id, published_url, " +
  "published_at, provider_cost_usd, attribution, attribution_detail, opportunity_id, " +
  "verification, verified_at, first_live_at, lost_at, consecutive_missing, next_check_at, " +
  "give_up_at, settled, created_at, updated_at";

export async function loadOrder(orderId: string): Promise<OrderRow | null> {
  const { data } = await supabaseAdmin
    .from("link_orders")
    .select(ORDER_COLS)
    .eq("id", orderId)
    .maybeSingle();
  return (data as OrderRow | null) ?? null;
}

export async function loadLines(orderId: string): Promise<LineRow[]> {
  const { data } = await supabaseAdmin
    .from("link_order_lines")
    .select(LINE_COLS)
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  return (data as LineRow[] | null) ?? [];
}

/**
 * Writes to an order that a provider cycle owns. The compare-and-set on
 * `lock_token` is the fence: a process whose lease was taken over gets zero
 * rows back and throws, exactly like the GEO runner's LeaseLostError.
 */
export async function patchOrderFenced(
  orderId: string,
  token: string,
  patch: OrderPatch,
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("link_orders")
    .update(patch)
    .eq("id", orderId)
    .eq("lock_token", token)
    .select("id");

  if (error) throw new Error(`order update failed: ${error.message}`);
  if (!data || data.length === 0) throw new ProviderLockLostError();
}

/** For writes made outside a provider cycle (checkout, cancel, monitoring). */
export async function patchOrder(orderId: string, patch: OrderPatch): Promise<void> {
  const { error } = await supabaseAdmin.from("link_orders").update(patch).eq("id", orderId);
  if (error) throw new Error(`order update failed: ${error.message}`);
}

export async function patchLine(lineId: string, patch: LinePatch): Promise<void> {
  const { error } = await supabaseAdmin.from("link_order_lines").update(patch).eq("id", lineId);
  if (error) throw new Error(`line update failed: ${error.message}`);
}

export async function recordEvent(args: {
  workspaceId: string;
  orderId: string;
  lineId?: string | null;
  type: EventType;
  detail?: Record<string, unknown>;
  actor?: string | null;
}): Promise<void> {
  const { error } = await supabaseAdmin.from("link_order_events").insert({
    workspace_id: args.workspaceId,
    order_id: args.orderId,
    line_id: args.lineId ?? null,
    type: args.type,
    detail: (args.detail ?? {}) as Json,
    actor: args.actor ?? null,
  });
  // A lost timeline entry must never take down a money cycle.
  if (error) console.error("[links] event insert failed", error.message);
}

/** Releases an order's worker lease so the next tick can pick it up sooner. */
export async function scheduleRetry(orderId: string, delayMs: number): Promise<void> {
  await patchOrder(orderId, {
    lease_until: null,
    locked_by: null,
    next_attempt_at: new Date(Date.now() + delayMs).toISOString(),
  });
}
