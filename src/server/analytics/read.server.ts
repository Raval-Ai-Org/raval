// read.server.ts — builds analytics reports from stored rows. Reads go
// through the caller's RLS client (members only see their workspace), with
// one exception: GA4 period "users" totals, which are not additive across
// days, are fetched from the Data API once per exact window and cached with
// the service role after the caller's workspace access was verified.
//
// Each report is one data source. Nothing here adds GA4 sessions to Search
// Console clicks or blends either with the AI Visibility score.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import {
  compareMetric,
  ga4Totals,
  gscTotals,
  pctChange,
  type Comparison,
} from "@/lib/analytics/compare";
import type { MetricKey } from "@/lib/analytics/metrics";
import { computeMovers } from "@/lib/analytics/movers";
import {
  addDays,
  alignToData,
  covers,
  resolveRange,
  todayIn,
  type DateWindow,
  type RangeInput,
  type ResolvedRange,
} from "@/lib/analytics/ranges";
import type { MoverGroup } from "@/lib/analytics/signals";
import type {
  AiVisibilityReport,
  GoogleConnectionView,
  Kpi,
  MelloxKpis,
  OverviewReport,
  RankedRow,
  ReportWindow,
  SearchReport,
  SeriesPoint,
  SourceStatus,
  WebsiteReport,
} from "@/lib/analytics/types";
import { CATEGORY_BY_ID } from "@/lib/geo/types";
import { getConnectionView } from "./google/service.server";
import { googleApiFor } from "./google/tokens.server";
import { sourceTimeZone } from "./sync/service.server";

type Db = SupabaseClient<Database>;
type Kind = "ga4_property" | "gsc_site";

// ── Source readiness ────────────────────────────────────────────────────────
async function dataBounds(db: Db, kind: Kind, sourceId: string) {
  const table = kind === "ga4_property" ? "analytics_ga4_daily" : "analytics_gsc_daily";
  const [first, last] = await Promise.all([
    db
      .from(table)
      .select("date")
      .eq("source_id", sourceId)
      .order("date", { ascending: true })
      .limit(1)
      .maybeSingle(),
    db
      .from(table)
      .select("date")
      .eq("source_id", sourceId)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return { firstDate: first.data?.date ?? null, lastDate: last.data?.date ?? null };
}

export async function sourceStatus(
  db: Db,
  workspaceId: string,
  kind: Kind,
  view?: GoogleConnectionView,
): Promise<SourceStatus> {
  const v = view ?? (await getConnectionView(db, workspaceId));
  const source = kind === "ga4_property" ? v.ga4 : v.gsc;
  const scopeOk =
    kind === "ga4_property" ? v.connection?.scopes.analytics : v.connection?.scopes.searchConsole;
  const base = { source, firstDate: null, lastDate: null };
  if (!v.connection) {
    return { ...base, state: v.configured ? "not_connected" : "not_configured", message: null };
  }
  if (v.connection.status !== "active") {
    return {
      ...base,
      state: "reconnect",
      message: v.connection.lastError ?? "Reconnect Google to keep syncing.",
    };
  }
  if (!scopeOk) {
    return {
      ...base,
      state: "reconnect",
      message:
        kind === "ga4_property"
          ? "Google Analytics access wasn't granted. Reconnect Google and allow it."
          : "Search Console access wasn't granted. Reconnect Google and allow it.",
    };
  }
  if (!source) return { ...base, state: "no_source", message: null };
  const bounds = await dataBounds(db, kind, source.id);
  if (source.status === "access_lost") {
    return {
      source,
      ...bounds,
      state: "error",
      message: source.lastError ?? "Mellox can't read this any more.",
    };
  }
  if (!bounds.lastDate) {
    const failed = source.run?.status === "failed";
    return {
      source,
      ...bounds,
      state: failed ? "error" : "syncing",
      message: failed ? (source.run?.errorMessage ?? "The first sync failed.") : null,
    };
  }
  return { source, ...bounds, state: "ready", message: null };
}

function reportWindow(range: ResolvedRange, firstDate: string | null): ReportWindow {
  return {
    current: range.current,
    previous: range.previous,
    previousCovered: covers(firstDate, range.previous),
    key: range.key,
    label: range.label,
  };
}

function windowFor(status: SourceStatus, input: RangeInput): ResolvedRange {
  const tz = sourceTimeZone({
    kind: status.source?.kind ?? "ga4_property",
    time_zone: status.source?.timeZone ?? null,
  });
  return alignToData(resolveRange(input, todayIn(tz)), status.lastDate);
}

function series(
  window: ReportWindow,
  values: Map<string, number | null>,
  firstDate: string | null,
  lastDate: string | null,
): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  const known = (d: string) => !!firstDate && d >= firstDate && (!lastDate || d <= lastDate);
  for (let i = 0; i < window.current.days; i++) {
    const date = addDays(window.current.from, i);
    const previousDate = addDays(window.previous.from, i);
    out.push({
      date,
      previousDate,
      value: known(date) ? (values.get(date) ?? 0) : null,
      previous:
        window.previousCovered && known(previousDate) ? (values.get(previousDate) ?? 0) : null,
    });
  }
  return out;
}

function kpi(key: MetricKey, cmp: Comparison): Kpi {
  return { key, value: cmp.current, comparison: cmp };
}

function ranked(
  current: Array<{ value: string; primary: number; extra: Record<string, number | null> }>,
  previous: Map<string, number>,
  previousCovered: boolean,
): RankedRow[] {
  return current.map((r) => {
    const prev = previousCovered ? (previous.get(r.value) ?? 0) : null;
    return {
      value: r.value,
      current: r.primary,
      previous: prev,
      pct: prev === null ? null : pctChange(r.primary, prev),
      extra: r.extra,
    };
  });
}

// ── GA4 ─────────────────────────────────────────────────────────────────────
const GA4_BREAKDOWNS = ["channel", "source_medium", "landing_page", "country", "device"] as const;

async function ga4Dimension(
  db: Db,
  sourceId: string,
  dimension: string,
  w: DateWindow,
  limit: number,
) {
  const { data, error } = await db.rpc("analytics_ga4_dimension_totals", {
    p_source_id: sourceId,
    p_dimension: dimension,
    p_from: w.from,
    p_to: w.to,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Exact GA4 users for a window: cached, else fetched once and cached. */
async function ga4Users(
  db: Db,
  workspaceId: string,
  source: NonNullable<SourceStatus["source"]>,
  connectionId: string | null,
  w: DateWindow,
): Promise<number | null> {
  const { data } = await db
    .from("analytics_ga4_period_totals")
    .select("total_users")
    .eq("source_id", source.id)
    .eq("date_from", w.from)
    .eq("date_to", w.to)
    .maybeSingle();
  if (data) return Number(data.total_users);
  if (!connectionId) return null;
  try {
    const report = await googleApiFor(connectionId, workspaceId).runGa4Report(source.externalId, {
      startDate: w.from,
      endDate: w.to,
      dimensions: [],
      metrics: ["totalUsers"],
      limit: 1,
    });
    const users = Math.round(report.rows[0]?.metrics[0] ?? 0);
    await supabaseAdmin.from("analytics_ga4_period_totals").upsert(
      {
        source_id: source.id,
        workspace_id: workspaceId,
        date_from: w.from,
        date_to: w.to,
        total_users: users,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "source_id,date_from,date_to" },
    );
    return users;
  } catch (e) {
    console.warn("[analytics] GA4 users lookup failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

const emptyWebsite = (status: SourceStatus): WebsiteReport => ({
  source: "ga4",
  status,
  window: null,
  kpis: [],
  series: { sessions: [], users: [], keyEvents: [] },
  breakdowns: { channel: [], source_medium: [], landing_page: [], country: [], device: [] },
});

export async function getWebsiteReport(
  db: Db,
  workspaceId: string,
  input: RangeInput,
  opts: { view?: GoogleConnectionView; breakdowns?: boolean } = {},
): Promise<WebsiteReport> {
  const view = opts.view ?? (await getConnectionView(db, workspaceId));
  const status = await sourceStatus(db, workspaceId, "ga4_property", view);
  if (status.state !== "ready" || !status.source) return emptyWebsite(status);
  const source = status.source;
  const window = reportWindow(windowFor(status, input), status.firstDate);

  const { data: rows, error } = await db
    .from("analytics_ga4_daily")
    .select(
      "date, sessions, total_users, new_users, engaged_sessions, screen_page_views, key_events, session_duration_seconds",
    )
    .eq("source_id", source.id)
    .gte("date", window.previous.from)
    .lte("date", window.current.to)
    .order("date");
  if (error) throw new Error(error.message);
  const all = rows ?? [];
  const inWin = (w: DateWindow) => all.filter((r) => r.date >= w.from && r.date <= w.to);
  const cur = ga4Totals(inWin(window.current));
  const prev = ga4Totals(inWin(window.previous));
  const covered = window.previousCovered;
  const connectionId = view.connection?.status === "active" ? view.connection.id : null;
  const [usersCur, usersPrev] = await Promise.all([
    ga4Users(db, workspaceId, source, connectionId, window.current),
    covered
      ? ga4Users(db, workspaceId, source, connectionId, window.previous)
      : Promise.resolve(null),
  ]);
  const o = { previousCovered: covered };
  const kpis: Kpi[] = [
    kpi("ga4.sessions", compareMetric("ga4.sessions", cur.sessions, prev.sessions, o)),
    kpi("ga4.users", compareMetric("ga4.users", usersCur, usersPrev, o)),
    kpi("ga4.newUsers", compareMetric("ga4.newUsers", cur.newUsers, prev.newUsers, o)),
    kpi(
      "ga4.engagedSessions",
      compareMetric("ga4.engagedSessions", cur.engagedSessions, prev.engagedSessions, o),
    ),
    kpi("ga4.keyEvents", compareMetric("ga4.keyEvents", cur.keyEvents, prev.keyEvents, o)),
    kpi(
      "ga4.engagementRate",
      compareMetric("ga4.engagementRate", cur.engagementRate, prev.engagementRate, {
        ...o,
        volume: Math.min(cur.sessions, prev.sessions),
      }),
    ),
    kpi("ga4.pageViews", compareMetric("ga4.pageViews", cur.pageViews, prev.pageViews, o)),
    kpi(
      "ga4.avgSessionDuration",
      compareMetric("ga4.avgSessionDuration", cur.avgSessionDuration, prev.avgSessionDuration, {
        ...o,
        volume: Math.min(cur.sessions, prev.sessions),
      }),
    ),
  ];
  const byDate = (pick: (r: (typeof all)[number]) => number) =>
    new Map(all.map((r) => [r.date, pick(r)]));
  const report: WebsiteReport = {
    source: "ga4",
    status,
    window,
    kpis,
    series: {
      sessions: series(
        window,
        byDate((r) => Number(r.sessions)),
        status.firstDate,
        status.lastDate,
      ),
      users: series(
        window,
        byDate((r) => Number(r.total_users)),
        status.firstDate,
        status.lastDate,
      ),
      keyEvents: series(
        window,
        byDate((r) => Number(r.key_events)),
        status.firstDate,
        status.lastDate,
      ),
    },
    breakdowns: { channel: [], source_medium: [], landing_page: [], country: [], device: [] },
  };
  if (opts.breakdowns === false) return report;
  await Promise.all(
    GA4_BREAKDOWNS.map(async (dim) => {
      const [c, p] = await Promise.all([
        ga4Dimension(db, source.id, dim, window.current, 25),
        covered ? ga4Dimension(db, source.id, dim, window.previous, 200) : Promise.resolve([]),
      ]);
      report.breakdowns[dim] = ranked(
        c.map((r) => ({
          value: r.value,
          primary: Number(r.sessions),
          extra: { pageViews: Number(r.screen_page_views), keyEvents: Number(r.key_events) },
        })),
        new Map(p.map((r) => [r.value, Number(r.sessions)])),
        covered,
      );
    }),
  );
  return report;
}

// ── Search Console ──────────────────────────────────────────────────────────
const GSC_BREAKDOWNS = ["query", "page", "country", "device"] as const;

async function gscDimension(
  db: Db,
  sourceId: string,
  dimension: string,
  w: DateWindow,
  limit: number,
) {
  const { data, error } = await db.rpc("analytics_gsc_dimension_totals", {
    p_source_id: sourceId,
    p_dimension: dimension,
    p_from: w.from,
    p_to: w.to,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

const emptySearch = (status: SourceStatus): SearchReport => ({
  source: "gsc",
  status,
  window: null,
  kpis: [],
  series: { clicks: [], impressions: [], position: [] },
  breakdowns: { query: [], page: [], country: [], device: [] },
});

export async function getSearchReport(
  db: Db,
  workspaceId: string,
  input: RangeInput,
  opts: { view?: GoogleConnectionView; breakdowns?: boolean } = {},
): Promise<SearchReport> {
  const view = opts.view ?? (await getConnectionView(db, workspaceId));
  const status = await sourceStatus(db, workspaceId, "gsc_site", view);
  if (status.state !== "ready" || !status.source) return emptySearch(status);
  const source = status.source;
  const window = reportWindow(windowFor(status, input), status.firstDate);

  const { data: rows, error } = await db
    .from("analytics_gsc_daily")
    .select("date, clicks, impressions, position_weighted")
    .eq("source_id", source.id)
    .gte("date", window.previous.from)
    .lte("date", window.current.to)
    .order("date");
  if (error) throw new Error(error.message);
  const all = rows ?? [];
  const inWin = (w: DateWindow) => all.filter((r) => r.date >= w.from && r.date <= w.to);
  const cur = gscTotals(inWin(window.current));
  const prev = gscTotals(inWin(window.previous));
  const o = { previousCovered: window.previousCovered };
  const volume = Math.min(cur.impressions, prev.impressions);
  const kpis: Kpi[] = [
    kpi("gsc.clicks", compareMetric("gsc.clicks", cur.clicks, prev.clicks, o)),
    kpi("gsc.impressions", compareMetric("gsc.impressions", cur.impressions, prev.impressions, o)),
    kpi("gsc.ctr", compareMetric("gsc.ctr", cur.ctr, prev.ctr, { ...o, volume })),
    kpi(
      "gsc.position",
      compareMetric("gsc.position", cur.position, prev.position, { ...o, volume }),
    ),
  ];
  const byDate = (pick: (r: (typeof all)[number]) => number | null) =>
    new Map(all.map((r) => [r.date, pick(r)]));
  const report: SearchReport = {
    source: "gsc",
    status,
    window,
    kpis,
    series: {
      clicks: series(
        window,
        byDate((r) => Number(r.clicks)),
        status.firstDate,
        status.lastDate,
      ),
      impressions: series(
        window,
        byDate((r) => Number(r.impressions)),
        status.firstDate,
        status.lastDate,
      ),
      position: series(
        window,
        byDate((r) =>
          Number(r.impressions) > 0 ? Number(r.position_weighted) / Number(r.impressions) : null,
        ),
        status.firstDate,
        status.lastDate,
      ),
    },
    breakdowns: { query: [], page: [], country: [], device: [] },
  };
  if (opts.breakdowns === false) return report;
  await Promise.all(
    GSC_BREAKDOWNS.map(async (dim) => {
      const [c, p] = await Promise.all([
        gscDimension(db, source.id, dim, window.current, 25),
        window.previousCovered
          ? gscDimension(db, source.id, dim, window.previous, 200)
          : Promise.resolve([]),
      ]);
      report.breakdowns[dim] = ranked(
        c.map((r) => {
          const impressions = Number(r.impressions);
          return {
            value: r.value,
            primary: Number(r.clicks),
            extra: {
              impressions,
              ctr: impressions > 0 ? Number(r.clicks) / impressions : null,
              position: impressions > 0 ? Number(r.position_weighted) / impressions : null,
            },
          };
        }),
        new Map(p.map((r) => [r.value, Number(r.clicks)])),
        window.previousCovered,
      );
    }),
  );
  return report;
}

// ── AI Visibility (Mellox scan) ─────────────────────────────────────────────
export async function getAiVisibilityReport(
  db: Db,
  workspaceId: string,
  input: RangeInput,
): Promise<AiVisibilityReport> {
  const range = resolveRange(input, todayIn("UTC"));
  const since = addDays(range.previous.from, -180);
  const [{ data: runs, error }, { data: scan }] = await Promise.all([
    db
      .from("geo_audit_runs")
      .select("score, subscores, url, meta, created_at")
      .eq("workspace_id", workspaceId)
      .gte("created_at", `${since}T00:00:00Z`)
      .order("created_at", { ascending: true })
      .limit(500),
    db
      .from("geo_scans")
      .select("probes, completed_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "succeeded")
      .not("probes", "is", null)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (error) throw new Error(error.message);
  const list = runs ?? [];
  const day = (iso: string) => iso.slice(0, 10);
  const lastUpTo = (to: string) => [...list].reverse().find((r) => day(r.created_at) <= to) ?? null;
  const cur = lastUpTo(range.current.to);
  const prev = lastUpTo(range.previous.to);
  const latest = list.length ? list[list.length - 1] : null;
  const subscores = (latest?.subscores ?? {}) as Record<string, number>;
  const meta = (latest?.meta ?? {}) as {
    actions?: Array<{ id: string; priority: string; title: string; detail: string }>;
  };
  const probes = scan?.probes as {
    ranAt?: string;
    answers?: number;
    mentionRate?: number;
    citationRate?: number;
  } | null;
  return {
    source: "geo",
    latest: latest
      ? {
          score: Number(latest.score),
          url: latest.url,
          scannedAt: latest.created_at,
          categories: Object.entries(subscores)
            .filter(([, v]) => typeof v === "number")
            .map(([id, score]) => ({
              id,
              name:
                CATEGORY_BY_ID[id as keyof typeof CATEGORY_BY_ID]?.name ?? id.replace(/_/g, " "),
              score: Math.round(score),
            })),
        }
      : null,
    kpi: kpi(
      "geo.score",
      compareMetric("geo.score", cur ? Number(cur.score) : null, prev ? Number(prev.score) : null, {
        previousCovered: !!prev,
      }),
    ),
    history: list
      .filter(
        (r) => day(r.created_at) >= range.previous.from && day(r.created_at) <= range.current.to,
      )
      .map((r) => ({ date: r.created_at, score: Number(r.score) })),
    probes:
      probes && typeof probes.mentionRate === "number"
        ? {
            ranAt: probes.ranAt ?? scan?.completed_at ?? "",
            answers: Number(probes.answers ?? 0),
            mentionRate: probes.mentionRate,
            citationRate: Number(probes.citationRate ?? 0),
          }
        : null,
    topActions: (meta.actions ?? []).slice(0, 6),
  };
}

// ── Mellox internal activity ────────────────────────────────────────────────
async function countContent(db: Db, workspaceId: string, w: DateWindow, status?: string) {
  let q = db
    .from("content_items")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .gte("created_at", `${w.from}T00:00:00Z`)
    .lt("created_at", `${addDays(w.to, 1)}T00:00:00Z`);
  if (status) q = q.eq("status", status);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function countPendingApprovals(db: Db, workspaceId: string, w: DateWindow) {
  const { count, error } = await db
    .from("approvals")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "pending")
    .gte("created_at", `${w.from}T00:00:00Z`)
    .lt("created_at", `${addDays(w.to, 1)}T00:00:00Z`);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function getMelloxKpis(
  db: Db,
  workspaceId: string,
  input: RangeInput,
): Promise<MelloxKpis> {
  const range = resolveRange(input, todayIn("UTC"));
  const { data: ws } = await db
    .from("workspaces")
    .select("created_at")
    .eq("id", workspaceId)
    .maybeSingle();
  const firstDate = ws?.created_at ? ws.created_at.slice(0, 10) : null;
  const window = reportWindow(range, firstDate);
  const [created, published, scheduled, approvals, pCreated, pPublished, pScheduled, pApprovals] =
    await Promise.all([
      countContent(db, workspaceId, range.current),
      countContent(db, workspaceId, range.current, "published"),
      countContent(db, workspaceId, range.current, "scheduled"),
      countPendingApprovals(db, workspaceId, range.current),
      countContent(db, workspaceId, range.previous),
      countContent(db, workspaceId, range.previous, "published"),
      countContent(db, workspaceId, range.previous, "scheduled"),
      countPendingApprovals(db, workspaceId, range.previous),
    ]);
  const o = { previousCovered: window.previousCovered };
  return {
    source: "mellox",
    window,
    kpis: [
      kpi("mellox.created", compareMetric("mellox.created", created, pCreated, o)),
      kpi("mellox.published", compareMetric("mellox.published", published, pPublished, o)),
      kpi("mellox.scheduled", compareMetric("mellox.scheduled", scheduled, pScheduled, o)),
      kpi(
        "mellox.approvalsPending",
        compareMetric("mellox.approvalsPending", approvals, pApprovals, o),
      ),
    ],
  };
}

// ── Overview ────────────────────────────────────────────────────────────────
export async function getOverviewReport(
  db: Db,
  workspaceId: string,
  input: RangeInput,
): Promise<OverviewReport> {
  const view = await getConnectionView(db, workspaceId);
  const [mellox, website, search, ai] = await Promise.all([
    getMelloxKpis(db, workspaceId, input),
    getWebsiteReport(db, workspaceId, input, { view }),
    getSearchReport(db, workspaceId, input, { view }),
    getAiVisibilityReport(db, workspaceId, input),
  ]);
  const pick = (kpis: Kpi[], keys: MetricKey[]) => kpis.filter((k) => keys.includes(k.key));
  return {
    mellox,
    website: {
      status: website.status,
      window: website.window,
      kpis: pick(website.kpis, [
        "ga4.sessions",
        "ga4.users",
        "ga4.engagedSessions",
        "ga4.keyEvents",
        "ga4.engagementRate",
        "ga4.avgSessionDuration",
      ]),
      series: website.series.sessions,
      usersSeries: website.series.users,
      keyEventsSeries: website.series.keyEvents,
      landingPages: website.breakdowns.landing_page,
      channels: website.breakdowns.channel,
    },
    search: {
      status: search.status,
      window: search.window,
      kpis: pick(search.kpis, ["gsc.clicks", "gsc.impressions", "gsc.ctr", "gsc.position"]),
      series: search.series.clicks,
      impressionsSeries: search.series.impressions,
      positionSeries: search.series.position,
      queries: search.breakdowns.query,
      pages: search.breakdowns.page,
    },
    aiVisibility: { latest: ai.latest, kpi: ai.kpi, history: ai.history },
  };
}

// ── Insight inputs ──────────────────────────────────────────────────────────
/** Every significant-change candidate for a range, per source (inputs to signals.ts). */
export async function getInsightInputs(
  db: Db,
  workspaceId: string,
  input: RangeInput,
): Promise<{
  window: ReportWindow;
  metrics: Partial<Record<MetricKey, Comparison>>;
  movers: MoverGroup[];
}> {
  const view = await getConnectionView(db, workspaceId);
  const [mellox, website, search, ai] = await Promise.all([
    getMelloxKpis(db, workspaceId, input),
    getWebsiteReport(db, workspaceId, input, { view, breakdowns: false }),
    getSearchReport(db, workspaceId, input, { view, breakdowns: false }),
    getAiVisibilityReport(db, workspaceId, input),
  ]);
  const metrics: Partial<Record<MetricKey, Comparison>> = {};
  for (const k of [...mellox.kpis, ...website.kpis, ...search.kpis, ai.kpi])
    metrics[k.key] = k.comparison;

  const movers: MoverGroup[] = [];
  const moverFor = async (
    kind: Kind,
    status: SourceStatus,
    window: ReportWindow | null,
    dims: Array<{ dimension: string; label: string }>,
  ) => {
    if (status.state !== "ready" || !status.source || !window?.previousCovered) return;
    const sourceId = status.source.id;
    for (const d of dims) {
      const [c, p] = await Promise.all(
        [window.current, window.previous].map((w) =>
          kind === "ga4_property"
            ? ga4Dimension(db, sourceId, d.dimension, w, 100).then((rows) =>
                rows.map((r) => [r.value, Number(r.sessions)] as const),
              )
            : gscDimension(db, sourceId, d.dimension, w, 100).then((rows) =>
                rows.map((r) => [r.value, Number(r.clicks)] as const),
              ),
        ),
      );
      const m = computeMovers(
        new Map(c),
        new Map(p),
        kind === "ga4_property" ? { minBase: 30, minAbs: 15 } : { minBase: 20, minAbs: 10 },
      );
      if (m.risers.length || m.fallers.length) {
        movers.push({
          source: kind === "ga4_property" ? "ga4" : "gsc",
          metric: kind === "ga4_property" ? "ga4.sessions" : "gsc.clicks",
          dimension: d.dimension,
          dimensionLabel: d.label,
          ...m,
        });
      }
    }
  };
  await Promise.all([
    moverFor("ga4_property", website.status, website.window, [
      { dimension: "landing_page", label: "Landing page" },
      { dimension: "channel", label: "Channel" },
    ]),
    moverFor("gsc_site", search.status, search.window, [
      { dimension: "query", label: "Search term" },
      { dimension: "page", label: "Page" },
    ]),
  ]);
  return { window: mellox.window, metrics, movers };
}
