// Shortlisting placements, and the one judgement Mellox makes that the provider
// data cannot support on its own: whether a site is topically a fit.
//
// The provider's catalog has no dependable category — `cat` is empty or "0" for
// most rows. Rather than invent a relevance number, Mellox opens the sample page
// the provider gave us, reads it, and says what it found. The result is stored
// and shown as Mellox's own read, with its inputs visible, never as a provider
// metric.
import "server-only";

import { llmJson } from "@/lib/ai-gateway.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { checkBudget } from "@/server/ai/budget";
import {
  donorFacts,
  qualityBand,
  rankForBrand,
  type DonorSignals,
  type RelevantDonor,
  type ScoredDonor,
} from "@/lib/links/rank";
import {
  buildLinkProfile,
  loadBrandFacts,
  readPageText,
  type BrandFacts as LoadedFacts,
  type LinkProfile,
} from "./profile.server";
import { creditsFor } from "@/lib/links/pricing";
import { pricingConfig } from "./credits.server";
import { ensureFreshCatalog, FRESH_HOURS } from "./catalog.server";

/** How many ranked donors get the (paid) topical read. */
const SHORTLIST = 24;
/** Candidates the model looks over (by name and address) before any page is read. */
const PICK_POOL = 260;
/** Rows read from the mirror per request; the whole catalog is ~10k. */
const PAGE_ROWS = 1000;
/** A stored topical read older than this is refreshed. */
const TOPIC_TTL_DAYS = 45;

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

export type Opportunity = RelevantDonor & {
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

type BrandFacts = LoadedFacts & { targetUrl: string; keyword: string };

async function judge(
  donor: ScoredDonor,
  brand: BrandFacts,
  workspaceId: string,
): Promise<TopicRead | null> {
  const pageText = donor.page ? await readPageText(donor.page, PAGE_TEXT_CHARS) : null;

  const result = await llmJson<{
    summary: string;
    fit: string;
    verdict: "good" | "workable" | "poor";
  } | null>({
    route: "links-topical-fit",
    maxTokens: 700,
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
      brand.about ? `About the brand: ${brand.about}` : null,
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
  // Other brands' reads of the same site are kept; only this one is replaced.
  const { data: current } = await supabaseAdmin
    .from("rixot_donors")
    .select("topic")
    .eq("id", donor.id)
    .maybeSingle();
  const previous = (current?.topic ?? {}) as { byWorkspace?: Record<string, unknown> };
  const byWorkspace = { ...(previous.byWorkspace ?? {}), [workspaceId]: read };

  await supabaseAdmin
    .from("rixot_donors")
    .update({
      topic: { summary: read.summary, basis: read.basis, byWorkspace } as unknown as Json,
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
  /** Link text. Optional: the brand profile suggests one when it is missing. */
  keyword?: string | null;
  ownDomain?: string | null;
  maxPriceUsd?: number;
  minAuthority?: number;
  search?: string;
  limit?: number;
  /** Skip the paid topical read — used when only the ordering is wanted. */
  skipTopics?: boolean;
};

export type FindResult = { opportunities: Opportunity[]; profile: LinkProfile };

const PICK_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["picks"],
  additionalProperties: false,
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "fit"],
        additionalProperties: false,
        properties: {
          id: { type: "integer" },
          fit: { type: "integer" },
        },
      },
    },
  },
};

const PICK_SYSTEM = `You shortlist websites where one brand could publish an article
with a link. You see each site's domain, its listed category (often blank) and
the address of one page on it.

Judge ONLY from those clues and the brand facts. Score each site you pick:
3 = clearly the same field or the same readers, 2 = a closely related topic,
1 = general-interest magazine or blog in the right language where the article
would not look odd, 0 = unrelated, wrong language, adult, gambling, crypto or
"investment" schemes, spam-looking, a shop or product page, a portal, a forum
profile, or anything else that is not a site publishing articles. Prefer
editorial blogs and magazines; a higher authority number is better when the
fit is equal. Return every site scored 1 or higher, best
first. Never invent sites; use only the ids given.`;

/** One cheap call over names and addresses, so page reads go to likely fits. */
async function pickRelevant(
  candidates: RelevantDonor[],
  facts: LoadedFacts,
  profile: LinkProfile,
  targetUrl: string,
): Promise<Map<number, number> | null> {
  const lines = candidates.map((donor) => {
    let path = "";
    if (donor.page) {
      try {
        path = new URL(donor.page).pathname.slice(0, 90);
      } catch {
        path = "";
      }
    }
    return `${donor.id} | ${donor.domain} | ${donor.dr ?? "-"} | ${donor.cat ?? "-"} | ${path || "/"}`;
  });

  const result = await llmJson<{ picks: Array<{ id: number; fit: number }> } | null>({
    route: "links-relevance-pick",
    maxTokens: 2_500,
    timeoutMs: 45_000,
    outputSchema: PICK_SCHEMA,
    fallback: null,
    system: PICK_SYSTEM,
    user: [
      `Brand: ${facts.name || "(not set)"}`,
      facts.industry ? `Industry: ${facts.industry}` : null,
      facts.about ? `About: ${facts.about}` : null,
      facts.audience ? `Audience: ${facts.audience}` : null,
      `Page to link to: ${targetUrl}`,
      `Topics: ${profile.topics.join(", ")}`,
      `Article language: ${profile.language}`,
      "",
      "id | domain | authority | category | page address",
      ...lines,
    ]
      .filter((line) => line !== null)
      .join("\n"),
  }).catch((error) => {
    console.warn("[links] relevance pick failed", error instanceof Error ? error.message : error);
    return null;
  });

  if (!result || !Array.isArray(result.picks)) return null;
  const known = new Set(candidates.map((donor) => donor.id));
  const fits = new Map<number, number>();
  for (const pick of result.picks) {
    if (known.has(pick.id) && typeof pick.fit === "number") {
      fits.set(pick.id, Math.max(0, Math.min(3, Math.round(pick.fit))));
    }
  }
  return fits;
}

type DonorRow = {
  id: number;
  domain: string;
  ext: string | null;
  page: string | null;
  price_usd: number | null;
  dr: number | null;
  referring_domains: number | null;
  backlinks: number | null;
  dfs_rank: number | null;
  top100: number | null;
  cat: string | null;
  topic: unknown;
  topic_checked_at: string | null;
};

async function readCatalog(options: FindOptions): Promise<DonorRow[]> {
  const freshSince = new Date(Date.now() - FRESH_HOURS * 3600_000).toISOString();
  const build = (from: number) => {
    let query = supabaseAdmin
      .from("rixot_donors")
      .select(
        "id, domain, ext, page, price_usd, dr, referring_domains, backlinks, dfs_rank, top100, cat, topic, topic_checked_at",
      )
      .is("delisted_at", null)
      .gte("last_seen_at", freshSince)
      .order("id", { ascending: true })
      .range(from, from + PAGE_ROWS - 1);
    if (typeof options.maxPriceUsd === "number")
      query = query.lte("price_usd", options.maxPriceUsd);
    if (typeof options.minAuthority === "number") query = query.gte("dr", options.minAuthority);
    if (options.search) query = query.ilike("domain", `%${options.search.toLowerCase()}%`);
    return query;
  };

  // The whole mirror, read in parallel pages: ranking only the top few hundred
  // by one metric is what made every brand see the same sites.
  const rows: DonorRow[] = [];
  for (let from = 0; from < 20_000; from += PAGE_ROWS * 5) {
    const pages = await Promise.all([0, 1, 2, 3, 4].map((i) => build(from + i * PAGE_ROWS)));
    let done = false;
    for (const { data, error } of pages) {
      if (error) throw new Error(`catalog read failed: ${error.message}`);
      rows.push(...((data ?? []) as DonorRow[]));
      if (!data || data.length < PAGE_ROWS) done = true;
    }
    if (done) break;
  }
  return rows;
}

const VERDICT_ORDER = { good: 0, workable: 1, poor: 2 } as const;

/**
 * Finds the placements that suit this brand.
 *
 * 1. Builds the brand's profile (link text, topics, categories, language).
 * 2. Ranks the whole catalog on quality and relevance, free and deterministic.
 * 3. One model call reads the top names and addresses and keeps likely fits.
 * 4. The shortlist's sample pages are read and judged, then ordered by verdict.
 */
export async function findOpportunities(options: FindOptions): Promise<FindResult> {
  const limit = Math.min(options.limit ?? SHORTLIST, SHORTLIST);

  const [profile] = await Promise.all([
    buildLinkProfile(options.workspaceId, options.targetUrl),
    ensureFreshCatalog(),
  ]);
  const keyword = options.keyword?.trim() || profile.keywords[0];

  const rows = await readCatalog(options);
  const signals = rows.map((row) => {
    const topic = row.topic as { summary?: unknown } | null;
    const signal: DonorSignals & { summary: string | null } = {
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
      summary: typeof topic?.summary === "string" ? topic.summary : null,
    };
    return signal;
  });

  const ranked = rankForBrand(signals, profile, { ownDomain: options.ownDomain });
  const pool = ranked.slice(0, PICK_POOL);
  const cacheById = new Map(rows.map((row) => [Number(row.id), row]));
  const config = pricingConfig();

  const budget = options.skipTopics
    ? { mode: "block" as const }
    : await checkBudget("text", { workspaceId: options.workspaceId });
  const facts = await loadBrandFacts(options.workspaceId);

  // The model's pick reorders the pool; without it (budget, outage) the
  // deterministic ranking stands on its own.
  let shortlist: RelevantDonor[] = pool;
  if (budget.mode !== "block" && !options.search && pool.length > 0) {
    const fits = await pickRelevant(pool, facts, profile, options.targetUrl);
    if (fits && fits.size > 0) {
      shortlist = pool
        .filter((donor) => (fits.get(donor.id) ?? 0) >= 1)
        .sort((a, b) => (fits.get(b.id) ?? 0) - (fits.get(a.id) ?? 0) || b.combined - a.combined);
      // Too few fits is a real answer for a niche brand, but still fill the
      // page with the next-best sites rather than showing three.
      if (shortlist.length < limit) {
        const taken = new Set(shortlist.map((donor) => donor.id));
        shortlist.push(...pool.filter((donor) => !taken.has(donor.id) && !fits.has(donor.id)));
      }
    }
  }
  // Read twice as many as are shown, so sites the page read rules out can be
  // replaced by the next good one instead of being shown as poor fits.
  shortlist = shortlist.slice(0, options.skipTopics ? limit : Math.min(limit * 2, 40));

  const base: Opportunity[] = shortlist.map((donor) => {
    const row = cacheById.get(donor.id);
    return {
      ...donor,
      credits: creditsFor(donor.priceUsd, config),
      quality: qualityBand(donor.score),
      facts: donorFacts(donor),
      topic: row ? cachedRead(row.topic, options.workspaceId, row.topic_checked_at) : null,
    };
  });

  let result = base;
  if (budget.mode !== "block") {
    const needsRead = base.filter((item) => item.topic === null);
    if (needsRead.length > 0) {
      const brand: BrandFacts = { ...facts, targetUrl: options.targetUrl, keyword };
      const reads = await Promise.allSettled(
        needsRead.map((item) => judge(item, brand, options.workspaceId)),
      );
      const byId = new Map<number, TopicRead>();
      reads.forEach((read, index) => {
        if (read.status === "fulfilled" && read.value) byId.set(needsRead[index].id, read.value);
      });
      result = base.map((item) => ({ ...item, topic: item.topic ?? byId.get(item.id) ?? null }));
    }
  }

  // Good fits first; a site Mellox judged a poor fit goes to the bottom rather
  // than disappearing, so the user can still see why.
  const order = new Map(result.map((item, index) => [item.id, index]));
  result.sort(
    (a, b) =>
      VERDICT_ORDER[a.topic?.verdict ?? "workable"] -
        VERDICT_ORDER[b.topic?.verdict ?? "workable"] ||
      (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
  );

  return { opportunities: result.slice(0, limit), profile };
}
