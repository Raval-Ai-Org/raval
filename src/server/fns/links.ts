// Server functions for the link marketplace.
//
// Reads go through the caller's RLS client, so a member only ever sees their
// own workspace's rows. Writes check the role first and then dynamically import
// the server module, which keeps the provider credential out of the read path
// and out of the client bundle.
import "server-only";
import { z } from "zod";

import { createServerFn } from "@/server/server-fn";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rateLimitFor } from "@/server/rate-limit";
import { requireWorkspaceRole } from "@/server/workspace-access.server";
import type { ServerFnContext } from "@/server/server-fn";
import { creditsToUsd } from "@/lib/links/pricing";
import { QUALITY_LABELS } from "@/lib/links/rank";

const uuid = z.string().uuid();
const url = z.string().min(8).max(2048);

function requireEditor(context: ServerFnContext, workspaceId: string) {
  return requireWorkspaceRole(context, workspaceId, "editor");
}
function requireViewer(context: ServerFnContext, workspaceId: string) {
  return requireWorkspaceRole(context, workspaceId, "viewer");
}

// Single string literals, not concatenations: PostgREST infers the row type
// from the literal, and a `+` would widen it to plain `string`.
// prettier-ignore
const ORDER_COLS = "id, target_url, keyword, status, substate, line_count, quoted_usd, credits_held, credits_captured, credits_refunded, needs_operator, created_at, checkout_at, paid_at, settled_at, last_error";

// prettier-ignore
const LINE_COLS = "id, order_id, donor_domain, unit_price_usd, credits_price, status, published_url, published_at, attribution, verification, verified_at, first_live_at, lost_at, give_up_at, settled, created_at";

export type OpportunityView = {
  donorId: number;
  domain: string;
  credits: number;
  /** What this placement costs the customer, in dollars. */
  usd: number;
  quality: string;
  qualityLabel: string;
  authority: number | null;
  referringDomains: number | null;
  rankingKeywords: number | null;
  category: string | null;
  samplePage: string | null;
  /** Mellox's own read of the site, or null when it could not form one. */
  topic: { summary: string; fit: string; verdict: string; basis: string } | null;
};

export type OrderView = {
  id: string;
  targetUrl: string;
  keyword: string;
  status: string;
  substate: string | null;
  lineCount: number;
  credits: number;
  /** What the customer is paying, in dollars. */
  usd: number;
  refundedUsd: number;
  needsOperator: boolean;
  createdAt: string;
  checkoutAt: string | null;
  paidAt: string | null;
  settledAt: string | null;
};

export type PlacementView = {
  id: string;
  orderId: string;
  domain: string;
  credits: number;
  usd: number;
  status: string;
  publishedUrl: string | null;
  publishedAt: string | null;
  /** "ambiguous" is surfaced, not smoothed over. */
  attribution: string;
  verification: string;
  verifiedAt: string | null;
  firstLiveAt: string | null;
  lostAt: string | null;
  refunded: boolean;
};

/** Everything the Backlink Growth surface needs for its opening state. */
export const getOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, rateLimitFor("links-browse")])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const role = await requireViewer(context, data.workspaceId);
    const db = context.supabase;

    const { workspaceSite } = await import("@/server/links/service.server");
    const { CREDIT_PACKS, stripeConfigured } = await import("@/server/billing/stripe.server");

    const [balance, orders, lines, catalog, siteHost] = await Promise.all([
      db
        .from("workspace_credit_balances")
        .select("available, held, lifetime_topped_up, lifetime_spent")
        .eq("workspace_id", data.workspaceId)
        .maybeSingle(),
      db
        .from("link_orders")
        .select(ORDER_COLS)
        .eq("workspace_id", data.workspaceId)
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
        .limit(50),
      db
        .from("link_order_lines")
        .select(LINE_COLS)
        .eq("workspace_id", data.workspaceId)
        .order("created_at", { ascending: false })
        .limit(300),
      db.from("rixot_donors").select("id", { count: "exact", head: true }),
      workspaceSite(data.workspaceId),
    ]);

    const orderRows = orders.data ?? [];
    const lineRows = lines.data ?? [];

    const cart = orderRows.find((order) => order.status === "cart") ?? null;
    const active = orderRows.filter((order) =>
      [
        "queued",
        "awaiting_lock",
        "preflight",
        "ordering",
        "ordered",
        "paying",
        "paid",
        "publishing",
        "blocked_balance",
        "needs_operator",
      ].includes(order.status),
    );

    const live = lineRows.filter((line) => line.status === "live");
    const pending = lineRows.filter((line) =>
      ["pending", "in_basket", "paid", "awaiting_publication", "published"].includes(line.status),
    );

    return {
      canEdit: role === "owner" || role === "admin" || role === "editor",
      // The packs come from the server so a price can never be set in a browser.
      packs: CREDIT_PACKS.map((pack) => ({
        id: pack.id,
        usd: pack.usd,
        valueUsd: pack.valueUsd,
        bonusUsd: Math.round((pack.valueUsd - pack.usd) * 100) / 100,
      })),
      // Whether a card payment can actually complete, so the UI can say so up
      // front rather than at the moment someone clicks Buy.
      billingEnabled: stripeConfigured(),
      catalogSize: catalog.count ?? 0,
      siteHost,
      // Balance is shown to people as money. Credits stay the ledger unit
      // underneath, converted here at the one rate the server owns.
      balance: {
        availableUsd: creditsToUsd(Number(balance.data?.available ?? 0)),
        heldUsd: creditsToUsd(Number(balance.data?.held ?? 0)),
        spentUsd: creditsToUsd(Number(balance.data?.lifetime_spent ?? 0)),
        availableCredits: Number(balance.data?.available ?? 0),
        heldCredits: Number(balance.data?.held ?? 0),
      },
      stats: {
        live: live.length,
        pending: pending.length,
        lost: lineRows.filter((line) => line.status === "lost").length,
        unconfirmed: lineRows.filter((line) => line.status === "unconfirmed").length,
        activeOrders: active.length,
      },
      cartOrderId: cart?.id ?? null,
      orders: orderRows.map(toOrderView),
      placements: lineRows.map(toPlacementView),
    };
  });

function toOrderView(row: Record<string, unknown>): OrderView {
  return {
    id: String(row.id),
    targetUrl: String(row.target_url ?? ""),
    keyword: String(row.keyword ?? ""),
    status: String(row.status),
    substate: (row.substate as string | null) ?? null,
    lineCount: Number(row.line_count ?? 0),
    credits: Number(row.credits_held ?? 0),
    usd: creditsToUsd(Number(row.credits_held ?? 0)),
    refundedUsd: creditsToUsd(Number(row.credits_refunded ?? 0)),
    needsOperator: row.needs_operator === true,
    createdAt: String(row.created_at),
    checkoutAt: (row.checkout_at as string | null) ?? null,
    paidAt: (row.paid_at as string | null) ?? null,
    settledAt: (row.settled_at as string | null) ?? null,
  };
}

function toPlacementView(row: Record<string, unknown>): PlacementView {
  return {
    id: String(row.id),
    orderId: String(row.order_id),
    domain: String(row.donor_domain ?? ""),
    credits: Number(row.credits_price ?? 0),
    usd: creditsToUsd(Number(row.credits_price ?? 0)),
    status: String(row.status),
    publishedUrl: (row.published_url as string | null) ?? null,
    publishedAt: (row.published_at as string | null) ?? null,
    attribution: String(row.attribution ?? "none"),
    verification: String(row.verification ?? "pending"),
    verifiedAt: (row.verified_at as string | null) ?? null,
    firstLiveAt: (row.first_live_at as string | null) ?? null,
    lostAt: (row.lost_at as string | null) ?? null,
    refunded: row.settled === "refunded",
  };
}

/**
 * Ranks the catalog for a target page and explains the shortlist. This is the
 * expensive call: it reads third-party pages and spends model calls, hence its
 * own tight rate-limit tier.
 */
export const findPlacements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("links-match")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        targetUrl: url,
        keyword: z.string().max(200).nullish(),
        maxPriceUsd: z.number().min(0).max(100000).optional(),
        minAuthority: z.number().int().min(0).max(100).optional(),
        search: z.string().max(120).optional(),
        limit: z.number().int().min(1).max(24).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireEditor(context, data.workspaceId);

    const [{ findOpportunities }, { workspaceSite }] = await Promise.all([
      import("@/server/links/match.server"),
      import("@/server/links/service.server"),
    ]);

    const ownDomain = await workspaceSite(data.workspaceId);
    const { opportunities: found, profile } = await findOpportunities({
      workspaceId: data.workspaceId,
      targetUrl: data.targetUrl,
      keyword: data.keyword ?? null,
      ownDomain,
      maxPriceUsd: data.maxPriceUsd,
      minAuthority: data.minAuthority,
      search: data.search,
      limit: data.limit ?? 24,
    });

    const placements: OpportunityView[] = found.map((item) => ({
      donorId: item.id,
      domain: item.domain,
      credits: item.credits,
      usd: creditsToUsd(item.credits),
      quality: item.quality,
      qualityLabel: QUALITY_LABELS[item.quality],
      authority: item.facts.authority,
      referringDomains: item.facts.referringDomains,
      rankingKeywords: item.facts.rankingKeywords,
      category: item.facts.category,
      samplePage: item.page,
      topic: item.topic
        ? {
            summary: item.topic.summary,
            fit: item.topic.fit,
            verdict: item.topic.verdict,
            basis: item.topic.basis,
          }
        : null,
    }));

    return { placements, ownDomain, keywords: profile.keywords };
  });

/**
 * Link text suggestions for a page, from Brand DNA and the page itself, so the
 * user starts with good words already filled in.
 */
export const suggestLinkText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("links-brief")])
  .inputValidator((data) => z.object({ workspaceId: uuid, targetUrl: url }).parse(data))
  .handler(async ({ data, context }) => {
    await requireEditor(context, data.workspaceId);
    const { buildLinkProfile } = await import("@/server/links/profile.server");
    const profile = await buildLinkProfile(data.workspaceId, data.targetUrl);
    return { keywords: profile.keywords, categories: profile.categories };
  });

/** Writes the article brief Mellox sends with the order. */
export const writeBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("links-brief")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        targetUrl: url,
        keyword: z.string().min(1).max(200),
        guidance: z.string().max(1000).nullish(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireEditor(context, data.workspaceId);
    const { prepareBrief } = await import("@/server/links/service.server");
    return prepareBrief({
      workspaceId: data.workspaceId,
      targetUrl: data.targetUrl,
      keyword: data.keyword,
      extraGuidance: data.guidance ?? null,
    });
  });

/** Creates or replaces the draft order. No money moves here. */
export const saveSelection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("links-browse")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        targetUrl: url,
        keyword: z.string().min(1).max(200),
        donorIds: z.array(z.number().int().positive()).min(1).max(20),
        recommendations: z.string().max(4000).nullish(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireEditor(context, data.workspaceId);
    const { saveCart } = await import("@/server/links/service.server");
    const saved = await saveCart({
      workspaceId: data.workspaceId,
      userId: context.userId,
      targetUrl: data.targetUrl,
      keyword: data.keyword,
      donorIds: data.donorIds,
      recommendations: data.recommendations ?? null,
    });
    return { ...saved, usd: creditsToUsd(saved.credits) };
  });

/** The order detail: lines plus the real timeline. */
export const getOrder = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, rateLimitFor("links-browse")])
  .inputValidator((data) => z.object({ workspaceId: uuid, orderId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await requireViewer(context, data.workspaceId);
    const db = context.supabase;

    const { data: order } = await db
      .from("link_orders")
      .select(ORDER_COLS)
      .eq("workspace_id", data.workspaceId)
      .eq("id", data.orderId)
      .maybeSingle();

    if (!order) return null;

    const [lines, events] = await Promise.all([
      db
        .from("link_order_lines")
        .select(LINE_COLS)
        .eq("order_id", data.orderId)
        .order("created_at", { ascending: true }),
      db
        .from("link_order_events")
        .select("id, type, detail, at")
        .eq("order_id", data.orderId)
        .order("at", { ascending: true })
        .limit(120),
    ]);

    return {
      order: toOrderView(order),
      placements: (lines.data ?? []).map(toPlacementView),
      timeline: (events.data ?? []).map((event) => ({
        id: String(event.id),
        type: String(event.type),
        at: String(event.at),
        detail: (event.detail ?? {}) as Record<string, unknown>,
      })),
    };
  });

/** Commits credits and starts the provider cycle. The only spending call. */
export const confirmOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("links-checkout")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        orderId: uuid,
        // Checked against the server's own total; a mismatch sends the user
        // back to look rather than charging a number they did not see.
        expectedCredits: z.number().int().min(1).max(10_000_000),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireEditor(context, data.workspaceId);
    const { checkout } = await import("@/server/links/service.server");
    const result = await checkout({
      workspaceId: data.workspaceId,
      userId: context.userId,
      orderId: data.orderId,
      expectedCredits: data.expectedCredits,
    });
    return {
      ...result,
      usd: creditsToUsd(result.credits),
      remainingUsd: creditsToUsd(result.remaining),
    };
  });

export const discardDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("links-browse")])
  .inputValidator((data) => z.object({ workspaceId: uuid, orderId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await requireEditor(context, data.workspaceId);
    const { cancelDraft } = await import("@/server/links/service.server");
    await cancelDraft({
      workspaceId: data.workspaceId,
      userId: context.userId,
      orderId: data.orderId,
    });
    return { ok: true as const };
  });

/** Re-checks one published placement on demand. */
export const recheckPlacement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("backlinks-verify")])
  .inputValidator((data) => z.object({ workspaceId: uuid, placementId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await requireEditor(context, data.workspaceId);
    const { recheckOne } = await import("@/server/links/recheck.server");
    return recheckOne({ workspaceId: data.workspaceId, lineId: data.placementId });
  });

/** The credit ledger, for the credits panel. */
export const getCreditHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, rateLimitFor("links-browse")])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await requireViewer(context, data.workspaceId);

    const { data: rows } = await context.supabase
      .from("workspace_credit_ledger")
      .select("id, kind, delta_available, delta_held, balance_after, reason, created_at")
      .eq("workspace_id", data.workspaceId)
      .order("created_at", { ascending: false })
      .limit(60);

    return (rows ?? []).map((row) => ({
      id: Number(row.id),
      kind: String(row.kind),
      deltaUsd: creditsToUsd(Number(row.delta_available ?? 0)),
      balanceAfterUsd: creditsToUsd(Number(row.balance_after ?? 0)),
      reason: (row.reason as string | null) ?? null,
      at: String(row.created_at),
    }));
  });
