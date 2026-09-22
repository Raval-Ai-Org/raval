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
import { webResearchAvailable } from "@/server/research/web-search.server";
import { hostOf } from "@/lib/research/sources";
import { discoverCompetitors, type DiscoveryContext } from "./discovery.server";
import { knownDomains, saveSuggestions, upsertCompetitor } from "./store.server";
import { normalizeCompetitorDomain } from "./service.server";
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
  const websiteUrl = text(dna.websiteUrl) || text(workspace.data?.website_url);
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
}): Promise<number> {
  const stored = await readBrandDna(args.db as never, args.workspaceId).catch(() => null);
  const entries = Array.isArray((stored?.dna as Record<string, unknown>)?.competitors)
    ? ((stored?.dna as Record<string, unknown>).competitors as unknown[])
    : [];
  let imported = 0;
  for (const entry of entries.slice(0, 20)) {
    const row = entry as Record<string, unknown>;
    const rawDomain = text(row.url, 300) || text(row.name, 200);
    const domain = normalizeCompetitorDomain(rawDomain);
    if (!domain || !domain.includes(".")) continue;
    try {
      const saved = await upsertCompetitor({
        workspaceId: args.workspaceId,
        userId: args.userId,
        name: text(row.name, 200) || domain,
        domain,
        url: text(row.url, 2048) || null,
        source: "brand_dna",
        status: "tracked",
        rationale: text(row.positioning, 500) || text(row.notes, 500) || null,
      });
      if (saved) imported += 1;
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
}): Promise<{ suggestions: CompetitorView[]; searched: number; available: boolean }> {
  if (!webResearchAvailable()) {
    return { suggestions: [], searched: 0, available: false };
  }

  // Anything already recorded by hand counts as known, so discovery spends its
  // searches on companies the workspace has not thought of yet.
  await importBrandDnaCompetitors({
    db: args.supabase,
    workspaceId: args.workspaceId,
    userId: args.userId,
  });

  const context = await loadDiscoveryContext(args.supabase, args.workspaceId);
  if (!context.brandName && !context.domain) {
    return { suggestions: [], searched: 0, available: true };
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
    available: true,
  };
}
