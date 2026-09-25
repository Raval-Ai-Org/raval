// google.server.ts — per-page Search Console and GA4 pulls for experiments
// (ADR-0024 §5 step 7). Separate from the dashboard sync, which keeps only the
// top pages per day: here a missing page on a complete day really is a zero.
//
//   Search Console  [date, page] filtered to the group's prefix, paged 25k at
//                   a time, final data only. A day counts as complete only when
//                   the site-wide [date] query returns it.
//   GA4             [date, landingPage, sessionSource, sessionDefaultChannelGroup]
//                   with an inListFilter on the assigned paths, paged by
//                   offset. Organic Search sessions, key events and revenue;
//                   AI referral sessions from any channel (ai-referrers.ts).
//                   Below a quota floor the pull stops and says so.
import "server-only";
import { aiReferrerOf } from "@/lib/experiments/ai-referrers";
import { normalizePath, type PageTraffic } from "@/lib/experiments/groups";
import type { GoogleApi } from "@/server/analytics/google/api.server";
import { googleApiFor } from "@/server/analytics/google/tokens.server";
import { normHost, type AnalyticsSource } from "./sources.server";

export type ApiFor = (source: AnalyticsSource) => GoogleApi;
export const defaultApiFor: ApiFor = (source) =>
  googleApiFor(source.connection_id, source.workspace_id);

const GSC_PAGE = 25_000;
const GSC_MAX_PAGES = 40;
const GA4_PAGE = 100_000;
const GA4_MAX_PAGES = 20;
const GA4_FILTER_CHUNK = 100;
/** Stop pulling GA4 below this many property tokens left today. */
export const GA4_TOKEN_FLOOR = 1_000;

export type GscDay = { clicks: number; impressions: number; position_weighted: number };
export type Ga4Day = {
  sessions: number;
  key_events: number;
  revenue: number;
  ai_referral_sessions: number;
};

function pathOnHost(pageUrl: string, host: string): string | null {
  try {
    const url = new URL(pageUrl);
    if (normHost(url.hostname) !== host) return null;
    return normalizePath(url.pathname);
  } catch {
    return null;
  }
}

/** Days Search Console has final data for (site-wide). */
export async function gscCompleteDates(
  api: GoogleApi,
  siteUrl: string,
  start: string,
  end: string,
): Promise<Set<string>> {
  const rows = await api.queryGsc(siteUrl, {
    startDate: start,
    endDate: end,
    dimensions: ["date"],
  });
  return new Set(rows.map((r) => r.keys[0]).filter(Boolean));
}

/** Pages with their totals over a range (for grouping). */
export async function pullGscPages(
  api: GoogleApi,
  siteUrl: string,
  host: string,
  start: string,
  end: string,
): Promise<PageTraffic[]> {
  const byPath = new Map<string, PageTraffic>();
  for (let page = 0; page < GSC_MAX_PAGES; page++) {
    const rows = await api.queryGsc(siteUrl, {
      startDate: start,
      endDate: end,
      dimensions: ["page"],
      rowLimit: GSC_PAGE,
      startRow: page * GSC_PAGE,
    });
    for (const r of rows) {
      const path = pathOnHost(r.keys[0] ?? "", host);
      if (!path) continue;
      const prev = byPath.get(path) ?? { path, clicks: 0, impressions: 0 };
      prev.clicks += r.clicks;
      prev.impressions += r.impressions;
      byPath.set(path, prev);
    }
    if (rows.length < GSC_PAGE) break;
  }
  return [...byPath.values()];
}

/** path → date → numbers, for the given paths (or everything under `prefix`). */
export async function pullGscPageDaily(
  api: GoogleApi,
  siteUrl: string,
  host: string,
  start: string,
  end: string,
  opts: { prefix: string | null; paths?: Set<string> },
): Promise<Map<string, Map<string, GscDay>>> {
  const out = new Map<string, Map<string, GscDay>>();
  for (let page = 0; page < GSC_MAX_PAGES; page++) {
    const rows = await api.queryGsc(siteUrl, {
      startDate: start,
      endDate: end,
      dimensions: ["date", "page"],
      rowLimit: GSC_PAGE,
      startRow: page * GSC_PAGE,
      filters:
        opts.prefix && opts.prefix !== "/"
          ? [{ dimension: "page", operator: "contains", expression: opts.prefix }]
          : undefined,
    });
    for (const r of rows) {
      const [date, pageUrl] = r.keys;
      const path = pathOnHost(pageUrl ?? "", host);
      if (!date || !path) continue;
      if (opts.paths && !opts.paths.has(path)) continue;
      const days = out.get(path) ?? new Map<string, GscDay>();
      const day = days.get(date) ?? { clicks: 0, impressions: 0, position_weighted: 0 };
      day.clicks += r.clicks;
      day.impressions += r.impressions;
      day.position_weighted += r.position * r.impressions;
      days.set(date, day);
      out.set(path, days);
    }
    if (rows.length < GSC_PAGE) break;
  }
  return out;
}

function ga4Date(raw: string): string | null {
  return /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : null;
}

export async function pullGa4PageDaily(
  api: GoogleApi,
  propertyId: string,
  start: string,
  end: string,
  paths: string[],
): Promise<{
  rows: Map<string, Map<string, Ga4Day>>;
  deferred: boolean;
  tokensLeft: number | null;
}> {
  const rows = new Map<string, Map<string, Ga4Day>>();
  let tokensLeft: number | null = null;
  const wanted = new Set(paths);
  // GA4 reports the landing page as requested; a trailing slash is the same page.
  const values = [...new Set(paths.flatMap((p) => (p === "/" ? [p] : [p, `${p}/`])))];
  for (let c = 0; c < values.length; c += GA4_FILTER_CHUNK) {
    const chunk = values.slice(c, c + GA4_FILTER_CHUNK);
    for (let page = 0; page < GA4_MAX_PAGES; page++) {
      if (tokensLeft !== null && tokensLeft < GA4_TOKEN_FLOOR) {
        return { rows, deferred: true, tokensLeft };
      }
      const report = await api.runGa4Report(propertyId, {
        startDate: start,
        endDate: end,
        dimensions: ["date", "landingPage", "sessionSource", "sessionDefaultChannelGroup"],
        metrics: ["sessions", "keyEvents", "totalRevenue"],
        limit: GA4_PAGE,
        offset: page * GA4_PAGE,
        inListFilter: { dimension: "landingPage", values: chunk },
        orderByDimensions: ["date", "landingPage", "sessionSource", "sessionDefaultChannelGroup"],
      });
      tokensLeft = report.tokensRemainingToday;
      for (const r of report.rows) {
        const [rawDate, landing, source, channel] = r.dimensions;
        const date = ga4Date(rawDate ?? "");
        const path = normalizePath(landing ?? "");
        if (!date || !path || !wanted.has(path)) continue;
        const [sessions = 0, keyEvents = 0, revenue = 0] = r.metrics;
        const days = rows.get(path) ?? new Map<string, Ga4Day>();
        const day = days.get(date) ?? {
          sessions: 0,
          key_events: 0,
          revenue: 0,
          ai_referral_sessions: 0,
        };
        if (channel === "Organic Search") {
          day.sessions += sessions;
          day.key_events += keyEvents;
          day.revenue += revenue;
        }
        if (aiReferrerOf(source)) day.ai_referral_sessions += sessions;
        days.set(date, day);
        rows.set(path, days);
      }
      if (report.rows.length < GA4_PAGE) break;
    }
  }
  return { rows, deferred: false, tokensLeft };
}

/** The common path prefix of a group's pattern, for Search Console's filter. */
export function prefixOf(pattern: string): string | null {
  const literal: string[] = [];
  for (const seg of pattern.split("/").filter(Boolean)) {
    if (seg === "*") break;
    literal.push(seg);
  }
  return literal.length ? `/${literal.join("/")}/` : null;
}
