// workspace.server.ts — turns what Mellox knows about a business into a
// discovery run, and folds whatever the workspace already recorded by hand
// into the same entity.
//
// This is the join between Brand DNA and competitor intelligence. Discovery is
// only as good as the context it starts from, and Brand DNA is exactly that
// context: what they sell, to whom, in which category, from which site. That
// is why "find my competitors" lives here rather than being a generic search.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readBrandDna } from "@/server/workspaces/brand-dna.server";
import { webResearchAvailable, webSearch } from "@/server/research/web-search.server";
import { hostOf, type WebSource } from "@/lib/research/sources";
import { siteForNamedCompetitor } from "@/lib/competitors/resolve-name";
import { discoverCompetitors, type DiscoveryContext } from "./discovery.server";
import {
  knownDomains,
  loadOverview,
  saveSuggestions,
  setStatus,
  upsertCompetitor,
} from "./store.server";
import { kickCompetitor, normalizeCompetitorDomain } from "./service.server";
import type { CompetitorView } from "@/lib/competitors/contracts";

type Db = SupabaseClient<never>;

function text(value: unknown, max = 400): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function list(value: unknown, max: number): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
        .slice(0, max)
    : [];
}

/**
 * Read the business context discovery searches around. Falls back to the
 * workspace row when Brand DNA has not been filled in — a brand-new workspace
 * still has a name and a website, which is enough for a first pass.
 */
export async function loadDiscoveryContext(db: Db, workspaceId: string): Promise<DiscoveryContext> {
  const [stored, workspace] = await Promise.all([
    readBrandDna(db as never, workspaceId).catch(() => null),
    (db as never as SupabaseClient)
      .from("workspaces")
      .select("name, website_url")
      .eq("id", workspaceId)
      .maybeSingle(),
  ]);

  const dna = (stored?.dna ?? {}) as Record<string, unknown>;
  const websiteUrl = text(workspace.data?.website_url) || text(dna.websiteUrl);
  const domain = websiteUrl
    ? hostOf(websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`)
    : null;

  return {
    brandName: text(dna.brandName) || text(workspace.data?.name) || domain || "",
    domain: domain || null,
    industry: text(dna.industry, 200),
    oneLiner: text(dna.oneLiner, 300),
    products: text(dna.products, 400),
    audience: text(dna.audience, 300),
    keywords: list(dna.keywords, 8),
    knownDomains: await knownDomains(db as never, workspaceId),
  };
}

/**
 * Lift competitors the workspace already wrote into its Brand DNA up into the
 * competitor entity. Runs once per domain and is idempotent: the upsert keys
 * on (workspace, domain), so repeating it changes nothing.
 *
 * They arrive tracked, because a person typed them in deliberately — unlike a
 * discovered candidate, there is nothing for the user to confirm.
 */
export async function importBrandDnaCompetitors(args: {
  db: Db;
  workspaceId: string;
  userId: string | null;
  resolveMissingUrls?: boolean;
  maxNewTracked?: number;
}): Promise<number> {
  const stored = await readBrandDna(args.db as never, args.workspaceId).catch(() => null);
  const entries = Array.isArray((stored?.dna as Record<string, unknown>)?.competitors)
    ? ((stored?.dna as Record<string, unknown>).competitors as unknown[])
    : [];
  const context = args.resolveMissingUrls
    ? await loadDiscoveryContext(args.db, args.workspaceId)
    : null;
  const trackedDomains =
    args.maxNewTracked === undefined
      ? null
      : new Set(
          (await loadOverview(args.db as never, args.workspaceId)).competitors.map(
            (competitor) => competitor.domain,
          ),
        );
  const resolved = await Promise.all(
    entries.slice(0, args.resolveMissingUrls ? 6 : 20).map(async (entry) => {
      const row = entry as Record<string, unknown>;
      const name = text(row.name, 200);
      const rawUrl = text(row.url, 300);
      if (rawUrl || !name || !args.resolveMissingUrls)
        return { row, name, url: rawUrl, source: null as WebSource | null };
      const results = await webSearch(`"${name}" official website ${context?.industry ?? ""}`, {
        limit: 6,
        perHost: 1,
        route: "competitors.resolve-name",
      });
      const source = siteForNamedCompetitor(name, results, context?.domain ?? null);
      return { row, name, url: source?.url ?? "", source };
    }),
  );
  let imported = 0;
  let newlyTracked = 0;
  for (const { row, name, url, source } of resolved) {
    const domain = normalizeCompetitorDomain(url);
    if (!domain || !domain.includes(".")) continue;
    if (trackedDomains && !trackedDomains.has(domain) && newlyTracked >= (args.maxNewTracked ?? 0))
      continue;
    try {
      const saved = await upsertCompetitor({
        workspaceId: args.workspaceId,
        userId: args.userId,
        name: name || domain,
        domain,
        url: url || null,
        source: "brand_dna",
        status: "tracked",
        rationale: text(row.positioning, 500) || text(row.notes, 500) || null,
        discoverySources: source
          ? [{ title: source.title, url: source.url, snippet: source.snippet }]
          : [],
      });
      if (saved) {
        imported += 1;
        if (trackedDomains && !trackedDomains.has(domain)) {
          trackedDomains.add(domain);
          newlyTracked += 1;
        }
      }
    } catch (error) {
      console.error("[competitors] brand DNA import failed for", domain, error);
    }
  }
  return imported;
}

/**
 * The "Find competitors" action. Returns saved suggestions for the user to
 * accept or ignore; it never starts tracking anyone, because tracking is what
 * costs money on every later sweep.
 */
export async function runDiscoveryForWorkspace(args: {
  supabase: Db;
  workspaceId: string;
  userId: string | null;
  scanSeed?: { hostname: string; siteName: string; description: string };
}): Promise<{ suggestions: CompetitorView[]; searched: number; available: boolean }> {
  // Anything already recorded by hand counts as known, so discovery spends its
  // searches on companies the workspace has not thought of yet.
  if (!args.scanSeed) {
    await importBrandDnaCompetitors({
      db: args.supabase,
      workspaceId: args.workspaceId,
      userId: args.userId,
    });
  }

  const context = await loadDiscoveryContext(args.supabase, args.workspaceId);
  if (args.scanSeed) {
    // The homepage arrives early in the Brand DNA stream. Never let a caller
    // research a different website under this workspace's identity.
    const seedHost = hostOf(`https://${args.scanSeed.hostname}`);
    if (!context.domain || seedHost !== context.domain) {
      throw new Error("The scanned website does not match this workspace.");
    }
    context.brandName = text(args.scanSeed.siteName, 100) || context.domain.split(".")[0];
    context.oneLiner = text(args.scanSeed.description, 240);
    context.industry = "";
    context.products = "";
    context.audience = "";
    context.keywords = [];
  }
  if (!context.brandName && !context.domain) {
    return { suggestions: [], searched: 0, available: webResearchAvailable() };
  }

  const { suggestions, sourcesSeen } = await discoverCompetitors(context);
  const saved = await saveSuggestions({
    workspaceId: args.workspaceId,
    userId: args.userId,
    suggestions,
  });
  // Only genuinely new suggestions are worth showing: one the user already
  // tracked or ignored is not a discovery.
  return {
    suggestions: saved.filter((competitor) => competitor.status === "suggested"),
    searched: sourcesSeen,
    available: webResearchAvailable(),
  };
}

/** Build the first research set after a Brand DNA scan. Repeated calls are safe. */
export async function bootstrapCompetitorsForWorkspace(args: {
  supabase: Db;
  workspaceId: string;
  userId: string | null;
  scanSeed?: { hostname: string; siteName: string; description: string };
}): Promise<{ competitors: CompetitorView[]; searched: number; available: boolean }> {
  if (args.scanSeed) {
    const context = await loadDiscoveryContext(args.supabase, args.workspaceId);
    if (!context.domain || hostOf(`https://${args.scanSeed.hostname}`) !== context.domain) {
      throw new Error("The scanned website does not match this workspace.");
    }
  }
  if (!args.scanSeed) {
    const tracked = await loadOverview(args.supabase as never, args.workspaceId);
    if (tracked.competitors.length < 6) {
      await importBrandDnaCompetitors({
        db: args.supabase,
        workspaceId: args.workspaceId,
        userId: args.userId,
        resolveMissingUrls: true,
        maxNewTracked: 6 - tracked.competitors.length,
      });
    }
  }
  let overview = await loadOverview(args.supabase as never, args.workspaceId);
  const available = webResearchAvailable();
  if (overview.competitors.length >= 3) {
    for (const competitor of overview.competitors
      .filter((entry) => entry.profileStatus === "pending")
      .slice(0, 6)) {
      kickCompetitor(competitor.id);
    }
    return { competitors: overview.competitors.slice(0, 6), searched: 0, available };
  }

  let searched = 0;
  let candidates = overview.suggestions;
  if (candidates.length < 3 - overview.competitors.length) {
    const result = await runDiscoveryForWorkspace(args);
    searched = result.searched;
    overview = await loadOverview(args.supabase as never, args.workspaceId);
    candidates = overview.suggestions;
  }

  const slots = Math.max(0, 6 - overview.competitors.length);
  const selected = candidates
    .filter(
      (candidate) =>
        candidate.relationship !== "unknown" &&
        candidate.confidence >= 0.55 &&
        candidate.discoverySources.length > 0,
    )
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, slots);
  for (const candidate of selected) {
    await setStatus({
      workspaceId: args.workspaceId,
      competitorId: candidate.id,
      status: "tracked",
    });
  }
  overview = await loadOverview(args.supabase as never, args.workspaceId);
  for (const competitor of overview.competitors
    .filter((entry) => entry.profileStatus === "pending")
    .slice(0, 6)) {
    kickCompetitor(competitor.id);
  }
  return { competitors: overview.competitors.slice(0, 6), searched, available };
}
