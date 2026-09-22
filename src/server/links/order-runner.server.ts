// The order fulfilment state machine.
//
//   queued -> awaiting_lock -> preflight -> ordering -> ordered -> paying
//          -> paid -> publishing -> published | partially_published
//
// Two rules govern the whole file:
//
//   1. Intent is written to Postgres and committed BEFORE any money-critical
//      POST. If the process dies at the worst possible moment, the next tick
//      knows a call may be in flight.
//   2. The order call and the pay call are NEVER repeated on an unknown
//      outcome. They are resolved by reading the basket. An unknown order
//      resolves by items APPEARING; an unknown pay resolves by items
//      DISAPPEARING. Both are observations, never a second write.
//
// Anything this file cannot resolve with certainty halts the queue and asks an
// operator. A stuck queue is recoverable; an unattributed charge is not.
import "server-only";

import { recordAudit } from "@/server/audit.server";
import { assertPublicUrl, SsrfBlockedError } from "@/server/safe-fetch";
import {
  createOrder,
  getBalance,
  getBasket,
  payBasket,
  RixotError,
  type BasketItem,
} from "./rixot/client.server";
import {
  acquireProviderLock,
  assertProviderLock,
  ProviderLockLostError,
  quarantineProviderLock,
  releaseProviderLock,
  workerId,
} from "./provider-lock.server";
import { classifyBasket, payVerdict, preflightVerdict } from "./reconcile.server";
import { captureLine, maxOrderUsd, releaseHold } from "./credits.server";
import {
  loadLines,
  loadOrder,
  patchLine,
  patchOrder,
  patchOrderFenced,
  recordEvent,
  scheduleRetry,
  type LineRow,
  type OrderRow,
} from "./store.server";

/**
 * How long to wait after an unknown POST before inspecting the basket. Three
 * times the request timeout, so a request still in flight cannot land in the
 * middle of the inspection and be misread as "never arrived".
 */
const ORDER_SETTLE_MS = 90_000;
const PAY_SETTLE_MS = 120_000;

/** Provider days-to-publish is roughly 1; give up well past any plausible delay. */
const GIVE_UP_DAYS = 14;

export type SliceResult = "done" | "yield" | "blocked" | "halted";

type Ctx = { order: OrderRow; token: string; worker: string };

function isUnknownOutcome(error: unknown): boolean {
  // A timeout or a transport failure means the request may have been
  // processed. Anything the provider answered is a known outcome.
  return error instanceof RixotError && error.transient;
}

async function halt(order: OrderRow, reason: string, quarantine: boolean): Promise<SliceResult> {
  await patchOrder(order.id, {
    status: "needs_operator",
    needs_operator: true,
    operator_note: reason.slice(0, 500),
    substate: null,
    lease_until: null,
    locked_by: null,
  });
  await recordEvent({
    workspaceId: order.workspace_id,
    orderId: order.id,
    type: "basket_foreign_item",
    detail: { reason, quarantine },
  });
  await recordAudit({
    workspaceId: order.workspace_id,
    userId: null,
    action: "links.order.halted",
    entity: order.id,
    payload: { reason, quarantine },
  });
  if (quarantine) await quarantineProviderLock(reason);
  return "halted";
}

async function fail(
  order: OrderRow,
  code: string,
  message: string,
  token: string | null,
): Promise<SliceResult> {
  // Nothing was charged on this path, so the hold goes back in full.
  if (order.credits_held > order.credits_captured + order.credits_refunded) {
    const outstanding = order.credits_held - order.credits_captured - order.credits_refunded;
    const result = await releaseHold({
      workspaceId: order.workspace_id,
      orderId: order.id,
      credits: outstanding,
      reason: message,
    });
    if (result.ok) {
      await recordEvent({
        workspaceId: order.workspace_id,
        orderId: order.id,
        type: "credits_released",
        detail: { credits: outstanding, reason: message },
      });
    }
  }

  await patchOrder(order.id, {
    status: "failed",
    failure_code: code,
    last_error: message.slice(0, 500),
    substate: null,
    lease_until: null,
    locked_by: null,
    settled_at: new Date().toISOString(),
  });
  await Promise.all(
    (await loadLines(order.id))
      .filter((line) => !["published", "live", "lost"].includes(line.status))
      .map((line) => patchLine(line.id, { status: "cancelled" })),
  );
  await recordEvent({
    workspaceId: order.workspace_id,
    orderId: order.id,
    type: "failed",
    detail: { code, message },
  });
  if (token) await releaseProviderLock(token);
  return "done";
}

// ── S3 preflight ────────────────────────────────────────────────────────────

async function runPreflight(ctx: Ctx, lines: LineRow[]): Promise<SliceResult> {
  const { order, token } = ctx;

  // B4: a target the fetcher would refuse must never reach the provider.
  try {
    assertPublicUrl(order.target_url);
  } catch (error) {
    if (error instanceof SsrfBlockedError) {
      return fail(order, "bad_target", "That page address cannot be reached publicly.", token);
    }
    return fail(order, "bad_target", "That page address is not valid.", token);
  }

  // A server-side ceiling no request parameter can raise.
  if (order.quoted_usd > maxOrderUsd()) {
    return fail(order, "too_large", "That order is larger than we allow in one go.", token);
  }

  const [basket, balance] = await Promise.all([getBasket(), getBalance()]);

  // B1: Invariant B. Nothing is added to a basket we do not fully understand.
  const report = await classifyBasket(basket);
  const verdict = preflightVerdict(report, order.id);

  if (verdict.kind === "blocked") {
    return halt(order, verdict.reason, true);
  }
  if (verdict.kind === "other_order_owns") {
    // That order owns the basket and must finish first. Wait our turn.
    await releaseProviderLock(token);
    await patchOrder(order.id, { status: "awaiting_lock", lock_token: null });
    await scheduleRetry(order.id, 20_000);
    return "yield";
  }
  if (verdict.kind === "resume_this_order") {
    // A takeover landed us after our own order call succeeded. Adopt and skip
    // straight to the pay gate rather than ordering again.
    return adoptBasket(
      ctx,
      lines,
      report.items.map((entry) => entry.item),
    );
  }

  // B2: the provider balance has to cover this before we create anything. If
  // it does not, the hold stays and an operator tops the provider account up.
  if (balance + 0.005 < order.quoted_usd) {
    await releaseProviderLock(token);
    await patchOrder(order.id, {
      status: "blocked_balance",
      lock_token: null,
      substate: "provider_balance",
      last_error: null,
      lease_until: null,
      locked_by: null,
      next_attempt_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
    await recordEvent({
      workspaceId: order.workspace_id,
      orderId: order.id,
      type: "preflight_failed",
      detail: { reason: "provider_balance", balance, needed: order.quoted_usd },
    });
    await recordAudit({
      workspaceId: order.workspace_id,
      userId: null,
      action: "links.provider.balance_low",
      entity: order.id,
      payload: { balance, needed: order.quoted_usd },
    });
    return "blocked";
  }

  // B3: a donor delisted since checkout cannot be bought.
  const stale = lines.filter((line) => line.status === "cancelled");
  if (stale.length > 0) {
    return fail(order, "delisted", "One of those sites is no longer available.", token);
  }

  await patchOrderFenced(order.id, token, { status: "preflight", substate: "ready" });
  await recordEvent({
    workspaceId: order.workspace_id,
    orderId: order.id,
    type: "preflight_ok",
    detail: { balance, lines: lines.length },
  });

  return placeOrder({ ...ctx, order: { ...order, status: "preflight" } }, lines);
}

// ── S4 ordering (money-critical window #1) ──────────────────────────────────

async function placeOrder(ctx: Ctx, lines: LineRow[]): Promise<SliceResult> {
  const { order, token } = ctx;

  if (order.order_post_attempts >= 3) {
    return halt(order, "The provider order call failed three times without a clear outcome.", true);
  }

  const donorIds = lines.map((line) => line.donor_id);
  const request = {
    donorIds,
    targetUrl: order.target_url,
    keyword: order.keyword,
    language: order.language,
    recommendations:
      order.content_mode === "prompt" ? (order.recommendations ?? undefined) : undefined,
    content: order.content_mode === "own" ? (order.own_content ?? undefined) : undefined,
    title: order.content_mode === "own" ? (order.own_title ?? undefined) : undefined,
  };

  // Committed before the call, together with the exact body, so a reconciler
  // can match basket items without re-deriving what we asked for.
  await assertProviderLock(token, "ordering");
  await patchOrderFenced(order.id, token, {
    status: "ordering",
    substate: null,
    in_flight_since: new Date().toISOString(),
    order_post_attempts: order.order_post_attempts + 1,
  });
  await recordEvent({
    workspaceId: order.workspace_id,
    orderId: order.id,
    type: "order_submitted",
    detail: {
      donorIds,
      targetUrl: order.target_url,
      keyword: order.keyword,
      mode: order.content_mode,
    },
  });

  let result;
  try {
    result = await createOrder(request);
  } catch (error) {
    if (isUnknownOutcome(error)) {
      // Leave the order in `ordering` with in_flight_since set. The next tick
      // waits out the settle delay and reads the basket. Never retried here.
      await recordEvent({
        workspaceId: order.workspace_id,
        orderId: order.id,
        type: "order_unknown",
        detail: { error: error instanceof Error ? error.message : String(error) },
      });
      await releaseProviderLock(token);
      await patchOrder(order.id, { lock_token: null });
      await scheduleRetry(order.id, ORDER_SETTLE_MS);
      return "yield";
    }
    // A deterministic rejection means nothing was created.
    const message =
      error instanceof RixotError ? error.message : "The provider rejected that order.";
    const code = error instanceof RixotError ? error.code : "order_rejected";
    return fail(order, code, message, token);
  }

  await patchOrderFenced(order.id, token, {
    status: "ordered",
    in_flight_since: null,
    ordered_at: new Date().toISOString(),
    provider_order_content_ids: result.orderContentIds,
    provider_basket_ids: result.basketIds,
    provider_total_usd: result.totalUsd,
  });
  await recordEvent({
    workspaceId: order.workspace_id,
    orderId: order.id,
    type: "order_confirmed",
    detail: {
      basketIds: result.basketIds,
      totalUsd: result.totalUsd,
      quotedUsd: order.quoted_usd,
      // A drift here is not fatal — the items exist — but the pay gate is
      // strict and will refuse if the basket does not add up.
      drift: result.totalUsd !== null && Math.abs(result.totalUsd - order.quoted_usd) >= 0.005,
    },
  });

  const refreshed = await loadOrder(order.id);
  if (!refreshed) return "done";
  return verifyAndPay({ ...ctx, order: refreshed }, await loadLines(order.id));
}

/**
 * Resolving an unknown order call. The basket is the only mirror of what the
 * provider did, so the diff below is the whole decision.
 */
async function resolveUnknownOrder(ctx: Ctx, lines: LineRow[]): Promise<SliceResult> {
  const { order, token } = ctx;

  const waitedFor = order.in_flight_since
    ? Date.now() - new Date(order.in_flight_since).getTime()
    : Number.POSITIVE_INFINITY;
  if (waitedFor < ORDER_SETTLE_MS) {
    await releaseProviderLock(token);
    await patchOrder(order.id, { lock_token: null });
    await scheduleRetry(order.id, ORDER_SETTLE_MS - waitedFor);
    return "yield";
  }

  const basket = await getBasket();
  const report = await classifyBasket(basket);

  const oursHere = report.items.filter(
    (entry) => entry.classification.kind !== "foreign" && entry.classification.orderId === order.id,
  );

  if (report.foreignCount > 0 || report.ambiguousCount > 0) {
    return halt(
      order,
      "The provider basket holds items that could not be matched to this order.",
      true,
    );
  }

  if (report.empty) {
    // The call never landed. This is the only case a retry is permitted, and
    // only from a provably empty basket.
    await recordEvent({
      workspaceId: order.workspace_id,
      orderId: order.id,
      type: "basket_reconciled",
      detail: { outcome: "empty", conclusion: "order call did not land" },
    });
    if (order.order_post_attempts >= 3) {
      return fail(order, "order_unknown", "We could not place that order.", token);
    }
    await patchOrderFenced(order.id, token, { status: "preflight", in_flight_since: null });
    return placeOrder({ ...ctx, order: { ...order, status: "preflight" } }, lines);
  }

  if (oursHere.length === lines.length && oursHere.length === report.items.length) {
    await recordEvent({
      workspaceId: order.workspace_id,
      orderId: order.id,
      type: "basket_reconciled",
      detail: { outcome: "complete", conclusion: "order call landed" },
    });
    return adoptBasket(
      ctx,
      lines,
      oursHere.map((entry) => entry.item),
    );
  }

  // A strict subset, or more items than we asked for. Topping up the missing
  // donors could duplicate the ones already present, and nothing can be
  // removed, so this is where a human has to look.
  return halt(
    order,
    `The provider basket holds ${report.items.length} item(s) for an order of ${lines.length}. It cannot be resolved automatically.`,
    true,
  );
}

/** Pins basket ids onto lines so the pay gate has something certain to check. */
async function adoptBasket(ctx: Ctx, lines: LineRow[], items: BasketItem[]): Promise<SliceResult> {
  const { order, token } = ctx;
  const remaining = [...lines];
  const basketIds: number[] = [];

  for (const item of items) {
    const index = remaining.findIndex(
      (line) =>
        line.donor_domain.replace(/^www\./, "") === (item.domain ?? "").replace(/^www\./, "") &&
        Math.abs(line.unit_price_usd - (item.priceUsd ?? -1)) < 0.005,
    );
    if (index === -1 || item.basketId === null) {
      return halt(order, "A basket item could not be matched to a line of this order.", true);
    }
    const [line] = remaining.splice(index, 1);
    await patchLine(line.id, {
      provider_basket_id: item.basketId,
      provider_order_content_id: item.orderContentId,
      status: "in_basket",
    });
    basketIds.push(item.basketId);
  }

  if (remaining.length > 0) {
    return halt(order, "The provider basket is missing items this order created.", true);
  }

  await patchOrderFenced(order.id, token, {
    status: "ordered",
    in_flight_since: null,
    provider_basket_ids: basketIds,
    ordered_at: order.ordered_at ?? new Date().toISOString(),
  });

  const refreshed = await loadOrder(order.id);
  if (!refreshed) return "done";
  return verifyAndPay({ ...ctx, order: refreshed }, await loadLines(order.id));
}

// ── S5/S6 verify then pay (money-critical window #2) ────────────────────────

async function verifyAndPay(ctx: Ctx, lines: LineRow[]): Promise<SliceResult> {
  const { order, token } = ctx;

  const [basket, balance] = await Promise.all([getBasket(), getBalance()]);
  const report = await classifyBasket(basket);

  const verdict = payVerdict({
    report,
    orderId: order.id,
    expectedBasketIds: order.provider_basket_ids,
    expectedTotalUsd: order.quoted_usd,
    expectedLines: lines.map((line) => ({
      donorDomain: line.donor_domain,
      unitPriceUsd: line.unit_price_usd,
    })),
  });

  if (verdict.kind === "hold") {
    return halt(order, verdict.reason, true);
  }

  if (balance + 0.005 < verdict.totalUsd) {
    // The items are ours and pinned, so this is safe to resume: the basket set
    // is already fixed. But the queue is blocked until someone tops up, because
    // the next order's empty-basket check would otherwise trip.
    await releaseProviderLock(token);
    await patchOrder(order.id, {
      status: "blocked_balance",
      lock_token: null,
      substate: "provider_balance_at_pay",
      lease_until: null,
      locked_by: null,
      next_attempt_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
    await recordAudit({
      workspaceId: order.workspace_id,
      userId: null,
      action: "links.provider.balance_low_at_pay",
      entity: order.id,
      payload: { balance, needed: verdict.totalUsd },
    });
    return "blocked";
  }

  await recordEvent({
    workspaceId: order.workspace_id,
    orderId: order.id,
    type: "basket_reconciled",
    detail: { outcome: "verified", totalUsd: verdict.totalUsd, items: report.items.length },
  });

  return payForBasket({ ...ctx, order }, lines, balance);
}

async function payForBasket(
  ctx: Ctx,
  lines: LineRow[],
  balanceBefore: number,
): Promise<SliceResult> {
  const { order, token } = ctx;

  if (order.pay_post_attempts >= 3) {
    return halt(order, "The provider pay call failed three times without a clear outcome.", true);
  }

  // Committed before the call. balance_before_usd is the only way to work out
  // what was charged if the response is lost.
  await assertProviderLock(token, "paying");
  await patchOrderFenced(order.id, token, {
    status: "paying",
    in_flight_since: new Date().toISOString(),
    pay_post_attempts: order.pay_post_attempts + 1,
    balance_before_usd: balanceBefore,
  });
  await recordEvent({
    workspaceId: order.workspace_id,
    orderId: order.id,
    type: "pay_submitted",
    detail: { expectedTotal: order.quoted_usd, basketIds: order.provider_basket_ids },
  });

  try {
    const result = await payBasket();
    return settlePaid(ctx, lines, {
      chargedUsd: result.chargedUsd ?? order.quoted_usd,
      estimated: result.chargedUsd === null,
    });
  } catch (error) {
    if (isUnknownOutcome(error)) {
      await recordEvent({
        workspaceId: order.workspace_id,
        orderId: order.id,
        type: "pay_unknown",
        detail: { error: error instanceof Error ? error.message : String(error) },
      });
      await releaseProviderLock(token);
      await patchOrder(order.id, { lock_token: null });
      await scheduleRetry(order.id, PAY_SETTLE_MS);
      return "yield";
    }

    if (error instanceof RixotError && error.code === "payment_failed") {
      // Deterministic: nothing was charged and the items are STILL in the
      // basket. Blocking the queue here is deliberate — the next order's
      // empty-basket check would otherwise quarantine the provider.
      await releaseProviderLock(token);
      await patchOrder(order.id, {
        status: "blocked_balance",
        lock_token: null,
        substate: "provider_declined",
        last_error: error.message.slice(0, 500),
        lease_until: null,
        locked_by: null,
        next_attempt_at: new Date(Date.now() + 15 * 60_000).toISOString(),
      });
      await recordEvent({
        workspaceId: order.workspace_id,
        orderId: order.id,
        type: "pay_failed",
        detail: { reason: error.message },
      });
      await recordAudit({
        workspaceId: order.workspace_id,
        userId: null,
        action: "links.provider.payment_failed",
        entity: order.id,
        payload: { reason: error.message },
      });
      return "blocked";
    }

    // The items are in the basket and we did not pay. Do not fail the order:
    // failing would release credits for placements that still exist.
    return halt(
      order,
      `The provider refused payment: ${error instanceof Error ? error.message : "unknown"}`,
      true,
    );
  }
}

/**
 * Resolving an unknown pay call. The mirror image of the order case: an unknown
 * pay resolves by our items DISAPPEARING from the basket.
 */
async function resolveUnknownPay(ctx: Ctx, lines: LineRow[]): Promise<SliceResult> {
  const { order, token } = ctx;

  const waitedFor = order.in_flight_since
    ? Date.now() - new Date(order.in_flight_since).getTime()
    : Number.POSITIVE_INFINITY;
  if (waitedFor < PAY_SETTLE_MS) {
    await releaseProviderLock(token);
    await patchOrder(order.id, { lock_token: null });
    await scheduleRetry(order.id, PAY_SETTLE_MS - waitedFor);
    return "yield";
  }

  const basket = await getBasket();
  const ours = new Set(order.provider_basket_ids);
  const stillPresent = basket.filter(
    (item) => item.basketId !== null && ours.has(item.basketId),
  ).length;

  if (stillPresent === ours.size) {
    await recordEvent({
      workspaceId: order.workspace_id,
      orderId: order.id,
      type: "basket_reconciled",
      detail: { outcome: "pay_did_not_land" },
    });
    if (order.pay_post_attempts >= 3) {
      return halt(order, "The pay call could not be completed after three attempts.", true);
    }
    const balance = await getBalance();
    return payForBasket(ctx, lines, balance);
  }

  if (stillPresent === 0) {
    // It landed. Reconstruct the charge from the balance delta, but never bill
    // the customer against it: the shared account means another cycle may have
    // spent in between, so the estimate is not trustworthy money.
    const balanceNow = await getBalance();
    const estimated =
      order.balance_before_usd === null
        ? order.quoted_usd
        : Math.round((order.balance_before_usd - balanceNow) * 100) / 100;
    const drifted = Math.abs(estimated - order.quoted_usd) >= 0.01;

    await recordEvent({
      workspaceId: order.workspace_id,
      orderId: order.id,
      type: "basket_reconciled",
      detail: { outcome: "pay_landed", estimatedCharge: estimated, drifted },
    });
    return settlePaid(ctx, lines, {
      chargedUsd: estimated,
      estimated: true,
      flagOperator: drifted,
    });
  }

  // The provider documents payment as all-or-nothing, so a partial basket here
  // contradicts the contract. Never guess about money.
  return halt(order, "The provider basket is in a state the pay call should not produce.", true);
}

async function settlePaid(
  ctx: Ctx,
  lines: LineRow[],
  charge: { chargedUsd: number; estimated: boolean; flagOperator?: boolean },
): Promise<SliceResult> {
  const { order, token } = ctx;
  const paidAt = new Date();
  const giveUpAt = new Date(paidAt.getTime() + GIVE_UP_DAYS * 86_400_000);

  await patchOrderFenced(order.id, token, {
    status: "paid",
    in_flight_since: null,
    paid_at: paidAt.toISOString(),
    provider_charged_usd: charge.chargedUsd,
    charged_is_estimated: charge.estimated,
    substate: null,
    needs_operator: charge.flagOperator === true,
    operator_note: charge.flagOperator
      ? "The amount charged was reconstructed from a balance delta and did not match the quote."
      : order.operator_note,
  });

  await recordEvent({
    workspaceId: order.workspace_id,
    orderId: order.id,
    type: "pay_confirmed",
    detail: { chargedUsd: charge.chargedUsd, estimated: charge.estimated },
  });

  // Credits are captured at payment, not at publication: this is when Mellox's
  // real money left. Always against the quote, never the estimate.
  let captured = 0;
  for (const line of lines) {
    if (line.settled !== "open") continue;
    const result = await captureLine({
      workspaceId: order.workspace_id,
      orderId: order.id,
      lineId: line.id,
      credits: line.credits_price,
    });
    if (result.ok) {
      captured += line.credits_price;
      await patchLine(line.id, {
        status: "awaiting_publication",
        settled: "captured",
        give_up_at: giveUpAt.toISOString(),
      });
    }
  }

  await patchOrder(order.id, {
    credits_captured: order.credits_captured + captured,
    status: "publishing",
    lease_until: null,
    locked_by: null,
    next_attempt_at: null,
  });
  await recordEvent({
    workspaceId: order.workspace_id,
    orderId: order.id,
    type: "credits_captured",
    detail: { credits: captured },
  });
  await recordAudit({
    workspaceId: order.workspace_id,
    userId: null,
    action: "links.order.paid",
    entity: order.id,
    payload: { chargedUsd: charge.chargedUsd, estimated: charge.estimated, credits: captured },
  });

  // The basket is empty again; the next order may start.
  await releaseProviderLock(token);
  await patchOrder(order.id, { lock_token: null });
  return "done";
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Advances one claimed order by one slice. The caller has already claimed the
 * order's worker lease; this acquires the GLOBAL provider lock on top of it.
 */
export async function advanceOrder(order: OrderRow): Promise<SliceResult> {
  const worker = workerId();

  if (order.status === "blocked_balance") {
    // Retried on a slow schedule from preflight; nothing to do until then.
    await scheduleRetry(order.id, 15 * 60_000);
    return "blocked";
  }

  const lock = await acquireProviderLock({ holder: worker, orderId: order.id });
  if (!lock.ok) {
    if (lock.code === "quarantined") {
      await patchOrder(order.id, {
        status: "awaiting_lock",
        substate: "provider_quarantined",
        lease_until: null,
        locked_by: null,
        next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      });
      return "blocked";
    }
    // Busy: someone else owns the basket. Jittered so ticks do not sync up.
    const delay = 15_000 + Math.floor(Math.random() * 30_000);
    await patchOrder(order.id, { status: "awaiting_lock", lock_token: null });
    await scheduleRetry(order.id, delay);
    return "yield";
  }

  const token = lock.token;

  try {
    await patchOrder(order.id, { lock_token: token, locked_by: worker });
    await recordEvent({
      workspaceId: order.workspace_id,
      orderId: order.id,
      type: "lock_acquired",
      detail: { worker, takeover: lock.takeover },
    });

    // A takeover always reconciles before it writes. If the dead process was
    // mid-cycle on a DIFFERENT order, that order owns the basket and must be
    // resolved first — preflight's verdict handles exactly this.
    const fresh = await loadOrder(order.id);
    if (!fresh) {
      await releaseProviderLock(token);
      return "done";
    }
    const lines = await loadLines(fresh.id);
    if (lines.length === 0) {
      return fail(fresh, "empty_order", "That order has no placements.", token);
    }

    const ctx: Ctx = { order: fresh, token, worker };

    switch (fresh.status) {
      case "queued":
      case "awaiting_lock":
      case "preflight":
        return await runPreflight(ctx, lines);
      case "ordering":
        return await resolveUnknownOrder(ctx, lines);
      case "ordered":
        return await verifyAndPay(ctx, lines);
      case "paying":
        return await resolveUnknownPay(ctx, lines);
      default:
        await releaseProviderLock(token);
        await patchOrder(fresh.id, { lock_token: null, lease_until: null, locked_by: null });
        return "done";
    }
  } catch (error) {
    if (error instanceof ProviderLockLostError) {
      // Another process owns this cycle now. Write nothing.
      return "yield";
    }
    await releaseProviderLock(token);
    await patchOrder(order.id, {
      lock_token: null,
      last_error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
      lease_until: null,
      locked_by: null,
      next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
    });
    return "yield";
  }
}
