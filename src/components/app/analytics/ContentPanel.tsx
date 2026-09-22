"use client";

// Content — what this workspace made and posted, and how those posts did.
// Mellox's own numbers only; nothing here comes from Google.
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowUpRight, FileText } from "@/components/icons";
import { SocialPerformance } from "@/components/app/SocialPerformance";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { addAppEventListener, emitAppEvent, removeAppEventListener } from "@/lib/app-events";
import { getAnalyticsSummary, type AnalyticsSummary } from "@/lib/analytics.functions";
import { useServerFn } from "@/lib/use-server-fn";
import { ReportError, ReportSkeleton } from "./SourceGate";
import { useAnalyticsRange } from "./range";
import { Card, SourceBadge } from "./ui";

function useContentSummary(workspaceId: string | null) {
  const { range, key } = useAnalyticsRange();
  const fetcher = useServerFn(getAnalyticsSummary);
  const qc = useQueryClient();
  const query = useQuery<AnalyticsSummary>({
    queryKey: ["analytics-summary", workspaceId, key],
    enabled: !!workspaceId,
    queryFn: () => fetcher({ data: { workspaceId: workspaceId as string, range } }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  useEffect(() => {
    if (!workspaceId) return;
    const invalidate = () =>
      void qc.invalidateQueries({ queryKey: ["analytics-summary", workspaceId] });
    addAppEventListener("geo:audit-complete", invalidate);
    return () => removeAppEventListener("geo:audit-complete", invalidate);
  }, [qc, workspaceId]);
  return query;
}

const shortDay = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

const STAGES = [
  { label: "Draft", key: "drafts" },
  { label: "In review", key: "pending" },
  { label: "Approved", key: "approved" },
  { label: "Scheduled", key: "scheduled" },
  { label: "Published", key: "published" },
] as const;

export function ContentPanel() {
  const workspaceId = useOptionalWorkspaceId();
  const { days, label } = useAnalyticsRange();
  const { data, isLoading, error, refetch } = useContentSummary(workspaceId);

  if (isLoading && !data) return <ReportSkeleton />;
  if (error && !data) return <ReportError error={error} onRetry={() => void refetch()} />;
  if (!data) return null;

  const totals = data.totals;
  const series = data.daily.map((r) => ({
    day: r.day,
    created: r.created,
    published: r.published,
  }));
  const madeSomething = totals.items > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <SourceBadge source="mellox" />
        <span className="text-[11px] text-muted-foreground">{label}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {STAGES.map((s) => (
          <div key={s.key} className="rounded-2xl border border-border bg-card/70 p-4">
            <div className="text-[11px] text-muted-foreground">{s.label}</div>
            <div className="mt-1.5 text-2xl font-semibold tabular-nums">{totals[s.key]}</div>
          </div>
        ))}
      </div>

      <Card title="Made and published" source="mellox">
        {madeSomething ? (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="content-made" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.24} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  stroke="hsl(var(--border))"
                  strokeDasharray="3 3"
                  vertical={false}
                  opacity={0.5}
                />
                <XAxis
                  dataKey="day"
                  tickFormatter={shortDay}
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={10.5}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                />
                <YAxis
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={10.5}
                  tickLine={false}
                  axisLine={false}
                  width={30}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 10,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area
                  type="monotone"
                  dataKey="created"
                  name="Made"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="url(#content-made)"
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey="published"
                  name="Published"
                  stroke="hsl(var(--muted-foreground))"
                  strokeDasharray="4 3"
                  strokeWidth={1.75}
                  fill="none"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <span className="grid size-10 place-items-center rounded-xl bg-muted/50 text-muted-foreground">
              <FileText className="size-4" aria-hidden />
            </span>
            <p className="text-[12.5px] font-medium">Nothing made in this period</p>
            <button
              type="button"
              onClick={() => {
                emitAppEvent("chat:prefill", "Plan this week's content");
                emitAppEvent("chat:focus");
              }}
              className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-[12px] font-medium transition hover:border-foreground/30"
            >
              Plan this week <ArrowUpRight className="size-3" aria-hidden />
            </button>
          </div>
        )}
      </Card>

      <SocialPerformance workspaceId={workspaceId} days={days} />
    </div>
  );
}
