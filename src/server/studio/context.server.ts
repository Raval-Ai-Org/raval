// context.server.ts — everything Studio knows about a workspace when it writes:
// brand, business, what was published recently (so it doesn't repeat itself),
// what's scheduled, market and competitor signals, and upcoming moments.
// Workspace data is cached briefly. Brand DNA is read from the database for the
// job's own workspace; a request-supplied copy is only used when none is stored.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serializeBrandContext, type BrandCtxDna } from "@/lib/ai/brand-context";
import { readBrandDna } from "@/server/workspaces/brand-dna.server";
import { getLatestMarketBrain } from "@/lib/market-brain-latest.server";
import { upcomingMoments } from "@/lib/studio/moments";
import type { StudioContext } from "@/lib/studio/prompts";
import { recentPerformanceSignals } from "@/lib/studio/performance";
import { openingLine } from "@/lib/studio/memory";
import { getSocialTrends } from "./social-trends.server";

type WorkspaceSnapshot = Omit<StudioContext, "brandText" | "brandName" | "moments" | "today"> & {
  name: string;
};

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: WorkspaceSnapshot }>();

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function settle<T>(promise: PromiseLike<T>, fallback: T, label: string): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    console.warn(
      `[studio-context] ${label} unavailable`,
      error instanceof Error ? error.message : error,
    );
    return fallback;
  }
}

async function loadWorkspaceSnapshot(
  db: SupabaseClient,
  workspaceId: string,
): Promise<WorkspaceSnapshot> {
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const now = new Date();
  const in14 = new Date(now.getTime() + 14 * 86_400_000).toISOString();

  const [workspace, recent, upcoming, alerts, insights, market, publications] = await Promise.all([
    settle(
      db
        .from("workspaces")
        .select("name, industry, audience, website_url")
        .eq("id", workspaceId)
        .maybeSingle(),
      { data: null, error: null } as never,
      "workspace",
    ),
    settle(
      db
        .from("content_items")
        .select("id, title, body, kind, channel, meta, created_at, status")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(40),
      { data: [], error: null } as never,
      "recent content",
    ),
    settle(
      db
        .from("content_items")
        .select("title, channel, scheduled_at")
        .eq("workspace_id", workspaceId)
        .eq("status", "scheduled")
        .gte("scheduled_at", now.toISOString())
        .lte("scheduled_at", in14)
        .order("scheduled_at", { ascending: true })
        .limit(15),
      { data: [], error: null } as never,
      "schedule",
    ),
    // competitor_updates is the researched feed (a launch, a price change, a
    // repositioning), already filtered for significance. The legacy
    // competitor_alerts table held raw page diffs, which made most of what
    // reached a prompt noise.
    settle(
      db
        .from("competitor_updates")
        .select("title, summary, significance, detected_at")
        .eq("workspace_id", workspaceId)
        .order("detected_at", { ascending: false })
        .limit(5),
      { data: [], error: null } as never,
      "competitor updates",
    ),
    settle(
      db
        .from("memory_insights")
        .select("body, kind")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(8),
      { data: [], error: null } as never,
      "insights",
    ),
    settle(getLatestMarketBrain(workspaceId), null, "market brain"),
    settle(
      db
        .from("content_publications")
        .select("content_item_id, platform, status, metrics")
        .eq("workspace_id", workspaceId)
        .eq("status", "published")
        .gte("delivered_at", new Date(now.getTime() - 90 * 86_400_000).toISOString())
        .order("delivered_at", { ascending: false })
        .limit(100),
      { data: [], error: null } as never,
      "publication outcomes",
    ),
  ]);

  type Row = Record<string, unknown>;
  const ws = record((workspace as { data: unknown }).data);
  const recentRows = ((recent as { data: Row[] | null }).data ?? []) as Row[];
  const upcomingRows = ((upcoming as { data: Row[] | null }).data ?? []) as Row[];
  const alertRows = ((alerts as { data: Row[] | null }).data ?? []) as Row[];
  const insightRows = ((insights as { data: Row[] | null }).data ?? []) as Row[];
  const publicationRows = ((publications as { data: Row[] | null }).data ?? []) as Row[];

  const intelligence = market?.intelligence ?? null;

  const value: WorkspaceSnapshot = {
    name: str(ws.name) ?? "the brand",
    industry: str(ws.industry),
    audience: str(ws.audience),
    website: str(ws.website_url),
    recent: recentRows.map((r) => {
      const meta = record(r.meta);
      const title =
        str(r.title) ??
        str(r.body)
          ?.split("\n")
          .find((line) => line.trim())
          ?.slice(0, 90) ??
        "Untitled";
      const story = record(meta.story);
      const storyFrames = Array.isArray(story.frames) ? story.frames.map(record) : [];
      const look = meta.carousel ? record(meta.carousel) : record(story.spec);
      return {
        title: title.replace(/^#+\s*/, "").slice(0, 120),
        type: str(meta.studio_type) ?? str(r.kind) ?? "post",
        channel: str(r.channel),
        angle: str(meta.angle),
        status: str(r.status),
        createdAt: String(r.created_at ?? ""),
        // What a reader saw first: a carousel's cover or a Story's first frame, else the first line.
        hook:
          (Array.isArray(meta.slides) ? str(record(meta.slides[0]).heading) : null) ??
          (storyFrames.length ? str(storyFrames[0].heading) : null) ??
          (openingLine(str(r.body)) || undefined),
        storyTheme: str(story.theme),
        hookStyle: str(meta.hook_style),
        structure: str(record(meta.carousel).structure),
        design:
          meta.carousel || story.spec
            ? {
                colorway: str(record(look.design).colorway) ?? undefined,
                motif: str(record(look.design).motif) ?? undefined,
              }
            : null,
        sample: str(r.body)?.slice(0, 500),
        excerpt: (
          str(meta.concept) ??
          (Array.isArray(meta.slides)
            ? meta.slides
                .map((slide) => {
                  const item = record(slide);
                  return [str(item.heading), str(item.body)].filter(Boolean).join(" ");
                })
                .join(" ")
            : null) ??
          (storyFrames.length
            ? storyFrames
                .map((f) => [str(f.heading), str(f.body)].filter(Boolean).join(" "))
                .join(" ")
            : null) ??
          str(r.body)
        )
          ?.replace(/\s+/g, " ")
          .slice(0, 400),
      };
    }),
    upcoming: upcomingRows.map((r) => ({
      title: str(r.title) ?? "Scheduled post",
      channel: str(r.channel),
      scheduledAt: String(r.scheduled_at ?? ""),
    })),
    opportunities: [
      ...(intelligence?.opportunities ?? []).map((o) => `${o.title} — ${o.recommendedAction}`),
      ...(intelligence?.trendSignals ?? [])
        .filter((t) => t.direction === "rising")
        .map((t) => `Rising: ${t.title}`),
    ].slice(0, 6),
    risingQueries: [...new Set(intelligence?.relatedQueries ?? [])].slice(0, 8),
    competitorMoves: alertRows
      .map((a) => [str(a.title), str(a.summary)].filter(Boolean).join(": ").slice(0, 240))
      .filter(Boolean),
    insights: insightRows.map((i) => (str(i.body) ?? "").slice(0, 240)).filter(Boolean),
    performanceSignals: recentPerformanceSignals(
      recentRows.map((r) => ({
        id: str(r.id) ?? "",
        title: str(r.title) ?? "Untitled",
        status: str(r.status) ?? "",
      })),
      publicationRows.map((r) => ({
        content_item_id: str(r.content_item_id) ?? "",
        platform: str(r.platform) ?? "social",
        status: str(r.status) ?? "",
        metrics: r.metrics,
      })),
    ),
  };
  cache.set(workspaceId, { at: Date.now(), value });
  return value;
}

export function invalidateStudioContext(workspaceId: string) {
  cache.delete(workspaceId);
}

export async function loadStudioContext(
  db: SupabaseClient,
  workspaceId: string,
  brand: Record<string, unknown> | null | undefined,
): Promise<StudioContext & { brand: Record<string, unknown> | null }> {
  const [snapshot, stored, socialTrends] = await Promise.all([
    loadWorkspaceSnapshot(db, workspaceId),
    settle(readBrandDna(db, workspaceId), null, "brand dna"),
    // The stored snapshot only; a job never searches for trends itself.
    getSocialTrends(),
  ]);
  const storedDna = stored && Object.keys(stored.dna).length ? stored.dna : null;
  const dna = (storedDna ?? brand ?? null) as BrandCtxDna | null;
  const brandText = serializeBrandContext(dna, {
    siteUrl: snapshot.website,
    maxCharsPerField: 320,
  }).slice(0, 5000);
  const insightsBlock = snapshot.insights.length
    ? `\n\n## Workspace notes\n${snapshot.insights
        .slice(0, 5)
        .map((i) => `- ${i}`)
        .join("\n")}`
    : "";
  const { name, ...rest } = snapshot;
  return {
    ...rest,
    brand: dna as Record<string, unknown> | null,
    brandName: str(dna?.brandName) ?? name,
    brandText: `${brandText}${insightsBlock}`.trim(),
    today: new Date().toISOString().slice(0, 10),
    socialTrends,
    moments: upcomingMoments(new Date(), { limit: 4 }),
  };
}
