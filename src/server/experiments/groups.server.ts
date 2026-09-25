// groups.server.ts — find groups of comparable pages and decide whether each
// can carry a test (ADR-0024 §5 steps 1 and 3).
//
//   detect       Search Console pages of the last 56 days → URL-pattern
//                clusters (groups.ts) → the route file that renders each,
//                from the repository tree.
//   eligibility  per metric: pull the pre-period per page and run
//                checkEligibility; cached on the group for a day.
//   loadSeries   the same pull, reused when an experiment is created, so
//                the assignment and the stored baseline use identical numbers.
import "server-only";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { addDays } from "@/lib/analytics/ranges";
import {
  GSC_METRICS,
  PRE_PERIOD_DAYS,
  type ChangeType,
  type ExperimentMetric,
} from "@/lib/experiments/constants";
import type { EligibilityView, IntegrationState, PageGroupView } from "@/lib/experiments/contracts";
import { checkEligibility } from "@/lib/experiments/eligibility";
import { clusterPages, findTemplateFile, templateFrameworkFor } from "@/lib/experiments/groups";
import { ZERO_ROW, type PageSeries } from "@/lib/experiments/series";
import { getBranch, getTreePaths } from "@/server/connectors/github/git.server";
import { withAccess } from "@/server/connectors/github/service.server";
import { lastCompleteDay } from "@/server/analytics/sync/service.server";
import { ExperimentError, requireEditor, type ExperimentCtx, type GroupRow } from "./core.server";
import {
  defaultApiFor,
  gscCompleteDates,
  prefixOf,
  pullGa4PageDaily,
  pullGscPageDaily,
  pullGscPages,
  type ApiFor,
} from "./google.server";
import {
  loadSiteSources,
  normHost,
  requireGsc,
  requireWritableSource,
  type SiteSources,
} from "./sources.server";

const ELIGIBILITY_TTL_MS = 24 * 3600_000;

export function pathsHash(paths: string[]): string {
  return createHash("sha256")
    .update([...paths].sort().join("\n"))
    .digest("hex")
    .slice(0, 16);
}

/* ───────────────────────── series ───────────────────────── */

export type LoadedSeries = {
  series: PageSeries;
  preDates: string[];
  ga4: { available: boolean; deferred: boolean };
};

/**
 * Pre-period numbers per page: the last PRE_PERIOD_DAYS days Search Console
 * has final data for (and, for GA4 metrics, GA4 has finished processing).
 */
export async function loadSeries(args: {
  sources: SiteSources;
  host: string;
  pattern: string;
  paths: string[];
  metric: ExperimentMetric;
  apiFor?: ApiFor;
  now?: Date;
}): Promise<LoadedSeries> {
  const apiFor = args.apiFor ?? defaultApiFor;
  const gsc = requireGsc(args.sources, args.host);
  const gscApi = apiFor(gsc);
  const now = args.now ?? new Date();
  const end = lastCompleteDay(gsc, now);
  const start = addDays(end, -(PRE_PERIOD_DAYS + 14));
  const complete = [...(await gscCompleteDates(gscApi, gsc.external_id, start, end))].sort();
  let dates = complete;
  const ga4 = args.sources.ga4;
  const needGa4 = !GSC_METRICS.includes(args.metric);
  if (needGa4) {
    if (!ga4) throw new ExperimentError("Connect Google Analytics to test this metric.", 409);
    // GA4 revises the most recent day; one extra day of margin.
    const ga4End = addDays(lastCompleteDay(ga4, now), -1);
    dates = dates.filter((d) => d <= ga4End);
  }
  const preDates = dates.slice(-PRE_PERIOD_DAYS);
  const series: PageSeries = {};
  for (const p of args.paths) series[p] = {};
  if (!preDates.length) return { series, preDates, ga4: { available: !!ga4, deferred: false } };

  const wanted = new Set(args.paths);
  const gscRows = await pullGscPageDaily(
    gscApi,
    gsc.external_id,
    args.host,
    preDates[0],
    preDates[preDates.length - 1],
    { prefix: prefixOf(args.pattern), paths: wanted },
  );
  const keep = new Set(preDates);
  for (const [path, days] of gscRows) {
    for (const [date, v] of days) {
      if (!keep.has(date)) continue;
      series[path][date] = { ...ZERO_ROW, ...v };
    }
  }

  let deferred = false;
  if (ga4 && ga4.status !== "access_lost") {
    try {
      const pulled = await pullGa4PageDaily(
        apiFor(ga4),
        ga4.external_id,
        preDates[0],
        preDates[preDates.length - 1],
        args.paths,
      );
      deferred = pulled.deferred;
      for (const [path, days] of pulled.rows) {
        for (const [date, v] of days) {
          if (!keep.has(date)) continue;
          series[path][date] = { ...(series[path][date] ?? ZERO_ROW), ...v };
        }
      }
    } catch (error) {
      // Revenue is a nice-to-have for GSC metrics; a GA4 metric can't go on without it.
      if (needGa4) throw error;
      deferred = true;
    }
  }
  if (needGa4 && deferred) {
    throw new ExperimentError(
      "Google Analytics has used up today's data allowance. Try again tomorrow.",
      429,
    );
  }
  return { series, preDates, ga4: { available: !!ga4, deferred } };
}

/* ───────────────────────── views ───────────────────────── */

type StoredEligibility = Partial<Record<ExperimentMetric, EligibilityView & { pathsHash: string }>>;

async function integrationStates(
  workspaceId: string,
  sourceId: string | null,
): Promise<Map<string, IntegrationState>> {
  const out = new Map<string, IntegrationState>();
  if (!sourceId) return out;
  const { data, error } = await supabaseAdmin
    .from("experiment_deliveries")
    .select("id, status, pr_url, template_files, fields, created_at")
    .eq("workspace_id", workspaceId)
    .eq("source_id", sourceId)
    .eq("kind", "integration")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    for (const file of row.template_files ?? []) {
      if (out.has(file)) continue;
      if (row.status === "live") {
        out.set(file, {
          state: "ready",
          fields: (row.fields ?? []) as ChangeType[],
          templateFiles: row.template_files ?? [],
        });
      } else if (["draft", "applying", "pr_open", "merged"].includes(row.status)) {
        out.set(file, {
          state: "pending",
          deliveryId: row.id,
          status: row.status,
          prUrl: row.pr_url,
        });
      }
    }
  }
  return out;
}

async function busyPaths(workspaceId: string, host: string): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from("experiment_assignments")
    .select("path")
    .eq("workspace_id", workspaceId)
    .eq("site_host", host)
    .eq("active", true);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => r.path));
}

export async function groupViews(
  workspaceId: string,
  sources: SiteSources,
): Promise<PageGroupView[]> {
  if (!sources.source) return [];
  const { data, error } = await supabaseAdmin
    .from("experiment_page_groups")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("source_id", sources.source.id)
    .order("monthly_clicks", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as GroupRow[];
  const [integrations, busy] = await Promise.all([
    integrationStates(workspaceId, sources.source.id),
    busyPaths(workspaceId, normHost(sources.source.site_host)),
  ]);
  return rows.map((g) => {
    const stored = (g.eligibility ?? {}) as StoredEligibility;
    const hash = pathsHash(g.paths);
    const eligibility: PageGroupView["eligibility"] = {};
    for (const [metric, view] of Object.entries(stored)) {
      if (view && view.pathsHash === hash) eligibility[metric as ExperimentMetric] = view;
    }
    return {
      id: g.id,
      label: g.label,
      pattern: g.pattern,
      pageCount: g.page_count,
      monthlyClicks: Math.round(Number(g.monthly_clicks) || 0),
      templateFile: g.template_file,
      detectedAt: g.detected_at,
      busyPages: g.paths.filter((p) => busy.has(p)).length,
      integration: g.template_file
        ? (integrations.get(g.template_file) ?? { state: "none", reason: null })
        : {
            state: "none",
            reason: "Mellox couldn't find the file in your repository that builds these pages.",
          },
      eligibility,
    };
  });
}

/* ───────────────────────── detection ───────────────────────── */

export async function detectGroups(ctx: ExperimentCtx, deps: { apiFor?: ApiFor } = {}) {
  requireEditor(ctx);
  const sources = await loadSiteSources(ctx.workspaceId);
  const { source, connection, host, baseBranch } = requireWritableSource(sources);
  const gsc = requireGsc(sources, host);
  const api = (deps.apiFor ?? defaultApiFor)(gsc);
  const end = lastCompleteDay(gsc);
  const pages = await pullGscPages(
    api,
    gsc.external_id,
    host,
    addDays(end, -(PRE_PERIOD_DAYS - 1)),
    end,
  );
  const candidates = clusterPages(pages);

  const installationId = connection.external_account_id;
  const branch = await withAccess(connection, ctx.userId, () =>
    getBranch(installationId, source.full_name, baseBranch),
  );
  if (!branch)
    throw new ExperimentError(`Branch “${baseBranch}” wasn't found in ${source.full_name}.`, 409);
  const tree = await withAccess(connection, ctx.userId, () =>
    getTreePaths(installationId, source.full_name, branch.treeSha),
  );
  const fw = templateFrameworkFor(source.inspection?.framework ?? null, tree.paths);

  const now = new Date().toISOString();
  const keepPatterns = new Set<string>();
  for (const c of candidates) {
    keepPatterns.add(c.pattern);
    const row = {
      workspace_id: ctx.workspaceId,
      source_id: source.id,
      label: c.label,
      pattern: c.pattern,
      template_file: findTemplateFile(c.pattern, tree.paths, fw),
      rule: { framework: fw, treeTruncated: tree.truncated } as Json,
      page_count: c.paths.length,
      paths: c.paths,
      monthly_clicks: Math.round((c.clicks / PRE_PERIOD_DAYS) * 30.4),
      detected_at: now,
    };
    const { data: existing } = await supabaseAdmin
      .from("experiment_page_groups")
      .select("id, paths")
      .eq("source_id", source.id)
      .eq("pattern", c.pattern)
      .maybeSingle();
    if (existing) {
      const same = pathsHash(existing.paths ?? []) === pathsHash(c.paths);
      const { error } = await supabaseAdmin
        .from("experiment_page_groups")
        .update(same ? row : { ...row, eligibility: {} as Json })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("experiment_page_groups").insert(row);
      if (error) throw new Error(error.message);
    }
  }

  // Drop groups that no longer exist, unless an experiment still points at them.
  const { data: old } = await supabaseAdmin
    .from("experiment_page_groups")
    .select("id, pattern")
    .eq("source_id", source.id);
  const stale = (old ?? []).filter((g) => !keepPatterns.has(g.pattern)).map((g) => g.id);
  if (stale.length) {
    const { data: used } = await supabaseAdmin
      .from("experiments")
      .select("page_group_id")
      .in("page_group_id", stale);
    const inUse = new Set((used ?? []).map((u) => u.page_group_id));
    const removable = stale.filter((id) => !inUse.has(id));
    if (removable.length) {
      await supabaseAdmin.from("experiment_page_groups").delete().in("id", removable);
    }
  }

  return {
    groups: await groupViews(ctx.workspaceId, sources),
    pagesSeen: pages.length,
    framework: source.inspection?.framework ?? null,
  };
}

export async function loadGroup(ctx: ExperimentCtx, groupId: string): Promise<GroupRow> {
  const { data, error } = await ctx.supabase
    .from("experiment_page_groups")
    .select("*")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", groupId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ExperimentError("Page group not found", 404);
  return data as GroupRow;
}

export async function groupEligibility(
  ctx: ExperimentCtx,
  groupId: string,
  metric: ExperimentMetric,
  deps: { apiFor?: ApiFor; force?: boolean } = {},
): Promise<EligibilityView> {
  const group = await loadGroup(ctx, groupId);
  const stored = (group.eligibility ?? {}) as StoredEligibility;
  const hash = pathsHash(group.paths);
  const cached = stored[metric];
  if (
    !deps.force &&
    cached &&
    cached.pathsHash === hash &&
    Date.now() - Date.parse(cached.checkedAt) < ELIGIBILITY_TTL_MS
  ) {
    return cached;
  }
  const sources = await loadSiteSources(ctx.workspaceId);
  const host = normHost(sources.source?.site_host);
  if (!host) throw new ExperimentError("Link your repository to your website first.", 409);
  const busy = await busyPaths(ctx.workspaceId, host);
  const paths = group.paths.filter((p) => !busy.has(p));
  const loaded = await loadSeries({
    sources,
    host,
    pattern: group.pattern,
    paths,
    metric,
    apiFor: deps.apiFor,
  });
  const result = checkEligibility({ metric, paths, series: loaded.series, dates: loaded.preDates });
  if (busy.size && group.paths.some((p) => busy.has(p))) {
    result.reasons.push({
      code: "pages_busy",
      message: `${group.paths.length - paths.length} of these pages are already in another test and were left out.`,
    });
  }
  const view: EligibilityView = {
    metric,
    eligible: result.eligible,
    reasons: result.reasons,
    pagesWithData: result.pagesWithData,
    preDays: result.preDays,
    total: result.total,
    topShare: result.topShare,
    mde: result.mde,
    checkedAt: new Date().toISOString(),
  };
  const next = { ...stored, [metric]: { ...view, pathsHash: hash } };
  const { error } = await supabaseAdmin
    .from("experiment_page_groups")
    .update({ eligibility: next as unknown as Json })
    .eq("id", group.id);
  if (error) throw new Error(error.message);
  return view;
}
