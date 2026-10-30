"use client";

// Overview — the headline numbers (social views, website visits, Google
// clicks), then the trend, the posts, pages and terms behind them, and what
// changed. Sources are never blended: every card names the one source it came
// from. Social numbers need no Google; with Google not connected its cards
// fold into one "Connect Google" card.
import { useState } from "react";
import { ArrowRight, Target } from "@/components/icons";
import { Segmented } from "@/components/app/geo/geo-ui";
import type { AnalyticsTab } from "@/components/app/AnalyticsTabs";
import type { Kpi, SourceStatus } from "@/lib/analytics/types";
import { GoogleConnectBanner } from "./AnalyticsLock";
import { useAnalyticsReport, useInsights } from "./hooks";
import { PlatformCell, PostRow, SocialStatusNotice } from "./SocialPanel";
import { ReportError, ReportSkeleton, SourceNotice } from "./SourceGate";
import {
  askMellox,
  Card,
  HeroStat,
  KpiTile,
  kpiPrompt,
  fmt,
  PageLink,
  RankedTable,
  SourceBadge,
  TrendChart,
} from "./ui";

const WEBSITE_TREND = [
  { id: "sessions", label: "Visits", metric: "ga4.sessions" },
  { id: "users", label: "Visitors", metric: "ga4.users" },
  { id: "keyEvents", label: "Conversions", metric: "ga4.keyEvents" },
] as const;

const SEARCH_TREND = [
  { id: "clicks", label: "Clicks", metric: "gsc.clicks" },
  { id: "impressions", label: "Times shown", metric: "gsc.impressions" },
  { id: "position", label: "Position", metric: "gsc.position" },
] as const;

const findKpi = (kpis: Kpi[], key: string) => kpis.find((k) => k.key === key) ?? null;

const blank = (key: Kpi["key"]): Kpi => ({
  key,
  value: null,
  comparison: {
    current: null,
    previous: null,
    abs: null,
    pct: null,
    direction: "flat",
    favorable: null,
    significant: false,
    status: "no_data",
  },
});

/** A section that only renders its body when its own source has data. */
function Sourced({ status, children }: { status: SourceStatus; children: React.ReactNode }) {
  if (status.state === "ready") return <>{children}</>;
  return <SourceNotice status={status} />;
}

export function OverviewPanel({ onTabChange }: { onTabChange: (t: AnalyticsTab) => void }) {
  const { data, isLoading, error, refetch } = useAnalyticsReport("overview");
  const insights = useInsights();
  const [webTrend, setWebTrend] = useState<(typeof WEBSITE_TREND)[number]["id"]>("sessions");
  const [seaTrend, setSeaTrend] = useState<(typeof SEARCH_TREND)[number]["id"]>("clicks");

  if (isLoading && !data) return <ReportSkeleton />;
  if (error && !data) return <ReportError error={error} onRetry={() => void refetch()} />;
  if (!data) return null;

  const web = data.website;
  const sea = data.search;
  const social = data.social;
  const webReady = web.status.state === "ready";
  const seaReady = sea.status.state === "ready";
  const socialReady = social.status.state === "ready";
  // No Google account (or expired access): one card instead of six empty ones.
  const googleState = web.status.state;
  const googleOff =
    !webReady &&
    !seaReady &&
    ["not_connected", "not_configured", "reconnect"].includes(googleState);
  const socialHero =
    findKpi(social.kpis, "social.views")?.value != null
      ? findKpi(social.kpis, "social.views")
      : findKpi(social.kpis, "social.engagement");
  const webActive = WEBSITE_TREND.find((t) => t.id === webTrend)!;
  const seaActive = SEARCH_TREND.find((t) => t.id === seaTrend)!;
  const webSeries =
    webTrend === "sessions"
      ? web.series
      : webTrend === "users"
        ? web.usersSeries
        : web.keyEventsSeries;
  const seaSeries =
    seaTrend === "clicks"
      ? sea.series
      : seaTrend === "impressions"
        ? sea.impressionsSeries
        : sea.positionSeries;
  const topInsights =
    insights.data?.insight?.items.slice(0, 3) ?? insights.data?.stale?.items.slice(0, 3) ?? [];
  const secondary = [
    ...(socialReady
      ? social.kpis.filter((k) => k.key !== socialHero?.key && k.value !== null)
      : []),
    ...web.kpis.filter((k) => k.key !== "ga4.sessions"),
    ...sea.kpis.filter((k) => k.key !== "gsc.clicks"),
  ];
  const heroCount = 1 + (googleOff ? 0 : 2);

  return (
    <div className="space-y-4">
      {/* Headline */}
      <div className={heroCount === 3 ? "grid gap-3 lg:grid-cols-3" : "grid gap-3"}>
        {socialReady && socialHero ? (
          <HeroStat
            kpi={socialHero}
            caption="vs the period before"
            points={socialHero.key === "social.views" ? social.series : undefined}
            action={<SourceBadge source="social" short />}
          />
        ) : (
          <SocialStatusNotice status={social.status} />
        )}
        {googleOff ? null : webReady ? (
          <HeroStat
            kpi={findKpi(web.kpis, "ga4.sessions") ?? blank("ga4.sessions")}
            caption="vs the period before"
            points={web.series}
            action={<SourceBadge source="ga4" short />}
          />
        ) : (
          <SourceNotice status={web.status} />
        )}
        {googleOff ? null : seaReady ? (
          <HeroStat
            kpi={findKpi(sea.kpis, "gsc.clicks") ?? blank("gsc.clicks")}
            caption="vs the period before"
            points={sea.series}
            action={<SourceBadge source="gsc" short />}
          />
        ) : (
          <SourceNotice status={sea.status} />
        )}
      </div>

      {/* Everything else about those two numbers */}
      {secondary.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {secondary.map((k) => (
            <KpiTile key={k.key} kpi={k} onAsk={(m) => askMellox(kpiPrompt(m, null))} />
          ))}
        </div>
      )}

      {socialReady && (social.topPosts.length > 0 || social.byPlatform.length > 0) && (
        <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
          <Card
            title="Best posts"
            source="social"
            window={social.window}
            action={
              <button
                type="button"
                onClick={() => onTabChange("social")}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                All posts <ArrowRight className="size-3" />
              </button>
            }
          >
            {social.topPosts.length ? (
              <ul className="divide-y divide-border">
                {social.topPosts.map((p) => (
                  <PostRow key={p.id} post={p} />
                ))}
              </ul>
            ) : (
              <p className="py-8 text-center text-[12px] text-muted-foreground">
                No numbers for this period yet.
              </p>
            )}
          </Card>
          <Card title="By network" source="social">
            <ul className="space-y-2.5">
              {social.byPlatform.slice(0, 6).map((p) => (
                <li
                  key={p.platform}
                  className="flex items-center justify-between gap-3 text-[12px]"
                >
                  <PlatformCell platform={p.platform} />
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {p.posts} post{p.posts === 1 ? "" : "s"}
                    {p.views !== null ? ` · ${fmt.count(p.views)} views` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {googleOff ? (
        googleState === "not_configured" ? null : (
          <GoogleConnectBanner reconnect={googleState === "reconnect"} />
        )
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card
              title="Visits over time"
              source="ga4"
              window={web.window}
              action={
                webReady ? (
                  <Segmented
                    label="Website metric"
                    value={webTrend}
                    onChange={setWebTrend}
                    options={WEBSITE_TREND.map((t) => ({ value: t.id, label: t.label }))}
                  />
                ) : null
              }
            >
              <Sourced status={web.status}>
                <TrendChart metric={webActive.metric} points={webSeries ?? []} />
              </Sourced>
            </Card>
            <Card
              title="Google Search over time"
              source="gsc"
              window={sea.window}
              action={
                seaReady ? (
                  <Segmented
                    label="Search metric"
                    value={seaTrend}
                    onChange={setSeaTrend}
                    options={SEARCH_TREND.map((t) => ({ value: t.id, label: t.label }))}
                  />
                ) : null
              }
            >
              <Sourced status={sea.status}>
                <TrendChart metric={seaActive.metric} points={seaSeries ?? []} />
              </Sourced>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card
              title="Top landing pages"
              source="ga4"
              action={
                webReady ? (
                  <button
                    type="button"
                    onClick={() => onTabChange("website")}
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    All pages <ArrowRight className="size-3" />
                  </button>
                ) : null
              }
            >
              <Sourced status={web.status}>
                <RankedTable
                  rows={web.landingPages ?? []}
                  primaryLabel="Visits"
                  primaryMetric="ga4.sessions"
                  limit={5}
                  renderValue={(v) => <PageLink value={v} />}
                  empty="No pages with visits in this period."
                />
              </Sourced>
            </Card>
            <Card
              title="Top search terms"
              source="gsc"
              action={
                seaReady ? (
                  <button
                    type="button"
                    onClick={() => onTabChange("search")}
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    All terms <ArrowRight className="size-3" />
                  </button>
                ) : null
              }
            >
              <Sourced status={sea.status}>
                <RankedTable
                  rows={sea.queries ?? []}
                  primaryLabel="Clicks"
                  primaryMetric="gsc.clicks"
                  limit={5}
                  empty="No search terms yet. Google hides rare searches."
                />
              </Sourced>
            </Card>
          </div>
        </>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Made in Mellox" source="mellox" window={data.mellox.window}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {data.mellox.kpis.map((k) => (
              <KpiTile key={k.key} kpi={k} />
            ))}
          </div>
        </Card>
        <Card title="AI Visibility" source="geo">
          <div className="flex items-center gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
              <Target className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-2xl font-semibold tabular-nums">
                {data.aiVisibility.latest
                  ? `${Math.round(data.aiVisibility.latest.score)}/100`
                  : "No scan yet"}
              </div>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                {data.aiVisibility.latest
                  ? `Scanned ${new Date(data.aiVisibility.latest.scannedAt).toLocaleDateString()}`
                  : "See how ready your site is for AI answers."}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {topInsights.length > 0 && (
        <Card
          title="What changed"
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
                <SourceBadge source={item.source} />
                <h3 className="mt-2 text-[12.5px] font-semibold">{item.title}</h3>
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                  {item.recommendation}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="px-1 text-[10.5px] text-muted-foreground">
        Every number is compared with the period just before it. Google Search data can lag by two
        to three days, and networks up to two days. A source with nothing to show says so — it is
        never estimated.
      </p>
    </div>
  );
}
