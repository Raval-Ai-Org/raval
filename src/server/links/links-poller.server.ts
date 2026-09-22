// Finding out whether a placement we paid for actually went live, and staying
// honest about the cases where we cannot tell.
//
// The provider gives us one endpoint: the whole link list, with no cursor and
// no reference back to the order that created a row. So:
//
//   * "new" means "an id we have never recorded" — hence rixot_link_sightings.
//   * attribution is a match on (target url, keyword, donor domain, cost),
//     which is NOT a key. When two lines match equally the link is claimed as
//     `ambiguous`, and the word ambiguous reaches the user rather than being
//     smoothed over.
//   * a line that never appears is refunded and reported as unconfirmed. It is
//     never quietly marked live.
//
// Nothing here promotes a line to `live`. Only the verification engine does
// that, from Mellox's own fetch of the published page.
import "server-only";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { recordAudit } from "@/server/audit.server";
import { verifyUrl } from "@/server/backlinks/verify.server";
import { listLinks, rixotConfigured, type ProviderLink } from "./rixot/client.server";
import { refundLine } from "./credits.server";
import { loadOrder, patchLine, patchOrder, recordEvent, type LineRow } from "./store.server";

/** Re-check ladder after a link is first seen. */
const RECHECK_STEPS_MS = [3600_000, 86_400_000, 7 * 86_400_000];
/** After 90 days of weekly checks, monthly is enough. */
const MONTHLY_MS = 30 * 86_400_000;

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function normalizeUrl(url: string | null): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return `${parsed.hostname.toLowerCase().replace(/^www\./, "")}${parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

type Candidate = LineRow & { target_url: string; keyword: string };

async function awaitingLines(): Promise<Candidate[]> {
  const { data } = await supabaseAdmin
    .from("link_order_lines")
    .select(
      "id, workspace_id, order_id, donor_id, donor_domain, unit_price_usd, credits_price, status, provider_order_content_id, provider_basket_id, provider_link_id, published_url, published_at, provider_cost_usd, attribution, attribution_detail, opportunity_id, verification, verified_at, first_live_at, lost_at, consecutive_missing, next_check_at, give_up_at, settled, created_at, updated_at, link_orders!inner(target_url, keyword)",
    )
    .eq("status", "awaiting_publication")
    .order("created_at", { ascending: true })
    .limit(200);

  return (data ?? []).map((row) => {
    const parent = row.link_orders as unknown as { target_url: string; keyword: string };
    const { link_orders: _ignored, ...line } = row as Record<string, unknown>;
    return {
      ...(line as unknown as LineRow),
      target_url: parent.target_url,
      keyword: parent.keyword,
    };
  });
}

type Attribution = { line: Candidate; method: "heuristic" | "ambiguous" };

/**
 * Picks the line a newly seen link belongs to.
 *
 * A unique match on all four fields is as certain as this provider allows. Two
 * equal matches happen when two workspaces buy the same donor for the same page
 * with the same anchor; the tiebreak below is a guess, and it is labelled one.
 */
function attribute(link: ProviderLink, candidates: Candidate[]): Attribution | null {
  const publishedHost = hostOf(link.publishedUrl);
  const matches = candidates.filter((line) => {
    if (normalizeUrl(link.targetUrl) !== normalizeUrl(line.target_url)) return false;
    if ((link.keyword ?? "").trim() !== line.keyword.trim()) return false;
    if (link.costUsd !== null && Math.abs(link.costUsd - line.unit_price_usd) >= 0.005) {
      return false;
    }
    return true;
  });

  if (matches.length === 0) return null;

  // Prefer a candidate whose donor domain matches where it was actually
  // published. A donor often publishes on a subdomain, so a mismatch is not
  // disqualifying on its own — it is recorded instead.
  const onDomain = matches.filter(
    (line) =>
      publishedHost !== null &&
      (publishedHost === line.donor_domain.replace(/^www\./, "") ||
        publishedHost.endsWith(`.${line.donor_domain.replace(/^www\./, "")}`)),
  );

  if (onDomain.length === 1) return { line: onDomain[0], method: "heuristic" };
  if (matches.length === 1) return { line: matches[0], method: "heuristic" };

  const pool = onDomain.length > 1 ? onDomain : matches;
  const oldest = [...pool].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  return { line: oldest, method: "ambiguous" };
}

/**
 * Creates the backlink_opportunities row a bought placement shares with the
 * rest of the product, so the timeline, the verification history and the
 * campaign counts all work without a second vocabulary.
 */
async function ensureOpportunity(line: Candidate, publishedUrl: string): Promise<string | null> {
  if (line.opportunity_id) return line.opportunity_id;

  const order = await loadOrder(line.order_id);
  if (!order?.campaign_id) return null;

  const { data, error } = await supabaseAdmin
    .from("backlink_opportunities")
    .upsert(
      {
        workspace_id: line.workspace_id,
        campaign_id: order.campaign_id,
        source_domain: line.donor_domain,
        source_url: publishedUrl,
        kind: "paid_placement",
        method: "paid_placement",
        status: "published",
        target_url: order.target_url,
        suggested_anchor: order.keyword,
        evidence: { boughtFrom: "marketplace", lineId: line.id },
      },
      { onConflict: "workspace_id,campaign_id,source_domain,kind" },
    )
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[links] opportunity upsert failed", error.message);
    return null;
  }
  return data?.id ?? null;
}

async function claim(link: ProviderLink, found: Attribution): Promise<boolean> {
  const { line, method } = found;
  if (!link.publishedUrl) return false;

  const opportunityId = await ensureOpportunity(line, link.publishedUrl);

  // Compare-and-set: the partial unique index on provider_link_id means only
  // one tick can ever win this, so a concurrent poll cannot double-claim.
  const { data, error } = await supabaseAdmin
    .from("link_order_lines")
    .update({
      provider_link_id: link.id,
      published_url: link.publishedUrl,
      published_at: new Date().toISOString(),
      provider_cost_usd: link.costUsd,
      attribution: method,
      attribution_detail: {
        matchedOn: ["target_url", "keyword", "cost"],
        publishedHost: hostOf(link.publishedUrl),
        donorDomain: line.donor_domain,
        hostMatchesDonor: hostOf(link.publishedUrl) === line.donor_domain.replace(/^www\./, ""),
        providerStatus: link.status,
      },
      opportunity_id: opportunityId,
      status: "published",
      next_check_at: new Date().toISOString(),
    })
    .eq("id", line.id)
    .is("provider_link_id", null)
    .select("id");

  if (error || !data || data.length === 0) return false;

  await supabaseAdmin
    .from("rixot_link_sightings")
    .update({
      claimed_by: line.id,
      claimed_at: new Date().toISOString(),
      claim_method: method,
      unclaimed_reason: null,
    })
    .eq("link_id", link.id);

  await recordEvent({
    workspaceId: line.workspace_id,
    orderId: line.order_id,
    lineId: line.id,
    type: "link_attributed",
    detail: { publishedUrl: link.publishedUrl, method, providerLinkId: link.id },
  });

  return true;
}

export type PollResult = {
  seen: number;
  newLinks: number;
  claimed: number;
  ambiguous: number;
  unclaimed: number;
};

/**
 * One pass over the provider's link list. Cheap and global, so it runs once per
 * tick rather than once per order.
 */
export async function pollProviderLinks(): Promise<PollResult> {
  if (!rixotConfigured()) {
    return { seen: 0, newLinks: 0, claimed: 0, ambiguous: 0, unclaimed: 0 };
  }

  const links = await listLinks();
  if (links.length === 0) {
    return { seen: 0, newLinks: 0, claimed: 0, ambiguous: 0, unclaimed: 0 };
  }

  const { data: known } = await supabaseAdmin
    .from("rixot_link_sightings")
    .select("link_id")
    .in(
      "link_id",
      links.map((link) => link.id),
    );
  const seenIds = new Set((known ?? []).map((row) => Number(row.link_id)));

  const now = new Date().toISOString();
  const { error: upsertError } = await supabaseAdmin.from("rixot_link_sightings").upsert(
    links.map((link) => ({
      link_id: link.id,
      target_url: link.targetUrl,
      keyword: link.keyword,
      published_url: link.publishedUrl,
      published_host: hostOf(link.publishedUrl),
      status: link.status,
      cost_usd: link.costUsd,
      raw: link.raw as Json,
      last_seen_at: now,
    })),
    { onConflict: "link_id" },
  );
  if (upsertError) console.error("[links] sighting upsert failed", upsertError.message);

  const fresh = links.filter((link) => !seenIds.has(link.id) && link.publishedUrl);
  if (fresh.length === 0) {
    return { seen: links.length, newLinks: 0, claimed: 0, ambiguous: 0, unclaimed: 0 };
  }

  const candidates = await awaitingLines();
  let claimed = 0;
  let ambiguous = 0;
  let unclaimed = 0;

  for (const link of fresh) {
    const remaining = candidates.filter((line) => line.provider_link_id === null);
    const found = attribute(link, remaining);
    if (!found) {
      unclaimed += 1;
      await supabaseAdmin
        .from("rixot_link_sightings")
        .update({ unclaimed_reason: "no_candidate" })
        .eq("link_id", link.id);
      continue;
    }
    if (await claim(link, found)) {
      claimed += 1;
      if (found.method === "ambiguous") ambiguous += 1;
      found.line.provider_link_id = link.id;
    } else {
      unclaimed += 1;
    }
  }

  if (unclaimed > 0) {
    // A link nobody ordered, or one we cannot place, is worth an operator's
    // attention: it is provider money already spent.
    await recordAudit({
      workspaceId: candidates[0]?.workspace_id ?? "00000000-0000-0000-0000-000000000000",
      userId: null,
      action: "links.sighting.unclaimed",
      entity: "rixot_link_sightings",
      payload: { count: unclaimed },
    });
  }

  await settleFinishedOrders();
  return { seen: links.length, newLinks: fresh.length, claimed, ambiguous, unclaimed };
}

// ── Verification and monitoring ─────────────────────────────────────────────

function nextCheckAfter(line: LineRow): string {
  const firstSeen = line.published_at ? new Date(line.published_at).getTime() : Date.now();
  const age = Date.now() - firstSeen;
  for (const step of RECHECK_STEPS_MS) {
    if (age < step) return new Date(Date.now() + step - age).toISOString();
  }
  if (age < 90 * 86_400_000) return new Date(Date.now() + 7 * 86_400_000).toISOString();
  return new Date(Date.now() + MONTHLY_MS).toISOString();
}

export type VerifySweepResult = { checked: number; live: number; missing: number; lost: number };

/**
 * Re-checks published placements with Mellox's own fetch.
 *
 * The loss rule is deliberately slow: only a `missing` result counts against a
 * link, `unreachable` and `blocked` never do, and it takes two consecutive
 * misses at least a day apart before anything is called lost. A bot wall or a
 * CDN blip must not be reported to a customer as a link that disappeared.
 */
export async function runVerificationSweep(limit = 25): Promise<VerifySweepResult> {
  const { data } = await supabaseAdmin
    .from("link_order_lines")
    .select(
      "id, workspace_id, order_id, donor_domain, published_url, published_at, status, verification, consecutive_missing, first_live_at, lost_at, next_check_at, opportunity_id, link_orders!inner(target_url)",
    )
    .in("status", ["published", "live"])
    .not("published_url", "is", null)
    .lte("next_check_at", new Date().toISOString())
    .order("next_check_at", { ascending: true })
    .limit(limit);

  const rows = data ?? [];
  const result: VerifySweepResult = { checked: 0, live: 0, missing: 0, lost: 0 };

  for (const row of rows) {
    const parent = row.link_orders as unknown as { target_url: string };
    const line = row as unknown as LineRow;
    if (!line.published_url) continue;

    const outcome = await verifyUrl({
      urlFrom: line.published_url,
      expectedTarget: parent.target_url,
    });
    result.checked += 1;

    const isLive = outcome.result === "live" || outcome.result === "nofollow";
    const isMissing = outcome.result === "missing";

    if (line.opportunity_id) {
      await supabaseAdmin.from("backlink_verifications").insert({
        workspace_id: line.workspace_id,
        opportunity_id: line.opportunity_id,
        checked_url: line.published_url,
        expected_target: parent.target_url,
        result: outcome.result,
        http_status: outcome.httpStatus,
        link_found: outcome.linkFound,
        is_nofollow: outcome.isNofollow,
        anchor_found: outcome.anchorFound,
        error: outcome.error,
      });
    }

    const missStreak = isMissing ? line.consecutive_missing + 1 : 0;
    const wasLiveLongEnough =
      line.first_live_at !== null &&
      Date.now() - new Date(line.first_live_at).getTime() > 86_400_000;
    const nowLost = isMissing && missStreak >= 2 && wasLiveLongEnough;

    const patch: Record<string, unknown> = {
      verification: outcome.result,
      verified_at: new Date().toISOString(),
      consecutive_missing: missStreak,
      next_check_at: nowLost
        ? new Date(Date.now() + 86_400_000).toISOString()
        : nextCheckAfter(line),
    };

    if (isLive) {
      result.live += 1;
      patch.status = "live";
      if (!line.first_live_at) patch.first_live_at = new Date().toISOString();
      patch.lost_at = null;
    } else if (nowLost) {
      result.lost += 1;
      patch.status = "lost";
      patch.lost_at = new Date().toISOString();
      await recordEvent({
        workspaceId: line.workspace_id,
        orderId: line.order_id,
        lineId: line.id,
        type: "link_lost",
        detail: { publishedUrl: line.published_url, checks: missStreak },
      });
    } else if (isMissing) {
      result.missing += 1;
    }

    await patchLine(line.id, patch);

    if (line.opportunity_id) {
      await supabaseAdmin
        .from("backlink_opportunities")
        .update({
          verification: outcome.result,
          verified_at: new Date().toISOString(),
          live_url: line.published_url,
          anchor_found: outcome.anchorFound,
          is_nofollow: outcome.isNofollow,
          ...(isLive ? { status: "live" } : {}),
          ...(isLive && !line.first_live_at ? { first_live_at: new Date().toISOString() } : {}),
        })
        .eq("id", line.opportunity_id);
    }
  }

  return result;
}

// ── Give-up and settlement ──────────────────────────────────────────────────

/**
 * A placement that never appeared. The provider money is gone and cannot be
 * recovered, so Mellox absorbs it and gives the customer their credits back
 * rather than charging for something it cannot show them.
 */
export async function runGiveUpSweep(limit = 25): Promise<number> {
  const { data } = await supabaseAdmin
    .from("link_order_lines")
    .select("id, workspace_id, order_id, credits_price, settled, give_up_at")
    .eq("status", "awaiting_publication")
    .lte("give_up_at", new Date().toISOString())
    .limit(limit);

  let refunded = 0;
  for (const row of data ?? []) {
    const result = await refundLine({
      workspaceId: row.workspace_id,
      orderId: row.order_id,
      lineId: row.id,
      credits: Number(row.credits_price),
      reason: "We could not confirm this placement went live.",
    });
    if (!result.ok) continue;

    await patchLine(row.id, { status: "unconfirmed", settled: "refunded" });
    const order = await loadOrder(row.order_id);
    if (order) {
      await patchOrder(order.id, {
        credits_refunded: order.credits_refunded + Number(row.credits_price),
      });
    }
    await recordEvent({
      workspaceId: row.workspace_id,
      orderId: row.order_id,
      lineId: row.id,
      type: "gave_up",
      detail: { credits: Number(row.credits_price) },
    });
    refunded += 1;
  }

  if (refunded > 0) await settleFinishedOrders();
  return refunded;
}

/** Moves publishing orders to a terminal state once no line is still waiting. */
async function settleFinishedOrders(): Promise<void> {
  const { data } = await supabaseAdmin
    .from("link_orders")
    .select("id, workspace_id, status, link_order_lines(status)")
    .in("status", ["paid", "publishing"])
    .limit(100);

  for (const order of data ?? []) {
    const lines = (order.link_order_lines ?? []) as unknown as { status: string }[];
    if (lines.length === 0) continue;
    if (lines.some((line) => line.status === "awaiting_publication")) continue;

    const anyUnconfirmed = lines.some((line) => line.status === "unconfirmed");
    await patchOrder(order.id, {
      status: anyUnconfirmed ? "partially_published" : "published",
      settled_at: new Date().toISOString(),
    });
  }
}
