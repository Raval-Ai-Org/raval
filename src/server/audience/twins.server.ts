// twins.server.ts — proposing a workspace's audience groups from what Mellox
// already has stored: Brand DNA, the latest Market Brain read and researched
// competitors. No web search, no page fetch. One premium model call; when it
// gives nothing usable the groups come straight from Brand DNA instead.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { serializeBrandContext, type BrandCtxDna } from "@/lib/ai/brand-context";
import { llmJson } from "@/lib/ai-gateway.server";
import {
  MAX_TRAITS,
  TRAIT_KINDS,
  type Trait,
  type TraitKind,
  type TraitSource,
  type TwinRow,
} from "@/lib/audience/contracts";
import { TWINS_SCHEMA, TWINS_SYSTEM } from "@/lib/audience/prompts";
import {
  dedupeTraits,
  makeTrait,
  seedFromBrandDna,
  slugify,
  twinBrief,
  type TwinDraft,
} from "@/lib/audience/twins";
import { getLatestMarketBrain } from "@/lib/market-brain-latest.server";
import { wrapUntrusted } from "@/server/guardrails/untrusted";
import { runWithScope } from "@/server/request-context";
import { readBrandDna } from "@/server/workspaces/brand-dna.server";
import type { Actor } from "./engine";

const db = supabaseAdmin as unknown as SupabaseClient;
const ROUTE = "audience.twins";

const BASIS: Record<string, TraitSource> = {
  brand: "brand_dna",
  market: "market",
  competitor: "competitor",
  guess: "assumed",
};

const clean = (value: unknown, max: number) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

async function quiet<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

/** Groups read straight from Brand DNA. Free; used the first time a score is asked for. */
export async function seedDrafts(workspaceId: string): Promise<TwinDraft[]> {
  const stored = await readBrandDna(db, workspaceId);
  return seedFromBrandDna(stored?.dna as Parameters<typeof seedFromBrandDna>[0]);
}

async function marketNotes(workspaceId: string): Promise<string> {
  const market = await quiet(getLatestMarketBrain(workspaceId), null);
  const intel = market?.intelligence;
  if (!intel) return "";
  return [
    intel.summary,
    ...intel.opportunities
      .slice(0, 5)
      .map((o) => `- ${o.title}: for ${o.targetAudience}. ${o.explanation}`),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 2500);
}

async function competitorNotes(workspaceId: string): Promise<string> {
  const { data } = await db
    .from("workspace_competitors")
    .select("name, profile")
    .eq("workspace_id", workspaceId)
    .eq("status", "tracked")
    .eq("profile_status", "ready")
    .limit(5);
  return ((data ?? []) as { name: string; profile: Record<string, unknown> | null }[])
    .map((row) => {
      const customers = clean(row.profile?.targetCustomers, 300);
      const positioning = clean(row.profile?.positioning, 200);
      return customers
        ? `- ${row.name} sells to: ${customers}${positioning ? ` (${positioning})` : ""}`
        : "";
    })
    .filter(Boolean)
    .join("\n")
    .slice(0, 2000);
}

export async function buildTwinDrafts(actor: Actor, existing: TwinRow[]): Promise<TwinDraft[]> {
  const { workspaceId } = actor;
  const stored = await readBrandDna(db, workspaceId);
  const dna = (stored?.dna ?? null) as BrandCtxDna | null;
  const seeds = seedFromBrandDna(dna as Parameters<typeof seedFromBrandDna>[0]);
  const brandText = serializeBrandContext(dna, { maxCharsPerField: 400 }).slice(0, 6000);
  // Too little to describe anyone from: don't pay for a guess.
  if (brandText.trim().length < 120) return seeds;

  const [market, competitors] = await Promise.all([
    marketNotes(workspaceId),
    quiet(competitorNotes(workspaceId), ""),
  ]);
  const groups = existing.filter((t) => t.kind === "group");
  const user = [
    `BRAND CONTEXT:\n${wrapUntrusted("brand context", brandText, { maxChars: 6200, route: ROUTE })}`,
    market &&
      `MARKET NOTES:\n${wrapUntrusted("market notes", market, { maxChars: 2600, route: ROUTE })}`,
    competitors &&
      `COMPETITOR NOTES:\n${wrapUntrusted("competitor notes", competitors, { maxChars: 2100, route: ROUTE })}`,
    groups.length &&
      `EXISTING GROUPS:\n${wrapUntrusted(
        "existing audience groups",
        groups.map((t) => twinBrief(t, 500)).join("\n\n"),
        { maxChars: 3000, route: ROUTE },
      )}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  let out: { groups?: unknown } | null = null;
  try {
    out = await runWithScope(
      {
        workspaceId,
        userId: actor.userId ?? undefined,
        route: ROUTE,
        billingAccountId: undefined,
        billingChargeId: undefined,
      },
      () =>
        llmJson<{ groups?: unknown } | null>({
          route: ROUTE,
          system: TWINS_SYSTEM,
          user,
          maxTokens: 6_000,
          outputSchema: TWINS_SCHEMA as unknown as Record<string, unknown>,
          timeoutMs: 75_000,
          retries: 1,
          fallback: null,
        }),
    );
  } catch (error) {
    console.error("[audience] group proposal failed; using Brand DNA only", error);
  }

  const bySlug = new Map(seeds.map((s) => [s.slug, s]));
  const existingByName = new Map(groups.map((t) => [t.name.toLowerCase(), t]));
  const drafts: TwinDraft[] = [];
  const used = new Set<string>();
  for (const raw of Array.isArray(out?.groups) ? out.groups.slice(0, 4) : []) {
    const row = (raw ?? {}) as Record<string, unknown>;
    const name = clean(row.name, 80);
    if (name.length < 2) continue;
    // A kept name keeps its row, whatever the slug rules make of it today.
    const slug = existingByName.get(name.toLowerCase())?.slug ?? slugify(name);
    if (used.has(slug)) continue;
    used.add(slug);
    const traits: Trait[] = (Array.isArray(row.traits) ? row.traits : [])
      .map((t) => {
        const trait = (t ?? {}) as Record<string, unknown>;
        const text = clean(trait.text, 280);
        const kind = trait.kind as TraitKind;
        if (!text || !TRAIT_KINDS.includes(kind)) return null;
        // An unlabelled statement is treated as a guess, never as a fact.
        return makeTrait(kind, text, BASIS[String(trait.basis)] ?? "assumed");
      })
      .filter((t): t is Trait => t !== null);
    if (traits.length < 2) continue;
    const seed = bySlug.get(slug);
    const weight = typeof row.weight === "number" ? Math.round(row.weight) : 50;
    drafts.push({
      slug,
      name,
      segment: clean(row.segment, 120),
      summary: clean(row.summary, 600),
      weight: Math.max(1, Math.min(100, weight)),
      profile: dedupeTraits([...(seed?.profile ?? []), ...traits]).slice(0, MAX_TRAITS),
      origin: seed ? "brand_dna" : "generated",
      origin_ref: seed?.origin_ref ?? null,
    });
  }
  if (!drafts.length) return seeds;
  // Customers a person entered in Brand DNA are never dropped by a proposal.
  for (const seed of seeds) {
    if (seed.origin_ref && !used.has(seed.slug)) drafts.push(seed);
  }
  return drafts;
}
