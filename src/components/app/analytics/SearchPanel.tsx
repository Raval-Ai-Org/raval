"use client";

// Search — Google Search Console: clicks, impressions, click rate, average
// position, search terms, pages, countries and devices.
import { useState } from "react";
import { Segmented } from "@/components/app/geo/geo-ui";
import type { MetricKey } from "@/lib/analytics/metrics";
import { formatWindow } from "@/lib/analytics/ranges";
import type { RankedRow, SearchReport } from "@/lib/analytics/types";
import { GoogleConnectCard } from "./GoogleConnectCard";
import { useAnalyticsReport } from "./hooks";
import { ReportError, ReportSkeleton, SourceGate } from "./SourceGate";
import { askMellox, Card, fmt, KpiGrid, kpiPrompt, PageLink, RankedTable, TrendChart } from "./ui";

const TREND: Array<{
  id: "clicks" | "impressions" | "position";
  label: string;
  metric: MetricKey;
}> = [
  { id: "clicks", label: "Clicks", metric: "gsc.clicks" },
  { id: "impressions", label: "Times shown", metric: "gsc.impressions" },
  { id: "position", label: "Position", metric: "gsc.position" },
];

const COLUMNS = [
  { key: "impressions", label: "Shown", format: fmt.count },
  { key: "ctr", label: "Click rate", format: fmt.pct },
  { key: "position", label: "Position", format: fmt.position },
];

const rowPrompt = (what: string, r: RankedRow, report: SearchReport) =>
  `In Google Search Console, ${what} "${r.value}" got ${fmt.count(r.current)} clicks, was shown ${fmt.count(r.extra.impressions ?? null)} times, click rate ${fmt.pct(r.extra.ctr ?? null)}, average position ${fmt.position(r.extra.position ?? null)}${report.window ? ` (${formatWindow(report.window.current)})` : ""}. How can I get more clicks from it?`;

export function SearchPanel() {
  const { data, isLoading, error, refetch } = useAnalyticsReport("search");
  const [trend, setTrend] = useState<(typeof TREND)[number]["id"]>("clicks");

  if (isLoading && !data) return <ReportSkeleton />;
  if (error && !data) return <ReportError error={error} onRetry={() => void refetch()} />;
  if (!data) return null;
  const active = TREND.find((t) => t.id === trend)!;
  const b = data.breakdowns;
  const lag =
    data.window && data.status.lastDate
      ? `Google shares search data with a delay of about 2–3 days. Showing data through ${formatWindow({ from: data.status.lastDate, to: data.status.lastDate, days: 1 })}.`
      : null;

  return (
    <SourceGate status={data.status}>
      <div className="space-y-4">
        <KpiGrid kpis={data.kpis} onAsk={(k) => askMellox(kpiPrompt(k, data.window))} />

        <Card
          title="Google Search over time"
          source="gsc"
          window={data.window}
          action={
            <Segmented
              label="Chart metric"
              value={trend}
              onChange={setTrend}
              options={TREND.map((t) => ({ value: t.id, label: t.label }))}
            />
          }
        >
          <TrendChart metric={active.metric} points={data.series[trend]} />
          {lag && <p className="mt-2 text-[10.5px] text-muted-foreground">{lag}</p>}
        </Card>

        <Card title="Search terms" source="gsc" window={data.window}>
          <RankedTable
            rows={b.query}
            primaryLabel="Clicks"
            primaryMetric="gsc.clicks"
            columns={COLUMNS}
            limit={15}
            empty="No search terms yet. Google hides rare searches for privacy."
            onAsk={(r) => askMellox(rowPrompt("the search term", r, data))}
          />
        </Card>

        <Card title="Pages in Google" source="gsc" window={data.window}>
          <RankedTable
            rows={b.page}
            primaryLabel="Clicks"
            primaryMetric="gsc.clicks"
            columns={COLUMNS}
            limit={15}
            renderValue={(v) => <PageLink value={v} />}
            onAsk={(r) => askMellox(rowPrompt("the page", r, data))}
          />
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Countries" source="gsc">
            <RankedTable
              rows={b.country}
              primaryLabel="Clicks"
              primaryMetric="gsc.clicks"
              columns={COLUMNS.slice(0, 1)}
              renderValue={(v) => v.toUpperCase()}
            />
          </Card>
          <Card title="Devices" source="gsc">
            <RankedTable
              rows={b.device}
              primaryLabel="Clicks"
              primaryMetric="gsc.clicks"
              columns={COLUMNS.slice(0, 1)}
              renderValue={(v) => v.charAt(0) + v.slice(1).toLowerCase()}
            />
          </Card>
        </div>

        <GoogleConnectCard compact />
      </div>
    </SourceGate>
  );
}
