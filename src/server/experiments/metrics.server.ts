// metrics.server.ts — store per-page daily numbers for an experiment and
// record which days are complete per source (ADR-0024 §4, §5 step 7).
// Search Console omits zero rows, so "the page had 0 clicks" and "we have no
// data for that day" are told apart by experiment_metric_days.
import "server-only";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { addDays } from "@/lib/analytics/ranges";
import { dateRange, type MetricRow, type PageSeries } from "@/lib/experiments/series";
import { lastCompleteDay } from "@/server/analytics/sync/service.server";
import type { AssignmentRow, ExperimentRow } from "./core.server";
import {
  defaultApiFor,
  gscCompleteDates,
  pullGa4PageDaily,
  pullGscPageDaily,
  type ApiFor,
} from "./google.server";
import type { AnalyticsSource } from "./sources.server";

/** Search Console re-states recent days; re-pull this many on every run. */
export const REFRESH_DAYS = 4;
const UPSERT_CHUNK = 500;

/** The longest literal prefix all paths share, for Search Console's filter. */
export function commonPrefix(paths: string[]): string | null {
  if (!paths.length) return null;
  const split = paths.map((p) => p.split("/").filter(Boolean));
  const out: string[] = [];
  for (let i = 0; ; i++) {
    const seg = split[0][i];
    if (seg === undefined || split.some((s) => s[i] !== seg || s.length <= i + 1)) break;
    out.push(seg);
  }
  return out.length ? `/${out.join("/")}/` : null;
}

type Row = { path: string; arm: string; date: string } & Partial<MetricRow>;

async function upsertRows(experiment: ExperimentRow, rows: Row[]) {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK).map((r) => ({
      ...r,
      experiment_id: experiment.id,
      workspace_id: experiment.workspace_id,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabaseAdmin
      .from("experiment_metrics_daily")
      .upsert(chunk, { onConflict: "experiment_id,date,path" });
    if (error) throw new Error(error.message);
  }
}

async function markDays(
  experiment: ExperimentRow,
  source: "gsc" | "ga4",
  dates: string[],
  complete: boolean,
) {
  if (!dates.length) return;
  const { error } = await supabaseAdmin.from("experiment_metric_days").upsert(
    dates.map((date) => ({
      experiment_id: experiment.id,
      workspace_id: experiment.workspace_id,
      date,
      source,
      complete,
      pulled_at: new Date().toISOString(),
    })),
    { onConflict: "experiment_id,date,source" },
  );
  if (error) throw new Error(error.message);
}

/** Save a series already pulled (the pre-period, at creation). */
export async function storeSeries(args: {
  experiment: ExperimentRow;
  assignments: Pick<AssignmentRow, "path" | "arm">[];
  series: PageSeries;
  dates: string[];
  ga4Complete: boolean;
}) {
  const arm = new Map(args.assignments.map((a) => [a.path, a.arm]));
  const rows: Row[] = [];
  for (const [path, days] of Object.entries(args.series)) {
    if (!arm.has(path)) continue;
    for (const [date, v] of Object.entries(days))
      rows.push({ path, arm: arm.get(path)!, date, ...v });
  }
  await upsertRows(args.experiment, rows);
  await markDays(args.experiment, "gsc", args.dates, true);
  if (args.ga4Complete) await markDays(args.experiment, "ga4", args.dates, true);
}

export type PullOutcome = {
  from: string;
  to: string;
  gscDays: number;
  ga4Days: number;
  ga4Deferred: boolean;
};

/** Pull post-period days (and refresh the most recent ones). */
export async function pullExperimentMetrics(args: {
  experiment: ExperimentRow;
  assignments: AssignmentRow[];
  gsc: AnalyticsSource;
  ga4: AnalyticsSource | null;
  apiFor?: ApiFor;
  now?: Date;
}): Promise<PullOutcome | null> {
  const { experiment, gsc, ga4 } = args;
  const apiFor = args.apiFor ?? defaultApiFor;
  if (!experiment.live_confirmed_at) return null;
  const now = args.now ?? new Date();
  const liveDay = experiment.live_confirmed_at.slice(0, 10);
  const end = lastCompleteDay(gsc, now);

  const { data: lastDay } = await supabaseAdmin
    .from("experiment_metric_days")
    .select("date")
    .eq("experiment_id", experiment.id)
    .eq("source", "gsc")
    .eq("complete", true)
    .gt("date", liveDay)
    .order("date", { ascending: false })
    .limit(1);
  const firstPost = addDays(liveDay, 1);
  const from = lastDay?.[0]?.date ? addDays(lastDay[0].date, -REFRESH_DAYS) : firstPost;
  const start = from < firstPost ? firstPost : from;
  if (start > end) return { from: start, to: end, gscDays: 0, ga4Days: 0, ga4Deferred: false };

  const paths = args.assignments.map((a) => a.path);
  const arm = new Map(args.assignments.map((a) => [a.path, a.arm]));
  const gscApi = apiFor(gsc);
  const complete = await gscCompleteDates(gscApi, gsc.external_id, start, end);
  const gscRows = await pullGscPageDaily(
    gscApi,
    gsc.external_id,
    experiment.site_host,
    start,
    end,
    {
      prefix: commonPrefix(paths),
      paths: new Set(paths),
    },
  );
  const rows: Row[] = [];
  for (const [path, days] of gscRows) {
    for (const [date, v] of days) {
      if (complete.has(date)) rows.push({ path, arm: arm.get(path)!, date, ...v });
    }
  }
  // A complete day with no row for a page is a real zero: write it, so a
  // re-stated day that dropped to zero overwrites the earlier number.
  const completeDates = dateRange(start, end).filter((d) => complete.has(d));
  const seen = new Set(rows.map((r) => `${r.path}|${r.date}`));
  for (const d of completeDates) {
    for (const p of paths) {
      if (!seen.has(`${p}|${d}`)) {
        rows.push({
          path: p,
          arm: arm.get(p)!,
          date: d,
          clicks: 0,
          impressions: 0,
          position_weighted: 0,
        });
      }
    }
  }
  await upsertRows(experiment, rows);
  await markDays(experiment, "gsc", completeDates, true);

  let ga4Days = 0;
  let ga4Deferred = false;
  if (ga4 && ga4.status !== "access_lost") {
    const ga4End = addDays(lastCompleteDay(ga4, now), -1);
    if (start <= ga4End) {
      const pulled = await pullGa4PageDaily(apiFor(ga4), ga4.external_id, start, ga4End, paths);
      ga4Deferred = pulled.deferred;
      if (!pulled.deferred) {
        const ga4Dates = dateRange(start, ga4End);
        const ga4Rows: Row[] = [];
        for (const d of ga4Dates) {
          for (const p of paths) {
            const v = pulled.rows.get(p)?.get(d);
            ga4Rows.push({
              path: p,
              arm: arm.get(p)!,
              date: d,
              sessions: v?.sessions ?? 0,
              key_events: v?.key_events ?? 0,
              revenue: v?.revenue ?? 0,
              ai_referral_sessions: v?.ai_referral_sessions ?? 0,
            });
          }
        }
        await upsertRows(experiment, ga4Rows);
        await markDays(experiment, "ga4", ga4Dates, true);
        ga4Days = ga4Dates.length;
      }
    }
  }
  return { from: start, to: end, gscDays: completeDates.length, ga4Days, ga4Deferred };
}

/** Everything stored for an experiment, paged past PostgREST's row cap. */
export async function loadStoredSeries(experimentId: string): Promise<{
  series: PageSeries;
  complete: { gsc: Set<string>; ga4: Set<string> };
}> {
  const series: PageSeries = {};
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin
      .from("experiment_metrics_daily")
      .select(
        "date, path, clicks, impressions, position_weighted, sessions, key_events, revenue, ai_referral_sessions",
      )
      .eq("experiment_id", experimentId)
      .order("date", { ascending: true })
      .order("path", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      (series[r.path] ??= {})[r.date] = {
        clicks: Number(r.clicks),
        impressions: Number(r.impressions),
        position_weighted: Number(r.position_weighted),
        sessions: Number(r.sessions),
        key_events: Number(r.key_events),
        revenue: Number(r.revenue),
        ai_referral_sessions: Number(r.ai_referral_sessions),
      };
    }
    if (!data || data.length < pageSize) break;
  }
  const { data: days, error } = await supabaseAdmin
    .from("experiment_metric_days")
    .select("date, source, complete")
    .eq("experiment_id", experimentId)
    .eq("complete", true)
    .limit(5000);
  if (error) throw new Error(error.message);
  const complete = { gsc: new Set<string>(), ga4: new Set<string>() };
  for (const d of days ?? []) complete[d.source as "gsc" | "ga4"].add(d.date);
  return { series, complete };
}
