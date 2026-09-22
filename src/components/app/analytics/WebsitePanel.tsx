"use client";

// Website — Google Analytics 4: visits, visitors, conversions, where visits
// come from, landing pages, countries and devices.
import { useState } from "react";
import { Segmented } from "@/components/app/geo/geo-ui";
import type { MetricKey } from "@/lib/analytics/metrics";
import { formatWindow } from "@/lib/analytics/ranges";
import type { RankedRow, WebsiteReport } from "@/lib/analytics/types";
import { useAnalyticsReport } from "./hooks";
import { ReportError, ReportSkeleton, SourceGate } from "./SourceGate";
import { askMellox, Card, fmt, KpiGrid, kpiPrompt, PageLink, RankedTable, TrendChart } from "./ui";

const TREND: Array<{ id: "sessions" | "users" | "keyEvents"; label: string; metric: MetricKey }> = [
  { id: "sessions", label: "Visits", metric: "ga4.sessions" },
  { id: "users", label: "Visitors", metric: "ga4.users" },
  { id: "keyEvents", label: "Conversions", metric: "ga4.keyEvents" },
];

const rowPrompt = (what: string, r: RankedRow, report: WebsiteReport) =>
  `In Google Analytics 4, ${what} "${r.value}" had ${fmt.count(r.current)} visits${r.previous !== null ? ` (${fmt.count(r.previous)} in the previous period)` : ""}${report.window ? ` for ${formatWindow(report.window.current)}` : ""}. What does this tell me and what should I do?`;

export function WebsitePanel() {
  const { data, isLoading, error, refetch } = useAnalyticsReport("website");
  const [trend, setTrend] = useState<(typeof TREND)[number]["id"]>("sessions");

  if (isLoading && !data) return <ReportSkeleton />;
  if (error && !data) return <ReportError error={error} onRetry={() => void refetch()} />;
  if (!data) return null;
  const active = TREND.find((t) => t.id === trend)!;
  const b = data.breakdowns;
  const extraCols = [
    { key: "keyEvents", label: "Conversions", format: fmt.count },
    { key: "pageViews", label: "Views", format: fmt.count },
  ];

  return (
    <SourceGate status={data.status}>
      <div className="space-y-4">
        <KpiGrid kpis={data.kpis} onAsk={(k) => askMellox(kpiPrompt(k, data.window))} />

        <Card
          title="Visits over time"
          source="ga4"
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
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Where visits come from" source="ga4">
            <RankedTable
              rows={b.channel}
              primaryLabel="Visits"
              primaryMetric="ga4.sessions"
              columns={extraCols.slice(0, 1)}
              onAsk={(r) => askMellox(rowPrompt("the channel", r, data))}
            />
          </Card>
          <Card title="Top sources" source="ga4">
            <RankedTable
              rows={b.source_medium}
              primaryLabel="Visits"
              primaryMetric="ga4.sessions"
              columns={extraCols.slice(0, 1)}
            />
          </Card>
        </div>

        <Card title="Top landing pages" source="ga4" window={data.window}>
          <RankedTable
            rows={b.landing_page}
            primaryLabel="Visits"
            primaryMetric="ga4.sessions"
            columns={extraCols}
            limit={15}
            renderValue={(v) => <PageLink value={v} />}
            onAsk={(r) => askMellox(rowPrompt("the landing page", r, data))}
          />
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Countries" source="ga4">
            <RankedTable rows={b.country} primaryLabel="Visits" primaryMetric="ga4.sessions" />
          </Card>
          <Card title="Devices" source="ga4">
            <RankedTable rows={b.device} primaryLabel="Visits" primaryMetric="ga4.sessions" />
          </Card>
        </div>
      </div>
    </SourceGate>
  );
}
