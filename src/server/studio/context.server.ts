// context.server.ts — everything Studio knows about a workspace when it writes:
// brand, business, what was published recently (so it doesn't repeat itself),
// what's scheduled, market and competitor signals, and upcoming moments.
// Workspace data is cached briefly; Brand DNA arrives with each request because
// it lives in the browser.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serializeBrandContext, type BrandCtxDna } from "@/lib/ai/brand-context";
import { getLatestMarketBrain } from "@/lib/market-brain-latest.server";
import { upcomingMoments } from "@/lib/studio/moments";
import type { StudioContext } from "@/lib/studio/prompts";

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

  const [workspace, recent, upcoming, alerts, insights, market] = await Promise.all([
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
        .select("title, body, kind, channel, meta, created_at, status")
        .eq("workspace_id", workspaceId)
        .neq("status", "rejected")
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
    settle(
      db
        .from("competitor_alerts")
        .select("title, detail, severity, detected_at")
        .eq("workspace_id", workspaceId)
        .order("detected_at", { ascending: false })
        .limit(5),
      { data: [], error: null } as never,
      "competitor alerts",
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
  ]);

  type Row = Record<string, unknown>;
  const ws = record((workspace as { data: unknown }).data);
  const recentRows = ((recent as { data: Row[] | null }).data ?? []) as Row[];
  const upcomingRows = ((upcoming as { data: Row[] | null }).data ?? []) as Row[];
  const alertRows = ((alerts as { data: Row[] | null }).data ?? []) as Row[];
  const insightRows = ((insights as { data: Row[] | null }).data ?? []) as Row[];

  const intelligence = market?.intelligence ?? null;
  const rising =
    market?.result?.data?.relatedQueries?.filter((q) => q.kind === "rising").map((q) => q.query) ??
    [];

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
      return {
        title: title.replace(/^#+\s*/, "").slice(0, 120),
        type: str(meta.studio_type) ?? str(r.kind) ?? "post",
        channel: str(r.channel),
        angle: str(meta.angle),
        createdAt: String(r.created_at ?? ""),
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
    risingQueries: [...new Set([...rising, ...(intelligence?.relatedQueries ?? [])])].slice(0, 8),
    competitorMoves: alertRows
      .map((a) => [str(a.title), str(a.detail)].filter(Boolean).join(": ").slice(0, 240))
      .filter(Boolean),
    insights: insightRows.map((i) => (str(i.body) ?? "").slice(0, 240)).filter(Boolean),
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
): Promise<StudioContext> {
  const snapshot = await loadWorkspaceSnapshot(db, workspaceId);
  const dna = (brand ?? null) as BrandCtxDna | null;
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
    brandName: str(dna?.brandName) ?? name,
    brandText: `${brandText}${insightsBlock}`.trim(),
    today: new Date().toISOString().slice(0, 10),
    moments: upcomingMoments(new Date(), { limit: 4 }),
  };
}
