// types.ts — shapes the analytics server functions return to the browser.
// Every block names its data source; the UI renders the source badge from it.
import type { Comparison } from "./compare";
import type { MetricKey } from "./metrics";
import type { DateWindow } from "./ranges";
import type { Signal } from "./signals";
import type { SocialMetrics } from "@/lib/social-insights/normalize";

export type GoogleSourceKind = "ga4_property" | "gsc_site";

export type SyncErrorCode =
  | "token_expired"
  | "permission_denied"
  | "quota"
  | "upstream"
  | "not_found"
  | "config"
  | "internal";

export type SyncRunView = {
  id: string;
  trigger: "initial" | "daily" | "manual";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  /** 0–1 share of the date range written so far. */
  progress: number;
  rangeStart: string;
  rangeEnd: string;
  errorCode: SyncErrorCode | null;
  errorMessage: string | null;
  nextAttemptAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

export type AnalyticsSourceView = {
  id: string;
  kind: GoogleSourceKind;
  externalId: string;
  displayName: string;
  accountName: string | null;
  siteHost: string | null;
  timeZone: string | null;
  status: "active" | "access_lost" | "error";
  lastError: string | null;
  lastSyncedAt: string | null;
  backfillCompletedAt: string | null;
  run: SyncRunView | null;
};

export type GoogleConnectionView = {
  /** Server has the OAuth client configured and the feature is on. */
  configured: boolean;
  connection: null | {
    id: string;
    email: string;
    status: "active" | "suspended" | "revoked" | "error";
    lastError: string | null;
    connectedAt: string;
    requiresAiConsent?: boolean;
    scopes: { analytics: boolean; searchConsole: boolean };
  };
  ga4: AnalyticsSourceView | null;
  gsc: AnalyticsSourceView | null;
};

/**
 * Readiness of one Google source for a report:
 *  not_configured → server has no OAuth client
 *  not_connected  → no Google account connected
 *  reconnect      → token expired/revoked or the scope is missing
 *  no_source      → connected, no property/site chosen
 *  syncing        → first sync still running, no data yet
 *  ready          → has data (a daily sync may be running)
 *  error          → last sync failed and there is no data
 */
export type SourceState =
  "not_configured" | "not_connected" | "reconnect" | "no_source" | "syncing" | "ready" | "error";

export type SourceStatus = {
  state: SourceState;
  source: AnalyticsSourceView | null;
  /** First and last dates with stored data. */
  firstDate: string | null;
  lastDate: string | null;
  message: string | null;
};

export type Kpi = {
  key: MetricKey;
  value: number | null;
  comparison: Comparison;
};

export type SeriesPoint = {
  date: string;
  /** Aligned day of the previous window (same index), for the overlay line. */
  previousDate: string;
  value: number | null;
  previous: number | null;
};

export type RankedRow = {
  value: string;
  /** Primary metric for the breakdown (sessions for GA4, clicks for GSC). */
  current: number;
  previous: number | null;
  pct: number | null;
  /** Secondary columns, already formatted-agnostic numbers. */
  extra: Record<string, number | null>;
};

export type ReportWindow = {
  current: DateWindow;
  previous: DateWindow;
  previousCovered: boolean;
  key: string;
  label: string;
};

export type WebsiteReport = {
  source: "ga4";
  status: SourceStatus;
  window: ReportWindow | null;
  kpis: Kpi[];
  series: { sessions: SeriesPoint[]; users: SeriesPoint[]; keyEvents: SeriesPoint[] };
  breakdowns: {
    channel: RankedRow[];
    source_medium: RankedRow[];
    landing_page: RankedRow[];
    country: RankedRow[];
    device: RankedRow[];
  };
};

export type SearchReport = {
  source: "gsc";
  status: SourceStatus;
  window: ReportWindow | null;
  kpis: Kpi[];
  series: { clicks: SeriesPoint[]; impressions: SeriesPoint[]; position: SeriesPoint[] };
  breakdowns: {
    query: RankedRow[];
    page: RankedRow[];
    country: RankedRow[];
    device: RankedRow[];
  };
};

export type AiVisibilityReport = {
  source: "geo";
  latest: null | {
    score: number;
    url: string | null;
    scannedAt: string;
    categories: Array<{ id: string; name: string; score: number }>;
  };
  kpi: Kpi;
  history: Array<{ date: string; score: number }>;
  probes: null | {
    ranAt: string;
    answers: number;
    mentionRate: number;
    citationRate: number;
  };
  topActions: Array<{ id: string; priority: string; title: string; detail: string }>;
};

/**
 * Readiness of the social source (the brand's own accounts, read through
 * Post for Me's account feed — no Google needed):
 *  unavailable → direct publishing isn't set up on this server
 *  no_accounts → no social account connected
 *  syncing     → accounts connected, their posts haven't been read yet
 *  ready       → posts have been read (the window may still have none)
 */
export type SocialSourceState = "unavailable" | "no_accounts" | "syncing" | "ready";

export type SocialPostRow = {
  id: string;
  platform: string;
  account: string | null;
  url: string | null;
  caption: string;
  thumbnailUrl: string | null;
  format: "video" | "image" | "text" | "post";
  postedAt: string | null;
  /** Mellox published it (else it was posted on the network directly). */
  madeInMellox: boolean;
  contentItemId: string | null;
  metrics: SocialMetrics;
  engagement: number | null;
  /** Interactions ÷ views; null when the network reports no views. */
  engagementRate: number | null;
};

export type SocialPlatformRow = {
  platform: string;
  posts: number;
  views: number | null;
  engagement: number | null;
  engagementRate: number | null;
  follows: number | null;
};

/** Average per post for one group, only from posts that reported the number. */
export type SocialGroupRow = {
  key: string;
  posts: number;
  avgViews: number | null;
  avgEngagement: number | null;
};

export type SocialReport = {
  source: "social";
  status: {
    state: SocialSourceState;
    accounts: number;
    reconnect: number;
    lastSyncedAt: string | null;
  };
  window: ReportWindow | null;
  kpis: Kpi[];
  series: { views: SeriesPoint[]; engagement: SeriesPoint[]; posts: SeriesPoint[] };
  byPlatform: SocialPlatformRow[];
  /** The same rows for the previous window; null when it isn't covered. */
  previousByPlatform: SocialPlatformRow[] | null;
  topPosts: SocialPostRow[];
  recentPosts: SocialPostRow[];
  formats: SocialGroupRow[];
  /** By weekday (0 = Sunday). Null until there are enough posts to say. */
  weekdays: SocialGroupRow[] | null;
  /** Mellox-made vs posted elsewhere; null unless both have posts. */
  origin: { mellox: SocialGroupRow; other: SocialGroupRow } | null;
};

export type MelloxKpis = {
  source: "mellox";
  window: ReportWindow;
  kpis: Kpi[];
};

export type OverviewReport = {
  mellox: MelloxKpis;
  website: Pick<WebsiteReport, "status" | "window" | "kpis"> & {
    series: SeriesPoint[];
    usersSeries?: SeriesPoint[];
    keyEventsSeries?: SeriesPoint[];
    landingPages?: RankedRow[];
    channels?: RankedRow[];
  };
  search: Pick<SearchReport, "status" | "window" | "kpis"> & {
    series: SeriesPoint[];
    impressionsSeries?: SeriesPoint[];
    positionSeries?: SeriesPoint[];
    queries?: RankedRow[];
    pages?: RankedRow[];
  };
  aiVisibility: Pick<AiVisibilityReport, "latest" | "kpi" | "history">;
  social: Pick<SocialReport, "status" | "window" | "kpis" | "byPlatform"> & {
    series: SeriesPoint[];
    topPosts: SocialPostRow[];
  };
};

export type InsightItem = {
  title: string;
  summary: string;
  source: Signal["source"];
  /** Signal ids this insight is grounded in (validated server-side). */
  signalIds: string[];
  severity: "positive" | "watch" | "negative";
  recommendation: string;
};

export type InsightsView = {
  window: ReportWindow;
  signals: Signal[];
  fingerprint: string;
  /** Cached insight for exactly these signals, if one was generated. */
  insight: null | { id: string; items: InsightItem[]; createdAt: string; model: string | null };
  /** An older insight for this range (the data has changed since). */
  stale: null | { items: InsightItem[]; createdAt: string };
  canGenerate: boolean;
};
