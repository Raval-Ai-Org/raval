"use client";

import { useState } from "react";
import { ArrowRight, Clock, GoogleIcon, RefreshCw, Sparkles, Target } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { Kpi, RankedRow, SourceStatus } from "@/lib/analytics/types";
import type { DataSource } from "@/lib/analytics/sources";
import { useAnalyticsReport, useGoogleConnection, useInsights, useSyncNow } from "./hooks";
import { AnalyticsMark, ConnectGoogleButton, SearchConsoleMark } from "./GoogleConnectCard";
import { ReportError, ReportSkeleton } from "./SourceGate";
import { askMellox, Card, KpiTile, kpiPrompt, RankedTable, SourceBadge, TrendChart } from "./ui";
import type { AnalyticsTab } from "@/components/app/AnalyticsTabs";

const sourceIcon: Record<DataSource, React.ReactNode> = {
  ga4: <AnalyticsMark className="size-5" />,
  gsc: <SearchConsoleMark className="size-5" />,
  geo: <Target className="size-4 text-primary" aria-hidden />,
  mellox: <Sparkles className="size-4 text-primary" aria-hidden />,
};

function statusLabel(status: SourceStatus) {
  return {
    ready: "Connected",
    syncing: "Syncing",
    not_connected: "Not connected",
    not_configured: "Unavailable",
    no_source: "Choose a source",
    reconnect: "Reconnect needed",
    error: "Sync issue",
  }[status.state];
}

function ConnectionHeader() {
  const { data: view, isLoading, error, refetch } = useGoogleConnection();
  const sync = useSyncNow();
  const busy = [view?.ga4?.run, view?.gsc?.run].some(
    (run) => run && (run.status === "queued" || run.status === "running"),
  );
  if (isLoading)
    return <div className="h-24 animate-pulse rounded-2xl border border-border bg-muted/25" />;
  if (error || !view) {
    return (
      <div
        className="flex items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-[12px]"
        role="alert"
      >
        <span>Google connection status is unavailable.</span>
        <Button size="sm" variant="outline" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  const connected = view.connection?.status === "active";
  const sources = [
    {
      kind: "ga4" as const,
      label: "GA4",
      source: view.ga4,
      status:
        view.ga4?.status === "active" ? "Connected" : view.ga4 ? "Needs attention" : "Not selected",
    },
    {
      kind: "gsc" as const,
      label: "Search Console",
      source: view.gsc,
      status:
        view.gsc?.status === "active" ? "Connected" : view.gsc ? "Needs attention" : "Not selected",
    },
  ];
  return (
    <section className="rounded-2xl border border-border bg-card/60 p-4 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white shadow-sm ring-1 ring-border/60">
            <GoogleIcon className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[13px] font-semibold">Data connections</h2>
              <span
                className={
                  connected ? "text-[10.5px] text-success" : "text-[10.5px] text-muted-foreground"
                }
              >
                {connected
                  ? "Read-only access"
                  : "Connect Google to unlock website and search data"}
              </span>
            </div>
            {view.connection && (
              <p className="mt-1 truncate text-[11px] text-muted-foreground">
                {view.connection.email}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {connected && (view.ga4 || view.gsc) && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={busy || sync.isPending}
              onClick={() => sync.mutate()}
            >
              <RefreshCw
                className={busy || sync.isPending ? "size-3.5 animate-spin" : "size-3.5"}
                aria-hidden
              />
              {busy ? "Syncing" : "Refresh data"}
            </Button>
          )}
          {!connected && view.configured && <ConnectGoogleButton label="Connect Google" />}
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {sources.map(({ kind, label, source, status }) => (
          <div
            key={kind}
            className="flex min-w-0 items-center gap-2.5 rounded-xl border border-border/70 bg-background/35 px-3 py-2.5"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-white">
              <span className="scale-90">{sourceIcon[kind]}</span>
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[11.5px] font-medium">{label}</div>
              <div className="truncate text-[10.5px] text-muted-foreground">
                {source?.displayName ?? status}
              </div>
            </div>
            <span className="shrink-0 text-[10px] text-muted-foreground">{status}</span>
          </div>
        ))}
      </div>
      {connected && !view.ga4 && !view.gsc && (
        <p className="mt-3 text-[11px] text-warning">
          Google is connected. Select a GA4 property or Search Console site in the Website or Search
          tabs.
        </p>
      )}
    </section>
  );
}

function SourceState({ status, children }: { status: SourceStatus; children: React.ReactNode }) {
  if (status.state === "ready") return <>{children}</>;
  return (
    <div className="flex min-h-28 flex-col items-start justify-center gap-1.5 rounded-xl border border-dashed border-border/80 bg-background/25 p-4">
      <span className="text-[12px] font-medium">{statusLabel(status)}</span>
      <span className="text-[11px] text-muted-foreground">
        {status.message ?? "Connect or select this source to see real data here."}
      </span>
    </div>
  );
}

function OverviewKpis({
  title,
  source,
  status,
  kpis,
}: {
  title: string;
  source: DataSource;
  status: SourceStatus;
  kpis: Kpi[];
}) {
  return (
    <Card title={title} source={source} window={null}>
      <SourceState status={status}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {kpis.map((k) => (
            <KpiTile key={k.key} kpi={k} onAsk={(metric) => askMellox(kpiPrompt(metric, null))} />
          ))}
        </div>
      </SourceState>
    </Card>
  );
}

function Ranking({
  title,
  source,
  rows,
  metric,
  label,
}: {
  title: string;
  source: DataSource;
  rows?: RankedRow[];
  metric: Kpi["key"];
  label: string;
}) {
  return (
    <Card title={title} source={source}>
      <RankedTable
        rows={rows ?? []}
        primaryLabel={label}
        primaryMetric={metric}
        limit={5}
        empty="No ranking data for this period."
      />
    </Card>
  );
}

export function OverviewPanel({ onTabChange }: { onTabChange: (t: AnalyticsTab) => void }) {
  const { data, isLoading, error, refetch } = useAnalyticsReport("overview");
  const insights = useInsights();
  const [gaTrend, setGaTrend] = useState<"sessions" | "users" | "keyEvents">("sessions");
  const [searchTrend, setSearchTrend] = useState<"clicks" | "impressions" | "position">("clicks");
  if (isLoading && !data) return <ReportSkeleton />;
  if (error && !data) return <ReportError error={error} onRetry={() => void refetch()} />;
  if (!data) return null;
  const gaMetric = { sessions: "ga4.sessions", users: "ga4.users", keyEvents: "ga4.keyEvents" }[
    gaTrend
  ] as Kpi["key"];
  const searchMetric = {
    clicks: "gsc.clicks",
    impressions: "gsc.impressions",
    position: "gsc.position",
  }[searchTrend] as Kpi["key"];
  const topInsights =
    insights.data?.insight?.items.slice(0, 3) ?? insights.data?.stale?.items.slice(0, 3) ?? [];
  const gaStatus = data.website.status;
  const searchStatus = data.search.status;
  const gaKpis = data.website.kpis.filter((k) =>
    [
      "ga4.sessions",
      "ga4.users",
      "ga4.engagedSessions",
      "ga4.engagementRate",
      "ga4.keyEvents",
      "ga4.avgSessionDuration",
    ].includes(k.key),
  );
  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
            <span className="size-1.5 rounded-full bg-primary" /> Decision view
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics overview</h1>
          <p className="mt-1 max-w-2xl text-[12.5px] text-muted-foreground">
            See what changed across your website, organic search, Mellox activity, and AI
            visibility. Sources remain separate so every number has context.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[10.5px] text-muted-foreground">
          <Clock className="size-3.5" aria-hidden />
          {data.website.status.source?.lastSyncedAt || data.search.status.source?.lastSyncedAt
            ? `Updated ${new Date(data.website.status.source?.lastSyncedAt ?? data.search.status.source?.lastSyncedAt ?? "").toLocaleString()}`
            : "Waiting for source data"}
        </div>
      </header>
      <ConnectionHeader />
      <div className="grid gap-4 xl:grid-cols-2">
        <OverviewKpis title="Website performance" source="ga4" status={gaStatus} kpis={gaKpis} />
        <OverviewKpis
          title="Organic search performance"
          source="gsc"
          status={searchStatus}
          kpis={data.search.kpis}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card
          title="Website trend"
          source="ga4"
          window={data.website.window}
          action={
            <select
              aria-label="Website trend metric"
              value={gaTrend}
              onChange={(e) => setGaTrend(e.target.value as typeof gaTrend)}
              className="rounded-md border border-border bg-background px-2 py-1 text-[11px]"
            >
              <option value="sessions">Sessions</option>
              <option value="users">Users</option>
              <option value="keyEvents">Conversions</option>
            </select>
          }
        >
          <SourceState status={gaStatus}>
            <TrendChart
              metric={gaMetric}
              points={
                data.website[
                  gaTrend === "sessions"
                    ? "series"
                    : gaTrend === "users"
                      ? "usersSeries"
                      : "keyEventsSeries"
                ] ?? []
              }
            />
          </SourceState>
        </Card>
        <Card
          title="Organic search trend"
          source="gsc"
          window={data.search.window}
          action={
            <select
              aria-label="Search trend metric"
              value={searchTrend}
              onChange={(e) => setSearchTrend(e.target.value as typeof searchTrend)}
              className="rounded-md border border-border bg-background px-2 py-1 text-[11px]"
            >
              <option value="clicks">Clicks</option>
              <option value="impressions">Impressions</option>
              <option value="position">Average position</option>
            </select>
          }
        >
          <SourceState status={searchStatus}>
            <TrendChart
              metric={searchMetric}
              points={
                data.search[
                  searchTrend === "clicks"
                    ? "series"
                    : searchTrend === "impressions"
                      ? "impressionsSeries"
                      : "positionSeries"
                ] ?? []
              }
            />
          </SourceState>
        </Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Ranking
          title="Top landing pages"
          source="ga4"
          rows={data.website.landingPages}
          metric="ga4.sessions"
          label="Sessions"
        />
        <Ranking
          title="Top search queries"
          source="gsc"
          rows={data.search.queries}
          metric="gsc.clicks"
          label="Clicks"
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <OverviewKpis
          title="Mellox activity"
          source="mellox"
          status={{ state: "ready", source: null, firstDate: null, lastDate: null, message: null }}
          kpis={data.mellox.kpis}
        />
        <Card
          title="AI Visibility"
          source="geo"
          action={
            <button
              type="button"
              onClick={() => onTabChange("ai-visibility")}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              Details <ArrowRight className="size-3" />
            </button>
          }
        >
          <div className="flex items-center gap-3">
            <div className="text-3xl font-semibold tabular-nums">
              {data.aiVisibility.latest
                ? `${Math.round(data.aiVisibility.latest.score)}/100`
                : "Not available"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {data.aiVisibility.latest
                ? `Latest scan ${new Date(data.aiVisibility.latest.scannedAt).toLocaleDateString()}`
                : "Run a GEO scan to measure AI visibility."}
            </div>
          </div>
        </Card>
      </div>
      {topInsights.length > 0 && (
        <Card
          title="Key changes from your data"
          action={
            <button
              type="button"
              onClick={() => onTabChange("insights")}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              All insights <ArrowRight className="size-3" />
            </button>
          }
        >
          <ul className="grid gap-2 md:grid-cols-3">
            {topInsights.map((item) => (
              <li
                key={item.title}
                className="rounded-xl border border-border/70 bg-background/30 p-3"
              >
                <div className="flex items-center gap-1.5">
                  <SourceBadge source={item.source} />
                  <span className="text-[10px] text-muted-foreground">{item.severity}</span>
                </div>
                <h3 className="mt-2 text-[12.5px] font-semibold">{item.title}</h3>
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                  {item.recommendation}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="text-[10.5px] text-muted-foreground">
        Comparisons use the previous period of the same length. Google Search Console data can lag
        by 2–3 days. A missing source is shown as unavailable, never estimated.
      </p>
    </div>
  );
}
