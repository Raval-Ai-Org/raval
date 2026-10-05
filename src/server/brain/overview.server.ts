// overview.server.ts — what the four brains and the strategy hold right now,
// in one read. No model call, no web search, nothing charged: it only counts
// and lists rows that already exist. Read with the caller's own (RLS) client,
// after the workspace role check in src/server/fns/brain.ts.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  audienceHealth,
  brandHealth,
  competitorsHealth,
  marketHealth,
  mergeUpdates,
  readiness,
  type BrainOverview,
  type BrainUpdate,
} from "@/lib/brain/brain";
import { parseLook } from "@/lib/brand-look/spec";
import { isAudienceEnabled } from "@/lib/feature-flags";
import { getLatestMarketBrain } from "@/lib/market-brain-latest.server";
import { StrategySchema } from "@/lib/strategy/contracts";

type Row = Record<string, unknown>;

const str = (v: unknown, max = 160): string =>
  typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";

async function rows(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<Row[]> {
  try {
    const { data, error } = await query;
    if (error) return [];
    return (Array.isArray(data) ? data : data ? [data] : []) as Row[];
  } catch {
    return [];
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function loadBrainOverview(
  db: SupabaseClient,
  workspaceId: string,
): Promise<BrainOverview> {
  const audienceOn = isAudienceEnabled(workspaceId);
  const [wsRows, dnaRows, twinRows, outcomeRows, competitorRows, updateRows, strategyRows, market] =
    await Promise.all([
      rows(db.from("workspaces").select("website_url").eq("id", workspaceId).maybeSingle()),
      rows(
        db
          .from("workspace_brand_dna")
          .select("dna, updated_at")
          .eq("workspace_id", workspaceId)
          .maybeSingle(),
      ),
      audienceOn
        ? rows(
            db
              .from("audience_twins")
              .select("id, name, kind, origin, updated_at")
              .eq("workspace_id", workspaceId)
              .eq("status", "active")
              .order("updated_at", { ascending: false })
              .limit(20),
          )
        : Promise.resolve([] as Row[]),
      audienceOn
        ? rows(
            db
              .from("audience_outcomes")
              .select("id, created_at")
              .eq("workspace_id", workspaceId)
              .order("created_at", { ascending: false })
              .limit(20),
          )
        : Promise.resolve([] as Row[]),
      rows(
        db
          .from("workspace_competitors")
          .select("id, name, status, profile_status, created_at")
          .eq("workspace_id", workspaceId)
          .in("status", ["tracked", "suggested"])
          .limit(200),
      ),
      rows(
        db
          .from("competitor_updates")
          .select("id, competitor_id, title, summary, source_url, detected_at")
          .eq("workspace_id", workspaceId)
          .order("detected_at", { ascending: false })
          .limit(10),
      ),
      rows(
        db
          .from("workspace_marketing_strategy")
          .select("strategy, status, updated_at")
          .eq("workspace_id", workspaceId)
          .maybeSingle(),
      ),
      getLatestMarketBrain(workspaceId).catch(() => null),
    ]);

  const website = str(wsRows[0]?.website_url, 300);

  // ── Brand ──
  const dna = (dnaRows[0]?.dna ?? null) as Row | null;
  const dnaAt = (dnaRows[0]?.updated_at as string | undefined) ?? null;
  const bHealth = brandHealth(dna);
  const look = parseLook(dna?.look);
  const lookSet = !!(look.visual || look.writing || look.video);
  const colors = Array.isArray(dna?.colors) ? dna.colors.length : 0;

  // ── Audience ──
  const groups = twinRows.filter((t) => t.kind === "group");
  const aHealth = audienceHealth({ groups: groups.length, measured: outcomeRows.length });

  // ── Competitors ──
  const tracked = competitorRows.filter((c) => c.status === "tracked");
  const suggested = competitorRows.filter((c) => c.status === "suggested");
  const cHealth = competitorsHealth({
    tracked: tracked.length,
    profiled: tracked.filter((c) => c.profile_status === "ready").length,
  });
  const competitorName = new Map(competitorRows.map((c) => [String(c.id), str(c.name, 80)]));

  // ── Market ──
  const completedAt = market?.result?.completedAt ?? null;
  const ageDays = completedAt ? (Date.now() - Date.parse(completedAt)) / 86_400_000 : null;
  const intelligence = market?.intelligence ?? null;
  const sources = market?.result?.data?.sources ?? [];
  const mHealth = marketHealth({ hasResult: !!market?.result?.data || !!intelligence, ageDays });

  // ── Strategy ──
  const sRow = strategyRows[0];
  const strategy = sRow ? StrategySchema.safeParse(sRow.strategy) : null;
  const status = strategy?.success ? (sRow!.status as "draft" | "confirmed") : null;
  const strategyAt = status ? ((sRow!.updated_at as string) ?? null) : null;

  // ── What changed ──
  const updates: BrainUpdate[][] = [
    dnaAt && bHealth > 0
      ? [{ id: `brand:${dnaAt}`, brain: "brand", title: "Brand DNA updated", at: dnaAt }]
      : [],
    groups.slice(0, 3).map((t) => ({
      id: `audience:${t.id}:${t.updated_at}`,
      brain: "audience" as const,
      title: `${str(t.name, 80)} group ${t.origin === "user" ? "edited" : "updated"}`,
      at: String(t.updated_at),
    })),
    outcomeRows.length
      ? [
          {
            id: `audience:outcomes:${outcomeRows[0].created_at}`,
            brain: "audience" as const,
            title: `${plural(outcomeRows.length, "real result")} to learn from`,
            at: String(outcomeRows[0].created_at),
          },
        ]
      : [],
    updateRows.map((r) => ({
      id: `competitors:${r.id}`,
      brain: "competitors" as const,
      title: [competitorName.get(String(r.competitor_id)), str(r.title, 140)]
        .filter(Boolean)
        .join(": "),
      detail: str(r.summary, 220) || undefined,
      at: String(r.detected_at),
      url: str(r.source_url, 600) || undefined,
    })),
    suggested.length
      ? [
          {
            id: `competitors:suggested:${suggested.length}`,
            brain: "competitors" as const,
            title: `${plural(suggested.length, "competitor")} suggested to track`,
            at: String(
              suggested
                .map((c) => String(c.created_at))
                .sort()
                .at(-1) ?? new Date().toISOString(),
            ),
          },
        ]
      : [],
    completedAt
      ? [
          ...(intelligence?.trendSignals ?? []).slice(0, 3).map((t, i) => ({
            id: `market:${market!.result!.collectionId}:t${i}`,
            brain: "market" as const,
            title: `${t.direction === "rising" ? "Rising" : t.direction === "declining" ? "Cooling" : "Watch"}: ${str(t.title, 140)}`,
            detail: str(t.significance, 220) || undefined,
            at: completedAt,
          })),
          ...(intelligence?.opportunities ?? []).slice(0, 2).map((o, i) => ({
            id: `market:${market!.result!.collectionId}:o${i}`,
            brain: "market" as const,
            title: `Opening: ${str(o.title, 140)}`,
            detail: str(o.recommendedAction, 220) || undefined,
            at: completedAt,
          })),
          ...(!intelligence && sources.length
            ? [
                {
                  id: `market:${market!.result!.collectionId}:s`,
                  brain: "market" as const,
                  title: `${plural(sources.length, "new source")} on your market`,
                  at: completedAt,
                },
              ]
            : []),
        ]
      : [],
    status && strategyAt
      ? [
          {
            id: `strategy:${status}:${strategyAt}`,
            brain: "strategy" as const,
            title: status === "confirmed" ? "Strategy confirmed" : "Strategy ready to review",
            at: strategyAt,
          },
        ]
      : [],
  ];

  const newest = (brain: BrainUpdate["brain"]) =>
    updates.flat().find((x) => x.brain === brain)?.title ?? "";

  return {
    brains: {
      brand: {
        ready: bHealth > 0,
        health: bHealth,
        headline:
          bHealth > 0 ? str(dna?.oneLiner, 120) || str(dna?.brandName, 80) : "Not set up yet",
        updatedAt: dnaAt,
        enabled: true,
        facts: [colors ? plural(colors, "colour") : "", lookSet ? "Look set" : ""].filter(Boolean),
      },
      audience: {
        ready: groups.length > 0,
        health: aHealth,
        headline: groups.length
          ? groups
              .slice(0, 3)
              .map((t) => str(t.name, 40))
              .join(" · ")
          : "No groups yet",
        updatedAt: (groups[0]?.updated_at as string | undefined) ?? null,
        enabled: audienceOn,
        facts: [
          groups.length ? plural(groups.length, "group") : "",
          outcomeRows.length ? plural(outcomeRows.length, "real result") : "",
        ].filter(Boolean),
      },
      competitors: {
        ready: tracked.length > 0,
        health: cHealth,
        headline: tracked.length
          ? newest("competitors") ||
            tracked
              .slice(0, 3)
              .map((c) => str(c.name, 40))
              .join(" · ")
          : suggested.length
            ? `${plural(suggested.length, "suggestion")} waiting`
            : "Nobody tracked yet",
        updatedAt: (updateRows[0]?.detected_at as string | undefined) ?? null,
        enabled: true,
        facts: [
          tracked.length ? `${tracked.length} tracked` : "",
          suggested.length ? `${suggested.length} suggested` : "",
        ].filter(Boolean),
      },
      market: {
        ready: mHealth > 0,
        health: mHealth,
        headline:
          mHealth > 0 ? str(intelligence?.summary, 140) || newest("market") : "Not checked yet",
        updatedAt: completedAt,
        enabled: true,
        facts: [sources.length ? plural(sources.length, "source") : ""].filter(Boolean),
      },
    },
    strategy: {
      status,
      // Staleness needs every brain's version; the Strategy page computes it.
      stale: false,
      updatedAt: strategyAt,
      pillars: strategy?.success
        ? strategy.data.pillars.map((p) => ({ title: p.title, share: p.share }))
        : [],
      headline: strategy?.success ? strategy.data.positioning.statement : "",
    },
    updates: mergeUpdates(updates),
    needs: readiness({
      hasWebsite: !!website,
      brandHealth: bHealth,
      lookSet,
      audienceEnabled: audienceOn,
      groups: groups.length,
      tracked: tracked.length,
      suggested: suggested.length,
      marketFresh: mHealth >= 60,
      strategy: status,
      strategyStale: false,
    }),
    generatedAt: new Date().toISOString(),
  };
}
