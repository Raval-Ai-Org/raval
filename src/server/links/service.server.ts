// The user-facing half of the link marketplace: building a cart, preparing the
// article brief, and the checkout that hands an order to the runner.
//
// Checkout is the only place a user's credits are committed, and it commits
// them BEFORE the order can be claimed. There is no path from a browser to the
// provider that skips the hold.
import "server-only";

import { after } from "next/server";
import { randomUUID } from "node:crypto";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HttpError } from "@/server/http-error";
import { recordAudit } from "@/server/audit.server";
import { assertPublicUrl, SsrfBlockedError } from "@/server/safe-fetch";
import { claudeJsonPrompt, selectClaudeModel } from "@/lib/anthropic-gateway.server";
import { checkBudget } from "@/server/ai/budget";
import { readBrandDna } from "@/server/workspaces/brand-dna.server";
import { quoteLines, roundUsd } from "@/lib/links/pricing";
import { getArticlePrompt, rixotConfigured } from "./rixot/client.server";
import {
  holdForOrder,
  getBalance as creditBalance,
  maxOrderUsd,
  pricingConfig,
  refundCeilingReached,
} from "./credits.server";
import { advanceOrder } from "./order-runner.server";
import { pollProviderLinks, runGiveUpSweep, runVerificationSweep } from "./links-poller.server";
import { FRESH_HOURS } from "./catalog.server";
import { loadLines, loadOrder, patchOrder, recordEvent, type OrderRow } from "./store.server";

/** Placements in one order. Small on purpose: one basket cycle buys them all. */
export const MAX_LINES = 20;

// ── Campaign ────────────────────────────────────────────────────────────────

/**
 * A bought placement still belongs to a campaign, so it shows up in the same
 * counts as everything else. Reuses the workspace's active campaign rather than
 * spawning one per order.
 */
async function ensureCampaign(args: {
  workspaceId: string;
  userId: string;
  siteHost: string | null;
}): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from("backlink_campaigns")
    .select("id")
    .eq("workspace_id", args.workspaceId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) return existing.id;

  const { data, error } = await supabaseAdmin
    .from("backlink_campaigns")
    .insert({
      workspace_id: args.workspaceId,
      name: args.siteHost ? `Links for ${args.siteHost}` : "Link building",
      goal: "authority",
      target_count: 20,
      site_host: args.siteHost,
      created_by: args.userId,
    })
    .select("id")
    .single();

  if (error || !data) throw new HttpError(500, "We couldn't start a campaign.");
  return data.id;
}

export async function workspaceSite(workspaceId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("workspaces")
    .select("domain, website_url")
    .eq("id", workspaceId)
    .maybeSingle();
  const raw = data?.domain ?? data?.website_url ?? null;
  if (!raw) return null;
  try {
    return new URL(raw.startsWith("http") ? raw : `https://${raw}`).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return raw.toLowerCase().replace(/^www\./, "");
  }
}

// ── Article brief ───────────────────────────────────────────────────────────

const BRIEF_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["angle", "brief"],
  additionalProperties: false,
  properties: {
    angle: { type: "string", maxLength: 200 },
    brief: { type: "string", maxLength: 1600 },
  },
};

const BRIEF_SYSTEM = `You write the brief that another service will use to write one
article. The article will carry exactly one link to the brand's page.

Rules:
- Use ONLY the brand facts supplied. Never invent statistics, customer numbers,
  awards, prices, or quotes. If a fact is not supplied, do not use it.
- The brief tells the writer the angle, who the reader is, the tone, and two or
  three points worth covering. It is instructions, not the article.
- The article must read as something the host site would publish anyway. Say so:
  no sales pitch, no repeated keyword, no list of the brand's features.
- Never write a URL and never write the link text — those are inserted
  separately and must not appear in the brief.
- Plain language. Under 200 words.`;

export type ArticleBrief = { angle: string; brief: string; providerPrompt: string };

/**
 * Builds the brief Mellox sends with the order, from Brand DNA plus the
 * provider's own base prompt.
 *
 * The provider writes the article; Mellox only steers it. That boundary is
 * deliberate — the provider owns the publishing requirements, so overriding its
 * formatting rules would break the placement.
 */
export async function prepareBrief(args: {
  workspaceId: string;
  targetUrl: string;
  keyword: string;
  language?: string;
  extraGuidance?: string | null;
}): Promise<ArticleBrief> {
  const providerPrompt = await getArticlePrompt({
    keyword: args.keyword,
    targetUrl: args.targetUrl,
    language: args.language ?? "en",
  }).catch(() => ({ defaultPrompt: "", editableField: "recommendations" }));

  const [workspace, dna] = await Promise.all([
    supabaseAdmin
      .from("workspaces")
      .select("name, industry, audience")
      .eq("id", args.workspaceId)
      .maybeSingle(),
    readBrandDna(supabaseAdmin, args.workspaceId).catch(() => null),
  ]);

  const stored = (dna?.dna ?? {}) as Record<string, unknown>;
  const pick = (key: string): string => {
    const value = stored[key];
    return typeof value === "string" ? value.slice(0, 500) : "";
  };

  const facts = [
    `Brand: ${workspace.data?.name ?? "(not set)"}`,
    pick("industry") || workspace.data?.industry
      ? `Industry: ${pick("industry") || workspace.data?.industry}`
      : null,
    pick("audience") || workspace.data?.audience
      ? `Audience: ${pick("audience") || workspace.data?.audience}`
      : null,
    pick("voice") ? `Voice: ${pick("voice")}` : null,
    pick("positioning") ? `Positioning: ${pick("positioning")}` : null,
    `The article links to: ${args.targetUrl}`,
    `Link text: ${args.keyword}`,
    args.extraGuidance ? `The user also asked for: ${args.extraGuidance}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const budget = await checkBudget("text", { workspaceId: args.workspaceId });
  const fallback: ArticleBrief = {
    angle: `A useful piece about ${args.keyword}`,
    brief: `Write a genuinely useful article about ${args.keyword} for this site's usual readers. Mention the linked page once, naturally, where it actually helps the reader. No sales pitch and no repeated keyword.${args.extraGuidance ? ` ${args.extraGuidance}` : ""}`,
    providerPrompt: providerPrompt.defaultPrompt,
  };
  if (budget.mode === "block") return fallback;

  const result = await claudeJsonPrompt<{ angle: string; brief: string } | null>({
    route: "links-article-brief",
    model: selectClaudeModel("default"),
    maxTokens: 900,
    effort: "low",
    timeoutMs: 45_000,
    outputSchema: BRIEF_SCHEMA,
    fallback: null,
    system: BRIEF_SYSTEM,
    user: facts,
  });

  if (!result?.brief) return fallback;
  return { angle: result.angle, brief: result.brief, providerPrompt: providerPrompt.defaultPrompt };
}

// ── Cart ────────────────────────────────────────────────────────────────────

export type CartInput = {
  workspaceId: string;
  userId: string;
  targetUrl: string;
  keyword: string;
  donorIds: number[];
  language?: string;
  recommendations?: string | null;
};

/**
 * Creates or replaces the workspace's draft order. Prices are snapshotted here
 * from the catalog mirror, and re-checked again at checkout.
 */
export async function saveCart(
  input: CartInput,
): Promise<{ orderId: string; credits: number; providerUsd: number }> {
  if (!rixotConfigured()) throw new HttpError(503, "Link buying is not available right now.");
  if (input.donorIds.length === 0) throw new HttpError(400, "Pick at least one website.");
  if (input.donorIds.length > MAX_LINES) {
    throw new HttpError(400, `You can buy up to ${MAX_LINES} placements at a time.`);
  }

  try {
    assertPublicUrl(input.targetUrl);
  } catch (error) {
    if (error instanceof SsrfBlockedError) {
      throw new HttpError(400, "That page address cannot be reached publicly.");
    }
    throw new HttpError(400, "That page address is not valid.");
  }

  const freshSince = new Date(Date.now() - FRESH_HOURS * 3600_000).toISOString();
  const { data: donors } = await supabaseAdmin
    .from("rixot_donors")
    .select("id, domain, price_usd")
    .in("id", input.donorIds)
    .is("delisted_at", null)
    .gte("last_seen_at", freshSince);

  const found = donors ?? [];
  if (found.length !== input.donorIds.length) {
    throw new HttpError(
      409,
      "Some of those websites are no longer available. Refresh and try again.",
    );
  }

  const config = pricingConfig();
  const quote = quoteLines(
    found.map((donor) => ({ donorId: Number(donor.id), providerUsd: Number(donor.price_usd) })),
    config,
  );

  if (quote.providerUsd > maxOrderUsd()) {
    throw new HttpError(400, "That order is larger than we allow in one go.");
  }

  const siteHost = await workspaceSite(input.workspaceId);
  const campaignId = await ensureCampaign({
    workspaceId: input.workspaceId,
    userId: input.userId,
    siteHost,
  });

  // One draft per workspace: a second cart would be a second basket cycle the
  // user did not ask for.
  const { data: draft } = await supabaseAdmin
    .from("link_orders")
    .select("id")
    .eq("workspace_id", input.workspaceId)
    .eq("status", "cart")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const orderPatch = {
    workspace_id: input.workspaceId,
    campaign_id: campaignId,
    target_url: input.targetUrl,
    keyword: input.keyword,
    language: input.language ?? "en",
    content_mode: input.recommendations ? "prompt" : "auto",
    recommendations: input.recommendations ?? null,
    status: "cart" as const,
    line_count: found.length,
    quoted_usd: quote.providerUsd,
    credit_rate: config.creditsPerUsd,
    created_by: input.userId,
  };

  let orderId: string;
  if (draft?.id) {
    orderId = draft.id;
    await patchOrder(orderId, orderPatch);
    await supabaseAdmin.from("link_order_lines").delete().eq("order_id", orderId);
  } else {
    const { data, error } = await supabaseAdmin
      .from("link_orders")
      .insert({ ...orderPatch, idempotency_key: randomUUID() })
      .select("id")
      .single();
    if (error || !data) throw new HttpError(500, "We couldn't save that selection.");
    orderId = data.id;
  }

  const byId = new Map(found.map((donor) => [Number(donor.id), donor]));
  const { error: linesError } = await supabaseAdmin.from("link_order_lines").insert(
    quote.lines.map((line) => ({
      workspace_id: input.workspaceId,
      order_id: orderId,
      donor_id: line.donorId,
      donor_domain: String(byId.get(line.donorId)?.domain ?? ""),
      unit_price_usd: line.providerUsd,
      credits_price: line.credits,
      status: "pending",
    })),
  );
  if (linesError) throw new HttpError(500, "We couldn't save that selection.");

  await recordEvent({
    workspaceId: input.workspaceId,
    orderId,
    type: "cart_changed",
    detail: { donorIds: input.donorIds, credits: quote.credits },
    actor: input.userId,
  });

  return { orderId, credits: quote.credits, providerUsd: quote.providerUsd };
}

// ── Checkout ────────────────────────────────────────────────────────────────

export type CheckoutResult = { orderId: string; credits: number; remaining: number };

/**
 * Commits the user's credits and queues the order.
 *
 * Everything that could still say "no" happens before the hold: the re-quote,
 * the ceiling, the refund ceiling. Once the hold succeeds the order is the
 * runner's problem, and the runner never spends without a hold in place.
 */
export async function checkout(args: {
  workspaceId: string;
  userId: string;
  orderId: string;
  expectedCredits: number;
}): Promise<CheckoutResult> {
  const order = await loadOrder(args.orderId);
  if (!order || order.workspace_id !== args.workspaceId) {
    throw new HttpError(404, "That order no longer exists.");
  }
  if (order.status !== "cart") {
    // Re-submitting a confirmed checkout is a no-op, not a second charge.
    if (order.credits_held > 0) {
      const balance = await creditBalance(args.workspaceId);
      return { orderId: order.id, credits: order.credits_held, remaining: balance.available };
    }
    throw new HttpError(409, "That order has already been placed.");
  }

  if (await refundCeilingReached()) {
    throw new HttpError(
      503,
      "Link buying is paused while we look into a problem. Nothing was charged.",
    );
  }

  const lines = await loadLines(order.id);
  if (lines.length === 0) throw new HttpError(400, "Pick at least one website.");

  // Re-quote against the catalog: a price that moved or a site that went away
  // sends the user back to confirm rather than silently charging a new amount.
  const freshSince = new Date(Date.now() - FRESH_HOURS * 3600_000).toISOString();
  const { data: donors } = await supabaseAdmin
    .from("rixot_donors")
    .select("id, price_usd")
    .in(
      "id",
      lines.map((line) => line.donor_id),
    )
    .is("delisted_at", null)
    .gte("last_seen_at", freshSince);

  const priceById = new Map((donors ?? []).map((d) => [Number(d.id), Number(d.price_usd)]));
  if (priceById.size !== lines.length) {
    throw new HttpError(
      409,
      "Some of those websites are no longer available. Refresh and try again.",
    );
  }
  for (const line of lines) {
    const current = priceById.get(line.donor_id);
    if (current === undefined || Math.abs(current - line.unit_price_usd) >= 0.005) {
      throw new HttpError(
        409,
        "Prices changed while you were deciding. Have another look before you buy.",
      );
    }
  }

  const config = pricingConfig();
  const credits = lines.reduce((sum, line) => sum + line.credits_price, 0);
  const providerUsd = roundUsd(lines.reduce((sum, line) => sum + line.unit_price_usd, 0));

  // The browser's number is checked, never trusted. A mismatch means the cart
  // changed under the user and they must see the new total first.
  if (args.expectedCredits !== credits) {
    throw new HttpError(409, "The total changed. Have another look before you buy.");
  }
  if (providerUsd > maxOrderUsd()) {
    throw new HttpError(400, "That order is larger than we allow in one go.");
  }

  const hold = await holdForOrder({
    workspaceId: args.workspaceId,
    orderId: order.id,
    credits,
    actor: args.userId,
  });

  if (!hold.ok) {
    if (hold.code === "insufficient") {
      throw new HttpError(402, "You don't have enough credits for this yet.");
    }
    throw new HttpError(500, hold.reason);
  }

  await patchOrder(order.id, {
    status: "queued",
    credits_held: credits,
    credit_rate: config.creditsPerUsd,
    quoted_usd: providerUsd,
    checkout_at: new Date().toISOString(),
    next_attempt_at: null,
  });

  await recordEvent({
    workspaceId: args.workspaceId,
    orderId: order.id,
    type: "checkout",
    detail: { credits, providerUsd, lines: lines.length },
    actor: args.userId,
  });
  await recordEvent({
    workspaceId: args.workspaceId,
    orderId: order.id,
    type: "credits_held",
    detail: { credits },
    actor: args.userId,
  });
  await recordAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    action: "links.order.checkout",
    entity: order.id,
    payload: { credits, providerUsd, lines: lines.length },
  });

  kickOrder(order.id);
  return { orderId: order.id, credits, remaining: hold.available };
}

export async function cancelDraft(args: {
  workspaceId: string;
  userId: string;
  orderId: string;
}): Promise<void> {
  const order = await loadOrder(args.orderId);
  if (!order || order.workspace_id !== args.workspaceId) {
    throw new HttpError(404, "That order no longer exists.");
  }
  // Only a draft can be cancelled from a browser. Once credits are held the
  // runner owns the order, and cancelling mid-cycle could strand a basket.
  if (order.status !== "cart") {
    throw new HttpError(409, "That order is already on its way and can't be cancelled.");
  }

  await patchOrder(order.id, { status: "cancelled", settled_at: new Date().toISOString() });
  await recordEvent({
    workspaceId: args.workspaceId,
    orderId: order.id,
    type: "cancelled",
    detail: {},
    actor: args.userId,
  });
}

// ── Runner drivers ──────────────────────────────────────────────────────────

/** Advances an order right after the request that created it, then hands off. */
export function kickOrder(orderId: string): void {
  after(async () => {
    try {
      const { data } = await supabaseAdmin.rpc("claim_link_orders", {
        p_worker: `kick-${process.pid}`,
        p_max: 1,
        p_lease_seconds: 180,
        p_order_id: orderId,
      });
      const claimed = (data as OrderRow[] | null) ?? [];
      if (claimed.length > 0) await advanceOrder(claimed[0]);
    } catch (error) {
      console.error("[links] kick failed", error);
    }
  });
}

export type TickResult = {
  advanced: number;
  poll: Awaited<ReturnType<typeof pollProviderLinks>> | null;
  verified: Awaited<ReturnType<typeof runVerificationSweep>> | null;
  refunded: number;
};

/**
 * One cron tick. Deliberately sequential on orders: the provider basket is
 * global, so a second concurrent cycle could only ever be refused by the lock.
 */
export async function runDueOrders(options: { budgetMs?: number } = {}): Promise<TickResult> {
  const deadline = Date.now() + (options.budgetMs ?? 55_000);
  const result: TickResult = { advanced: 0, poll: null, verified: null, refunded: 0 };

  while (Date.now() < deadline - 20_000) {
    const { data, error } = await supabaseAdmin.rpc("claim_link_orders", {
      p_worker: `cron-${process.pid}`,
      p_max: 1,
      p_lease_seconds: 180,
      p_order_id: undefined,
    });
    if (error) break;

    const claimed = (data as OrderRow[] | null) ?? [];
    if (claimed.length === 0) break;

    const outcome = await advanceOrder(claimed[0]);
    result.advanced += 1;
    // A yield or a block means waiting is the right move, not looping harder.
    if (outcome !== "done") break;
  }

  if (Date.now() < deadline - 10_000) {
    try {
      result.poll = await pollProviderLinks();
    } catch (error) {
      console.error("[links] poll failed", error);
    }
  }
  if (Date.now() < deadline - 5_000) {
    try {
      result.verified = await runVerificationSweep(10);
      result.refunded = await runGiveUpSweep(10);
    } catch (error) {
      console.error("[links] sweep failed", error);
    }
  }

  return result;
}
