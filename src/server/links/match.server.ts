// Shortlisting placements, and the one judgement Mellox makes that the provider
// data cannot support on its own: whether a site is topically a fit.
//
// The provider's catalog has no dependable category — `cat` is empty or "0" for
// most rows. Rather than invent a relevance number, Mellox opens the sample page
// the provider gave us, reads it, and says what it found. The result is stored
// and shown as Mellox's own read, with its inputs visible, never as a provider
// metric.
import "server-only";

import { claudeJsonPrompt, selectClaudeModel } from "@/lib/anthropic-gateway.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checkBudget } from "@/server/ai/budget";
import { assertPublicUrl, safeFetch, SsrfBlockedError } from "@/server/safe-fetch";
import { readBrandDna } from "@/server/workspaces/brand-dna.server";
import {
  donorFacts,
  qualityBand,
  rankDonors,
  type DonorSignals,
  type ScoredDonor,
} from "@/lib/links/rank";
import { creditsFor } from "@/lib/links/pricing";
import { pricingConfig } from "./credits.server";
import { FRESH_HOURS } from "./catalog.server";

/** How many ranked donors get the (paid) topical read. */
const SHORTLIST = 24;
/** Candidates pulled from Postgres before ranking. */
const CANDIDATE_POOL = 400;
/** A stored topical read older than this is refreshed. */
const TOPIC_TTL_DAYS = 45;

const PAGE_TIMEOUT_MS = 8_000;
const PAGE_MAX_BYTES = 512 * 1024;
const PAGE_TEXT_CHARS = 4_000;

export type TopicRead = {
  /** What the page is about, in Mellox's words. */
  summary: string;
  /** Why it does or does not suit this brand's target page. */
  fit: string;
  verdict: "good" | "workable" | "poor";
  /** What the judgement was made from, so the UI can show its inputs. */
  basis: "page" | "domain";
  checkedAt: string;
};

export type Opportunity = ScoredDonor & {
  credits: number;
  quality: ReturnType<typeof qualityBand>;
  facts: ReturnType<typeof donorFacts>;
  topic: TopicRead | null;
};

const TOPIC_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["summary", "fit", "verdict"],
  additionalProperties: false,
  properties: {
    summary: { type: "string", maxLength: 220 },
    fit: { type: "string", maxLength: 260 },
    verdict: { type: "string", enum: ["good", "workable", "poor"] },
  },
};

const SYSTEM = `You judge whether a website is a sensible place for another brand to
place one article containing one link.

Rules:
- Use ONLY the page text and the brand facts supplied. Never invent an audience
  size, a traffic figure, an editorial policy, a price or a past relationship.
- "summary" says what the site publishes, in one sentence, as an observation:
  "Covers small-business accounting and tax deadlines." If the text is too thin
  to tell, say exactly that instead of guessing.
- "fit" says in one or two sentences why this site does or does not suit the
  brand's target page. Name the actual overlap or the actual mismatch.
- "verdict" is "good" when the audiences genuinely overlap, "workable" when the
  site is general-interest and the article could sit there without looking odd,
  and "poor" when the topic is unrelated, the page is not editorial, or the text
  is too thin to judge.
- Plain language a non-marketer understands. No SEO jargon, no superlatives,
  no scores or percentages.`;

/** The sample page, reduced to readable text. Never throws. */
async function readPage(url: string): Promise<string | null> {
  try {
    assertPublicUrl(url);
    const response = await safeFetch(url, {
      timeoutMs: PAGE_TIMEOUT_MS,
      maxBytes: PAGE_MAX_BYTES,
      onOverflow: "truncate",
    });
    if (!response.ok) return null;

    const type = response.headers.get("content-type") ?? "";
    if (type && !/text\/html|text\/plain|application\/xhtml/i.test(type)) return null;

    const text = response
      .text()
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Too little text to judge is a real answer, not a failure to report.
    return text.length < 200 ? null : text.slice(0, PAGE_TEXT_CHARS);
  } catch (error) {
    if (error instanceof SsrfBlockedError) return null;
    return null;
  }
}

type BrandFacts = {
  name: string;
  industry: string;
  audience: string;
  targetUrl: string;
  keyword: string;
};

async function brandFacts(
  workspaceId: string,
  targetUrl: string,
  keyword: string,
): Promise<BrandFacts> {
  const [workspace, dna] = await Promise.all([
    supabaseAdmin
      .from("workspaces")
      .select("name, industry, audience")
      .eq("id", workspaceId)
      .maybeSingle(),
    readBrandDna(supabaseAdmin, workspaceId).catch(() => null),
  ]);

  const stored = (dna?.dna ?? {}) as Record<string, unknown>;
  const pick = (key: string): string => {
    const value = stored[key];
    return typeof value === "string" ? value.slice(0, 400) : "";
  };

  return {
    name: workspace.data?.name ?? "",
    industry: pick("industry") || (workspace.data?.industry ?? ""),
    audience: pick("audience") || (workspace.data?.audience ?? ""),
    targetUrl,
    keyword,
  };
}

async function judge(
  donor: ScoredDonor,
  brand: BrandFacts,
  workspaceId: string,
): Promise<TopicRead | null> {
  const pageText = donor.page ? await readPage(donor.page) : null;

  const result = await claudeJsonPrompt<{
    summary: string;
    fit: string;
    verdict: "good" | "workable" | "poor";
  } | null>({
    route: "links-topical-fit",
    model: selectClaudeModel("default"),
    maxTokens: 700,
    effort: "low",
    timeoutMs: 40_000,
    outputSchema: TOPIC_SCHEMA,
    fallback: null,
    system: SYSTEM,
    user: [
      `Website: ${donor.domain}`,
      donor.cat ? `Site category as listed: ${donor.cat}` : null,
      pageText
        ? `Text from one of its pages:\n"""\n${pageText}\n"""`
        : `No readable article text could be fetched from this site. Judge from the domain name alone and say so.`,
      "",
      `Brand: ${brand.name || "(not set)"}`,
      brand.industry ? `Industry: ${brand.industry}` : null,
      brand.audience ? `Audience: ${brand.audience}` : null,
      `The article would link to: ${brand.targetUrl}`,
      `Using the link text: ${brand.keyword}`,
    ]
      .filter(Boolean)
      .join("\n"),
  });

  if (!result || !result.summary || !result.fit) return null;

  const read: TopicRead = {
    summary: result.summary,
    fit: result.fit,
    verdict: result.verdict,
    basis: pageText ? "page" : "domain",
    checkedAt: new Date().toISOString(),
  };

  // Cached on the donor, not on the workspace: the summary is about the site.
  // The fit sentence is brand-specific, so it is only reused for this brand.
  await supabaseAdmin
    .from("rixot_donors")
    .update({
      topic: { summary: read.summary, basis: read.basis, byWorkspace: { [workspaceId]: read } },
      topic_checked_at: read.checkedAt,
    })
    .eq("id", donor.id);

  return read;
}

function cachedRead(
  topic: unknown,
  workspaceId: string,
  checkedAt: string | null,
): TopicRead | null {
  if (!topic || typeof topic !== "object") return null;
  const byWorkspace = (topic as Record<string, unknown>).byWorkspace;
  if (!byWorkspace || typeof byWorkspace !== "object") return null;
  const entry = (byWorkspace as Record<string, unknown>)[workspaceId];
  if (!entry || typeof entry !== "object") return null;

  const read = entry as Partial<TopicRead>;
  if (typeof read.summary !== "string" || typeof read.fit !== "string") return null;

  const age = checkedAt ? Date.now() - new Date(checkedAt).getTime() : Number.POSITIVE_INFINITY;
  if (age > TOPIC_TTL_DAYS * 86_400_000) return null;

  return {
    summary: read.summary,
    fit: read.fit,
    verdict: read.verdict === "good" || read.verdict === "poor" ? read.verdict : "workable",
    basis: read.basis === "page" ? "page" : "domain",
    checkedAt: checkedAt ?? new Date().toISOString(),
  };
}

export type FindOptions = {
  workspaceId: string;
  targetUrl: string;
  keyword: string;
  ownDomain?: string | null;
  maxPriceUsd?: number;
  minAuthority?: number;
  search?: string;
  limit?: number;
  /** Skip the paid topical read — used when only the ordering is wanted. */
  skipTopics?: boolean;
};

/**
 * Ranks the catalog, then explains the shortlist.
 *
 * The ranking is free and deterministic; only the shortlist costs an AI call,
 * which is why CANDIDATE_POOL is large and SHORTLIST is small.
 */
export async function findOpportunities(options: FindOptions): Promise<Opportunity[]> {
  const limit = Math.min(options.limit ?? 12, SHORTLIST);
  const freshSince = new Date(Date.now() - FRESH_HOURS * 3600_000).toISOString();

  let query = supabaseAdmin
    .from("rixot_donors")
    .select(
      "id, domain, ext, page, price_usd, dr, referring_domains, backlinks, dfs_rank, top100, cat, topic, topic_checked_at",
    )
    .is("delisted_at", null)
    .gte("last_seen_at", freshSince)
    .order("dfs_rank", { ascending: false, nullsFirst: false })
    .limit(CANDIDATE_POOL);

  if (typeof options.maxPriceUsd === "number") query = query.lte("price_usd", options.maxPriceUsd);
  if (typeof options.minAuthority === "number") query = query.gte("dr", options.minAuthority);
  if (options.search) query = query.ilike("domain", `%${options.search.toLowerCase()}%`);

  const { data, error } = await query;
  if (error) throw new Error(`catalog read failed: ${error.message}`);

  const rows = data ?? [];
  const signals: DonorSignals[] = rows.map((row) => ({
    id: Number(row.id),
    domain: String(row.domain),
    ext: row.ext,
    page: row.page,
    priceUsd: Number(row.price_usd ?? 0),
    dr: row.dr === null ? null : Number(row.dr),
    referringDomains: row.referring_domains === null ? null : Number(row.referring_domains),
    backlinks: row.backlinks === null ? null : Number(row.backlinks),
    dfsRank: row.dfs_rank === null ? null : Number(row.dfs_rank),
    top100: row.top100 === null ? null : Number(row.top100),
    cat: row.cat,
  }));

  const ranked = rankDonors(signals, { ownDomain: options.ownDomain, limit });
  const config = pricingConfig();
  const cacheById = new Map(rows.map((row) => [Number(row.id), row]));

  const base: Opportunity[] = ranked.map((donor) => {
    const row = cacheById.get(donor.id);
    return {
      ...donor,
      credits: creditsFor(donor.priceUsd, config),
      quality: qualityBand(donor.score),
      facts: donorFacts(donor),
      topic: row ? cachedRead(row.topic, options.workspaceId, row.topic_checked_at) : null,
    };
  });

  if (options.skipTopics) return base;

  const needsRead = base.filter((item) => item.topic === null);
  if (needsRead.length === 0) return base;

  // One budget decision for the whole shortlist. Degrading to the ranking
  // alone is a worse answer, not a wrong one, so a blocked budget is not fatal.
  const budget = await checkBudget("text", { workspaceId: options.workspaceId });
  if (budget.mode === "block") return base;

  const brand = await brandFacts(options.workspaceId, options.targetUrl, options.keyword);
  const reads = await Promise.allSettled(
    needsRead.map((item) => judge(item, brand, options.workspaceId)),
  );

  const byId = new Map<number, TopicRead>();
  reads.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value) byId.set(needsRead[index].id, result.value);
  });

  return base.map((item) => ({ ...item, topic: item.topic ?? byId.get(item.id) ?? null }));
}
