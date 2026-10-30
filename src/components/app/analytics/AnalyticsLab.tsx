"use client";
// Development-only visual QA for the Analytics surface.
//
// Renders the real AnalyticsContent — tabs, lock, panels, charts — against
// invented data, so the design can be checked without a workspace, a sign-in
// or a Google connection. It answers the surface's own RPC calls by patching
// `fetch` for /api/rpc/* while the lab is mounted; nothing reaches the server
// and no real workspace is read.
import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AnalyticsContent } from "@/components/app/AnalyticsContent";
import { AnalyticsModal } from "@/components/app/AnalyticsModal";
import { TABS, type AnalyticsTab } from "@/components/app/AnalyticsTabs";
import { WorkspaceProvider } from "@/components/workspace/WorkspaceProvider";
import { METRICS } from "@/lib/analytics/metrics";
import type {
  GoogleConnectionView,
  Kpi,
  RankedRow,
  SeriesPoint,
  SocialPostRow,
  SocialReport,
} from "@/lib/analytics/types";
import { cn } from "@/lib/utils";

const WS_ID = "00000000-0000-0000-0000-0000000000aa";

/* ── Sample data ───────────────────────────────────────────────────────── */

const day = (i: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + i - 28);
  return d.toISOString().slice(0, 10);
};

const series = (n: number, base: number, amp: number): SeriesPoint[] =>
  Array.from({ length: n }, (_, i) => ({
    date: day(i),
    previousDate: day(i - n),
    value: Math.round(base + Math.sin(i / 3) * amp + i * (base / 60)),
    previous: Math.round(base * 0.82 + Math.cos(i / 4) * amp),
  }));

const compare = (key: Kpi["key"], current: number, previous: number) => {
  const up = current >= previous;
  return {
    current,
    previous,
    abs: current - previous,
    pct: Math.round(((current - previous) / previous) * 1000) / 10,
    direction: (up ? "up" : "down") as "up" | "down",
    favorable: METRICS[key].higherIsBetter ? up : !up,
    significant: true,
    status: "ok" as const,
  };
};

const kpi = (key: Kpi["key"], value: number, previous: number): Kpi => ({
  key,
  value,
  comparison: compare(key, value, previous),
});

const ranked = (rows: Array<[string, number, number, Record<string, number>?]>): RankedRow[] =>
  rows.map(([value, current, previous, extra]) => ({
    value,
    current,
    previous,
    pct: Math.round(((current - previous) / Math.max(1, previous)) * 1000) / 10,
    extra: extra ?? {},
  }));

const WINDOW = {
  current: { from: day(0), to: day(27), days: 28 },
  previous: { from: day(-28), to: day(-1), days: 28 },
  previousCovered: true,
  key: "28d",
  label: "Last 28 days",
};

const source = (kind: "ga4_property" | "gsc_site", displayName: string) => ({
  id: `src-${kind}`,
  kind,
  externalId: "sample",
  displayName,
  accountName: "Acme Inc.",
  siteHost: "acme.com",
  timeZone: "UTC",
  status: "active" as const,
  lastError: null,
  lastSyncedAt: new Date(Date.now() - 18 * 60_000).toISOString(),
  backfillCompletedAt: new Date().toISOString(),
  run: null,
});

const readyStatus = (kind: "ga4_property" | "gsc_site", name: string) => ({
  state: "ready" as const,
  source: source(kind, name),
  firstDate: day(-160),
  lastDate: day(27),
  message: null,
});

const CONNECTED: GoogleConnectionView = {
  configured: true,
  connection: {
    id: "conn-1",
    email: "owner@acme.com",
    status: "active",
    lastError: null,
    connectedAt: new Date(Date.now() - 40 * 864e5).toISOString(),
    scopes: { analytics: true, searchConsole: true },
  },
  ga4: source("ga4_property", "Acme — Website"),
  gsc: source("gsc_site", "https://acme.com/"),
};

const NOT_CONNECTED: GoogleConnectionView = {
  configured: true,
  connection: null,
  ga4: null,
  gsc: null,
};

const NO_SOURCE: GoogleConnectionView = {
  ...CONNECTED,
  ga4: null,
  gsc: null,
};

const EXPIRED: GoogleConnectionView = {
  ...CONNECTED,
  connection: {
    ...CONNECTED.connection!,
    status: "error",
    lastError: "Google access was removed for this account.",
  },
};

const WEBSITE = {
  source: "ga4" as const,
  status: readyStatus("ga4_property", "Acme — Website"),
  window: WINDOW,
  kpis: [
    kpi("ga4.sessions", 18432, 15980),
    kpi("ga4.users", 12874, 11402),
    kpi("ga4.engagedSessions", 11233, 9800),
    kpi("ga4.keyEvents", 412, 355),
    kpi("ga4.engagementRate", 0.61, 0.58),
    kpi("ga4.avgSessionDuration", 143, 128),
  ],
  series: {
    sessions: series(28, 620, 90),
    users: series(28, 440, 70),
    keyEvents: series(28, 15, 5),
  },
  breakdowns: {
    channel: ranked([
      ["Organic Search", 8200, 7100, { keyEvents: 180 }],
      ["Direct", 4100, 4300, { keyEvents: 90 }],
      ["Referral", 3100, 2400, { keyEvents: 72 }],
      ["Paid Search", 1900, 1500, { keyEvents: 48 }],
    ]),
    source_medium: ranked([
      ["google / organic", 8200, 7100, { keyEvents: 180 }],
      ["(direct) / (none)", 4100, 4300, { keyEvents: 90 }],
      ["linkedin.com / referral", 1400, 900, { keyEvents: 31 }],
    ]),
    landing_page: ranked([
      ["https://acme.com/", 5200, 4800, { keyEvents: 120, pageViews: 9400 }],
      ["https://acme.com/pricing", 3100, 2200, { keyEvents: 98, pageViews: 5200 }],
      ["https://acme.com/blog/seo-guide", 2400, 2600, { keyEvents: 22, pageViews: 3900 }],
      ["https://acme.com/features", 1800, 1500, { keyEvents: 41, pageViews: 2800 }],
    ]),
    country: ranked([
      ["United States", 9200, 8100],
      ["United Kingdom", 2600, 2400],
      ["Germany", 1400, 1100],
    ]),
    device: ranked([
      ["desktop", 11200, 10100],
      ["mobile", 6400, 5200],
      ["tablet", 800, 700],
    ]),
  },
};

const SEARCH = {
  source: "gsc" as const,
  status: readyStatus("gsc_site", "https://acme.com/"),
  window: WINDOW,
  kpis: [
    kpi("gsc.clicks", 5421, 4610),
    kpi("gsc.impressions", 182400, 165200),
    kpi("gsc.ctr", 0.0297, 0.0279),
    kpi("gsc.position", 12.4, 14.1),
  ],
  series: {
    clicks: series(28, 190, 40),
    impressions: series(28, 6200, 900),
    position: series(28, 12, 2),
  },
  breakdowns: {
    query: ranked([
      ["ai marketing platform", 820, 610, { impressions: 24000, ctr: 0.034, position: 6.2 }],
      ["seo automation tool", 540, 600, { impressions: 19800, ctr: 0.027, position: 9.8 }],
      [
        "generative engine optimisation",
        410,
        180,
        { impressions: 12400, ctr: 0.033, position: 7.1 },
      ],
      ["buy backlinks safely", 280, 310, { impressions: 9800, ctr: 0.028, position: 14.2 }],
    ]),
    page: ranked([
      ["https://acme.com/", 1800, 1500, { impressions: 62000, ctr: 0.029, position: 8.1 }],
      ["https://acme.com/pricing", 900, 700, { impressions: 24000, ctr: 0.037, position: 6.4 }],
      [
        "https://acme.com/blog/seo-guide",
        620,
        800,
        { impressions: 31000, ctr: 0.02, position: 16.2 },
      ],
    ]),
    country: ranked([
      ["usa", 2800, 2400, { impressions: 92000 }],
      ["gbr", 900, 800, { impressions: 28000 }],
    ]),
    device: ranked([
      ["DESKTOP", 3200, 2800, { impressions: 108000 }],
      ["MOBILE", 2000, 1700, { impressions: 68000 }],
    ]),
  },
};

const post = (
  id: string,
  platform: string,
  caption: string,
  daysAgo: number,
  metrics: SocialPostRow["metrics"],
  madeInMellox = true,
): SocialPostRow => {
  const engagement =
    (metrics.likes ?? 0) + (metrics.comments ?? 0) + (metrics.shares ?? 0) + (metrics.saves ?? 0);
  return {
    id,
    platform,
    account: "@acme",
    url: `https://example.com/${id}`,
    caption,
    thumbnailUrl: null,
    format: platform === "tiktok" || platform === "youtube" ? "video" : "image",
    postedAt: new Date(Date.now() - daysAgo * 864e5).toISOString(),
    madeInMellox,
    contentItemId: madeInMellox ? `c-${id}` : null,
    metrics,
    engagement,
    engagementRate: metrics.views ? engagement / metrics.views : null,
  };
};

const SOCIAL_POSTS = [
  post("p1", "instagram", "Behind the scenes: how we test every batch", 4, {
    views: 18400,
    reach: 12100,
    likes: 920,
    comments: 64,
    shares: 41,
    saves: 130,
    follows: 38,
  }),
  post(
    "p2",
    "tiktok",
    "3 mistakes people make with AI answers",
    9,
    {
      views: 24100,
      likes: 1310,
      comments: 88,
      shares: 120,
    },
    false,
  ),
  post("p3", "linkedin", "What we learned shipping 40 pages in a month", 12, {
    views: 7300,
    likes: 210,
    comments: 31,
    shares: 18,
    linkClicks: 96,
  }),
  post("p4", "instagram", "New: the autumn range is here", 17, {
    views: 9100,
    reach: 7400,
    likes: 480,
    comments: 22,
    shares: 15,
    saves: 60,
    follows: 12,
  }),
];

const SOCIAL_STATUS = {
  state: "ready" as const,
  accounts: 3,
  reconnect: 0,
  lastSyncedAt: new Date(Date.now() - 40 * 60_000).toISOString(),
};

const SOCIAL_REPORT: SocialReport = {
  source: "social",
  status: SOCIAL_STATUS,
  window: WINDOW,
  kpis: [
    kpi("social.views", 58900, 47200),
    kpi("social.engagement", 3529, 2810),
    {
      ...kpi("social.engagementRate", 0, 0),
      value: 0.06,
      comparison: {
        ...compare("social.engagementRate", 0.06, 0.059),
        current: 0.06,
        previous: 0.059,
        abs: 0.001,
        pct: 1.7,
        significant: false,
      },
    },
    kpi("social.reach", 19500, 16100),
    kpi("social.follows", 50, 31),
    kpi("social.linkClicks", 96, 70),
    kpi("social.posts", 14, 11),
  ],
  series: {
    views: series(28, 2000, 900),
    engagement: series(28, 120, 60),
    posts: series(28, 1, 1),
  },
  byPlatform: [
    {
      platform: "tiktok",
      posts: 4,
      views: 24100,
      engagement: 1518,
      engagementRate: 0.063,
      follows: null,
    },
    {
      platform: "instagram",
      posts: 7,
      views: 27500,
      engagement: 1732,
      engagementRate: 0.063,
      follows: 50,
    },
    {
      platform: "linkedin",
      posts: 3,
      views: 7300,
      engagement: 259,
      engagementRate: 0.035,
      follows: null,
    },
  ],
  previousByPlatform: null,
  topPosts: SOCIAL_POSTS,
  recentPosts: [...SOCIAL_POSTS].reverse(),
  formats: [
    { key: "image", posts: 9, avgViews: 4100, avgEngagement: 240 },
    { key: "video", posts: 5, avgViews: 6200, avgEngagement: 330 },
  ],
  weekdays: [
    { key: "1", posts: 3, avgViews: 3900, avgEngagement: 210 },
    { key: "2", posts: 4, avgViews: 5200, avgEngagement: 300 },
    { key: "4", posts: 4, avgViews: 6100, avgEngagement: 350 },
    { key: "6", posts: 3, avgViews: 2600, avgEngagement: 150 },
  ],
  origin: {
    mellox: { key: "mellox", posts: 10, avgViews: 4600, avgEngagement: 270 },
    other: { key: "other", posts: 4, avgViews: 3800, avgEngagement: 220 },
  },
};

const OVERVIEW = {
  mellox: {
    source: "mellox" as const,
    window: WINDOW,
    kpis: [
      kpi("mellox.created", 34, 28),
      kpi("mellox.published", 21, 16),
      kpi("mellox.scheduled", 8, 6),
      kpi("mellox.approvalsPending", 3, 5),
    ],
  },
  website: {
    status: WEBSITE.status,
    window: WINDOW,
    kpis: WEBSITE.kpis,
    series: WEBSITE.series.sessions,
    usersSeries: WEBSITE.series.users,
    keyEventsSeries: WEBSITE.series.keyEvents,
    landingPages: WEBSITE.breakdowns.landing_page,
    channels: WEBSITE.breakdowns.channel,
  },
  search: {
    status: SEARCH.status,
    window: WINDOW,
    kpis: SEARCH.kpis,
    series: SEARCH.series.clicks,
    impressionsSeries: SEARCH.series.impressions,
    positionSeries: SEARCH.series.position,
    queries: SEARCH.breakdowns.query,
    pages: SEARCH.breakdowns.page,
  },
  social: {
    status: SOCIAL_STATUS,
    window: WINDOW,
    kpis: SOCIAL_REPORT.kpis.slice(0, 5),
    series: SOCIAL_REPORT.series.views,
    byPlatform: SOCIAL_REPORT.byPlatform,
    topPosts: SOCIAL_POSTS.slice(0, 4),
  },
  aiVisibility: {
    latest: {
      score: 72,
      url: "https://acme.com",
      scannedAt: new Date(Date.now() - 2 * 864e5).toISOString(),
      categories: [{ id: "structure", name: "Structure", score: 80 }],
    },
    kpi: kpi("geo.score", 72, 66),
    history: [
      { date: day(4), score: 61 },
      { date: day(14), score: 66 },
      { date: day(26), score: 72 },
    ],
  },
};

const INSIGHTS = {
  window: WINDOW,
  signals: [
    {
      id: "s1",
      source: "gsc" as const,
      metric: "gsc.clicks",
      fact: "Clicks from Google rose 18% to 5,421.",
      direction: "up" as const,
      favorable: true,
    },
    {
      id: "s2",
      source: "ga4" as const,
      metric: "ga4.keyEvents",
      fact: "Conversions rose 16% to 412.",
      direction: "up" as const,
      favorable: true,
    },
  ],
  fingerprint: "sample",
  insight: {
    id: "i1",
    createdAt: new Date().toISOString(),
    model: "anthropic/claude-opus-5.5",
    items: [
      {
        title: "Search is carrying your growth",
        summary: "Clicks from Google grew faster than the rest of your traffic this period.",
        source: "gsc" as const,
        signalIds: ["s1"],
        severity: "positive" as const,
        recommendation: "Write two more pages on the terms already ranking on page one.",
      },
      {
        title: "The pricing page converts best",
        summary: "It turns more visits into conversions than any other landing page.",
        source: "ga4" as const,
        signalIds: ["s2"],
        severity: "watch" as const,
        recommendation: "Link to pricing from the blog posts bringing the most visits.",
      },
    ],
  },
  stale: null,
  canGenerate: false,
};

const SUMMARY = {
  totals: { items: 34, drafts: 6, pending: 3, approved: 4, scheduled: 8, published: 21 },
  deltas: { items: 21, published: 31 },
  daily: Array.from({ length: 28 }, (_, i) => ({
    day: day(i),
    created: Math.round(1 + Math.abs(Math.sin(i / 3)) * 3),
    scheduled: 1,
    published: Math.round(Math.abs(Math.cos(i / 4)) * 2),
  })),
  byChannel: [{ channel: "linkedin", count: 12 }],
  byAgent: [{ agent: "writer", count: 20 }],
  byKind: [{ kind: "post", count: 18 }],
  approvals: { pending: 3, approved: 4, rejected: 1 },
  recent: [],
  drafts: [],
  upcoming: [],
  latestAudit: null,
};

const SOCIAL = {
  provider: "postforme",
  rangeDays: 28,
  totals: {
    deliveries: 24,
    published: 21,
    failed: 1,
    inFlight: 0,
    scheduled: 2,
    likes: 1840,
    comments: 212,
    shares: 96,
    saves: 140,
    views: 48200,
  },
  byPlatform: [
    {
      platform: "linkedin",
      published: 12,
      failed: 0,
      likes: 1100,
      comments: 140,
      shares: 60,
      views: 28000,
    },
    {
      platform: "instagram",
      published: 6,
      failed: 1,
      likes: 540,
      comments: 52,
      shares: 24,
      views: 14200,
    },
    { platform: "x", published: 3, failed: 0, likes: 200, comments: 20, shares: 12, views: 6000 },
  ],
  topPosts: [
    {
      contentItemId: "c1",
      title: "How AI answers pick which brands to name",
      platform: "linkedin",
      url: "https://linkedin.com/feed/acme-1",
      publishedAt: new Date(Date.now() - 6 * 864e5).toISOString(),
      likes: 410,
      comments: 61,
      shares: 28,
      views: 9800,
    },
    {
      contentItemId: "c2",
      title: "Five pages worth rewriting this month",
      platform: "instagram",
      url: null,
      publishedAt: new Date(Date.now() - 11 * 864e5).toISOString(),
      likes: 220,
      comments: 18,
      shares: 9,
      views: 5400,
    },
  ],
  failures: [],
  accounts: { active: 3, reconnect: 0 },
  credits: { used: 120, limit: 500 },
  metricsSyncedAt: new Date(Date.now() - 55 * 60_000).toISOString(),
};

const WORKSPACE = {
  id: WS_ID,
  name: "Acme Inc.",
  websiteUrl: "https://acme.com",
  domain: "acme.com",
  role: "owner",
  isOwner: true,
  plan: "pro",
  onboarded: true,
  memberCount: 3,
};

/* ── The lab ───────────────────────────────────────────────────────────── */

const STATES = [
  { id: "connected", label: "Connected", view: CONNECTED },
  { id: "locked", label: "Not connected", view: NOT_CONNECTED },
  { id: "choose", label: "Nothing chosen", view: NO_SOURCE },
  { id: "expired", label: "Access expired", view: EXPIRED },
] as const;

type StateId = (typeof STATES)[number]["id"];

function answer(path: string, body: unknown, connection: GoogleConnectionView): unknown {
  if (path === "workspaces/getWorkspaceDetails") return WORKSPACE;
  if (path === "google-analytics/getGoogleConnection") return connection;
  if (path === "google-analytics/syncAnalyticsNow") return { started: true };
  if (path === "google-analytics/listGa4Properties")
    return [
      { propertyId: "properties/111", displayName: "Acme — Website", accountName: "Acme Inc." },
      { propertyId: "properties/222", displayName: "Acme — Blog", accountName: "Acme Inc." },
    ];
  if (path === "google-analytics/listGscSites")
    return [{ siteUrl: "https://acme.com/" }, { siteUrl: "sc-domain:acme.com" }];
  if (path === "analytics/getAnalyticsInsights") return INSIGHTS;
  if (path === "analytics/getAnalyticsSummary") return SUMMARY;
  if (path === "analytics/getAnalyticsReport") {
    const section = (body as { data?: { section?: string } })?.data?.section;
    if (section === "website") return { section, report: WEBSITE };
    if (section === "search") return { section, report: SEARCH };
    if (section === "social") return { section, report: SOCIAL_REPORT };
    // Overview never waits for Google: follow the chosen connection state.
    const google = !connection.connection
      ? "not_connected"
      : connection.connection.status !== "active"
        ? "reconnect"
        : !connection.ga4 && !connection.gsc
          ? "no_source"
          : "ready";
    if (google === "ready") return { section: "overview", report: OVERVIEW };
    const off = (s: typeof OVERVIEW.website.status) => ({
      ...s,
      state: google,
      source: null,
      firstDate: null,
      lastDate: null,
      message: null,
    });
    return {
      section: "overview",
      report: {
        ...OVERVIEW,
        website: { status: off(OVERVIEW.website.status), window: null, kpis: [], series: [] },
        search: { status: off(OVERVIEW.search.status), window: null, kpis: [], series: [] },
      },
    };
  }
  return null;
}

export function AnalyticsLab() {
  const [state, setState] = useState<StateId>("connected");
  const [tab, setTab] = useState<AnalyticsTab>("overview");
  const [asModal, setAsModal] = useState(false);
  const [ready, setReady] = useState(false);
  const connection = STATES.find((s) => s.id === state)!.view;
  // A fresh client per state so switching re-reads every stubbed report.
  const queryClient = useMemo(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state],
  );

  useEffect(() => {
    setReady(true);
    const real = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/social/analytics")) {
        return new Response(JSON.stringify(SOCIAL), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      const match = url.match(/\/api\/rpc\/(.+)$/);
      if (!match) return real(input, init);
      let body: unknown = null;
      try {
        body = init?.body ? JSON.parse(String(init.body)) : null;
      } catch {
        body = null;
      }
      return new Response(JSON.stringify({ result: answer(match[1], body, connection) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    return () => {
      window.fetch = real;
    };
  }, [connection]);

  return (
    <div data-ready={ready} className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 flex flex-wrap items-center gap-3 border-b border-border bg-background/90 px-4 py-2.5 backdrop-blur-xl">
        <span className="text-[12px] font-semibold">Analytics lab</span>
        <div className="flex flex-wrap gap-1">
          {STATES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setState(s.id)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11.5px] font-medium transition",
                state === s.id
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setAsModal((v) => !v)}
          className={cn(
            "rounded-full px-2.5 py-1 text-[11.5px] font-medium transition",
            asModal
              ? "bg-primary text-primary-foreground"
              : "border border-border text-muted-foreground hover:text-foreground",
          )}
        >
          In the modal
        </button>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {TABS.length} tabs · sample data
        </span>
      </header>
      <QueryClientProvider client={queryClient}>
        <WorkspaceProvider key={state} workspaceId={WS_ID}>
          {asModal ? (
            <AnalyticsModal open onOpenChange={() => setAsModal(false)} workspaceName="Acme Inc." />
          ) : (
            <AnalyticsContent tab={tab} onTabChange={setTab} />
          )}
        </WorkspaceProvider>
      </QueryClientProvider>
    </div>
  );
}
