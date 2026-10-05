// sources.server.ts — what the four brains know right now, gathered once for a
// strategy: the text the model reads, the facts a strategy may refer to
// (ground.ts), and a fingerprint that changes when a brain does.
//
// Always loaded by the request's VERIFIED workspace id. Each brain is optional
// and fails open: a strategy can be written from Brand DNA alone.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { serializeBrandContext, type BrandCtxDna } from "@/lib/ai/brand-context";
import { audienceBlock } from "@/lib/audience/twins";
import { isAudienceEnabled } from "@/lib/feature-flags";
import { getLatestMarketBrain } from "@/lib/market-brain-latest.server";
import type { StrategyFacts } from "@/lib/strategy/contracts";
import { supabaseAudienceStore } from "@/server/audience/store.server";
import { connectedPlatforms } from "@/server/autopilot/ports.server";
import { digest } from "@/server/cache/store";
import { readBrandDna } from "@/server/workspaces/brand-dna.server";

const db = supabaseAdmin as unknown as SupabaseClient;

export type BrainKey = "brand" | "audience" | "competitors" | "market";

export type StrategySources = {
  facts: StrategyFacts;
  available: Record<BrainKey, boolean>;
  fingerprint: string;
  /** Prompt text per brain; "" when that brain has nothing yet. */
  text: Record<BrainKey, string> & { performance: string };
  brandName: string;
};

async function quiet<T>(promise: PromiseLike<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    console.warn(
      "[strategy] a brain was unavailable",
      error instanceof Error ? error.message : error,
    );
    return fallback;
  }
}

const str = (v: unknown, max = 300): string =>
  typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";

type CompetitorRow = {
  id: string;
  name: string;
  domain: string | null;
  relationship: string | null;
  profile: Record<string, unknown> | null;
  profile_updated_at: string | null;
};

export async function gatherStrategySources(workspaceId: string): Promise<StrategySources> {
  const [stored, ws, twins, competitorRows, updateRows, market, platforms] = await Promise.all([
    quiet(readBrandDna(db, workspaceId), null),
    quiet(db.from("workspaces").select("name, website_url").eq("id", workspaceId).maybeSingle(), {
      data: null,
    } as never),
    isAudienceEnabled(workspaceId)
      ? quiet(supabaseAudienceStore.listTwins(workspaceId), [])
      : Promise.resolve([]),
    quiet(
      db
        .from("workspace_competitors")
        .select("id, name, domain, relationship, profile, profile_updated_at")
        .eq("workspace_id", workspaceId)
        .eq("status", "tracked")
        .order("confidence", { ascending: false })
        .limit(6),
      { data: [] } as never,
    ),
    quiet(
      db
        .from("competitor_updates")
        .select("competitor_id, title, summary, detected_at")
        .eq("workspace_id", workspaceId)
        .order("detected_at", { ascending: false })
        .limit(6),
      { data: [] } as never,
    ),
    quiet(getLatestMarketBrain(workspaceId), null),
    quiet(connectedPlatforms(workspaceId), [] as string[]),
  ]);

  const dna = (stored?.dna ?? null) as BrandCtxDna | null;
  const wsRow = ((ws as { data: unknown }).data ?? {}) as { name?: string; website_url?: string };
  const brandText = dna
    ? serializeBrandContext(dna, {
        siteUrl: wsRow.website_url ?? null,
        maxCharsPerField: 400,
      }).slice(0, 6000)
    : "";

  const competitors = (
    ((competitorRows as { data: unknown }).data ?? []) as CompetitorRow[]
  ).filter((c) => c.id && c.name);
  const names = new Map(competitors.map((c) => [c.id, c.name]));
  const updates = (((updateRows as { data: unknown }).data ?? []) as Array<Record<string, unknown>>)
    .filter((u) => names.has(String(u.competitor_id)))
    .slice(0, 5);
  const competitorText = competitors
    .map((c) => {
      const p = c.profile ?? {};
      const list = (v: unknown) =>
        (Array.isArray(v) ? v : [])
          .map((x) => str(x, 120))
          .filter(Boolean)
          .slice(0, 3)
          .join("; ");
      return [
        `### ${c.name} (id: ${c.id}${c.relationship ? `, ${c.relationship}` : ""})`,
        str(p.summary, 320),
        str(p.positioning, 280) && `Positioning: ${str(p.positioning, 280)}`,
        str(p.targetCustomers, 200) && `Customers: ${str(p.targetCustomers, 200)}`,
        list(p.strengths) && `Strengths: ${list(p.strengths)}`,
        list(p.weaknesses) && `Weaknesses: ${list(p.weaknesses)}`,
        str(p.pricingSignals, 160) && `Pricing: ${str(p.pricingSignals, 160)}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .concat(
      updates.length
        ? [
            `### Recent moves\n${updates
              .map((u) => `- ${names.get(String(u.competitor_id))}: ${str(u.title, 140)}`)
              .join("\n")}`,
          ]
        : [],
    )
    .join("\n\n");

  const intelligence = market?.intelligence ?? null;
  const sources = (market?.result?.data?.sources ?? [])
    .filter((s) => s.url && s.title)
    .slice(0, 12)
    .map((s) => ({ url: s.url, title: s.title, snippet: s.snippet ?? "" }));
  const marketText = [
    intelligence?.summary && `Summary: ${str(intelligence.summary, 500)}`,
    ...(intelligence?.trendSignals ?? [])
      .slice(0, 5)
      .map((t) => `- ${t.direction}: ${str(t.title, 140)} — ${str(t.significance, 200)}`),
    ...(intelligence?.opportunities ?? [])
      .slice(0, 5)
      .map((o) => `- Opening: ${str(o.title, 140)} — ${str(o.recommendedAction, 200)}`),
    sources.length
      ? `Sources (a market play must cite one of these exact URLs):\n${sources
          .map(
            (s) =>
              `- ${s.url} — ${str(s.title, 140)}${s.snippet ? `: ${str(s.snippet, 200)}` : ""}`,
          )
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const groups = twins.filter((t) => t.kind === "group");
  const audienceText = audienceBlock(twins, 2000);

  const available: Record<BrainKey, boolean> = {
    brand: brandText.trim().length > 120,
    audience: groups.length > 0,
    competitors: competitors.length > 0,
    market: !!intelligence || sources.length > 0,
  };

  const fingerprint = await digest(
    JSON.stringify({
      dna: stored?.version ?? 0,
      twins: twins.map((t) => `${t.id}:${t.version}`).sort(),
      competitors: competitors.map((c) => `${c.id}:${c.profile_updated_at ?? ""}`).sort(),
      market: market?.result?.collectionId ?? null,
    }),
  );

  return {
    facts: {
      competitors: competitors.map((c) => ({ id: c.id, name: c.name })),
      sources: sources.map((s) => ({ url: s.url, title: s.title })),
      audiences: groups.map((t) => t.name),
      platforms,
    },
    available,
    fingerprint,
    text: {
      brand: brandText,
      audience: audienceText,
      competitors: competitorText,
      market: marketText,
      performance: "",
    },
    brandName: str(dna?.brandName, 80) || str(wsRow.name, 80) || "the brand",
  };
}
