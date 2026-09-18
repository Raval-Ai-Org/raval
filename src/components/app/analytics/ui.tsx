"use client";

// Shared analytics building blocks. Every card and chart shows exactly one
// data source (SourceBadge); deltas carry an arrow and words, not colour alone.
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDown,
  ArrowUp,
  Globe,
  GoogleIcon,
  Info,
  MessageSquare,
  Minus,
  Search,
  Sparkles,
  Target,
} from "@/components/icons";
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { emitAppEvent } from "@/lib/app-events";
import type { Comparison } from "@/lib/analytics/compare";
import { formatMetric, METRICS, type MetricKey } from "@/lib/analytics/metrics";
import { formatWindow } from "@/lib/analytics/ranges";
import { DATA_SOURCES, type DataSource } from "@/lib/analytics/sources";
import type { Kpi, RankedRow, ReportWindow, SeriesPoint } from "@/lib/analytics/types";
import { cn } from "@/lib/utils";

const SOURCE_ICON: Record<DataSource, React.ComponentType<{ className?: string }>> = {
  mellox: Sparkles,
  ga4: GoogleIcon,
  gsc: Search,
  geo: Target,
};

export function SourceBadge({ source, className }: { source: DataSource; className?: string }) {
  const Icon = SOURCE_ICON[source];
  return (
    <span
      title={DATA_SOURCES[source].hint}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/60 px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground",
        className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {DATA_SOURCES[source].label}
    </span>
  );
}

export function Card({
  title,
  source,
  window,
  action,
  children,
  className,
}: {
  title: string;
  source?: DataSource;
  window?: ReportWindow | null;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-border bg-card/60 p-4 sm:p-5", className)}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold tracking-tight">{title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {source && <SourceBadge source={source} />}
            {window && (
              <span className="text-[10.5px] text-muted-foreground">
                {formatWindow(window.current)}
                {window.previousCovered ? ` vs ${formatWindow(window.previous)}` : ""}
              </span>
            )}
          </div>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function DeltaChip({ metric, c }: { metric: MetricKey; c: Comparison }) {
  if (c.status === "insufficient_history")
    return <span className="text-[11px] text-muted-foreground">No earlier data yet</span>;
  if (c.status === "no_data")
    return <span className="text-[11px] text-muted-foreground">No data</span>;
  if (c.direction === "flat")
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <Minus className="h-3 w-3" aria-hidden /> Same as before
      </span>
    );
  const Arrow = c.direction === "up" ? ArrowUp : ArrowDown;
  const spec = METRICS[metric];
  const label =
    spec.format === "count" || spec.format === "duration"
      ? c.pct === null
        ? "new"
        : `${c.pct > 0 ? "+" : ""}${c.pct}%`
      : spec.format === "percent"
        ? `${c.abs! > 0 ? "+" : ""}${(c.abs! * 100).toFixed(1)} pts`
        : `${c.abs! > 0 ? "+" : ""}${c.abs!.toFixed(1)}`;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums",
        c.favorable ? "text-success" : "text-destructive",
      )}
      title={`Before: ${formatMetric(metric, c.previous)}`}
    >
      <Arrow className="h-3 w-3" aria-hidden />
      {label}
      <span className="sr-only">{c.favorable ? "(better)" : "(worse)"}</span>
    </span>
  );
}

export function KpiTile({ kpi, onAsk }: { kpi: Kpi; onAsk?: (kpi: Kpi) => void }) {
  const spec = METRICS[kpi.key];
  return (
    <div className="group relative rounded-2xl border border-border bg-card/70 p-3.5 transition hover:border-foreground/20">
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <span className="truncate">{spec.label}</span>
        <UiTooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`About ${spec.label}`}
              className="opacity-60 hover:opacity-100"
            >
              <Info className="h-3 w-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-56 text-[11px]">{spec.hint}</TooltipContent>
        </UiTooltip>
      </div>
      <div className="mt-1.5 text-xl font-semibold tabular-nums sm:text-2xl">
        {formatMetric(kpi.key, kpi.value)}
      </div>
      <div className="mt-1">
        <DeltaChip metric={kpi.key} c={kpi.comparison} />
      </div>
      {onAsk && (
        <button
          type="button"
          onClick={() => onAsk(kpi)}
          aria-label={`Ask Mellox about ${spec.label}`}
          className="absolute right-2 top-2 rounded-full p-1 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground focus:opacity-100 group-hover:opacity-100"
        >
          <MessageSquare className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function KpiGrid({ kpis, onAsk }: { kpis: Kpi[]; onAsk?: (kpi: Kpi) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
      {kpis.map((k) => (
        <KpiTile key={k.key} kpi={k} onAsk={onAsk} />
      ))}
    </div>
  );
}

const shortDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/** One metric over time, with the previous period as a dashed overlay. One axis, one source. */
export function TrendChart({
  metric,
  points,
  height = 220,
  showPrevious = true,
}: {
  metric: MetricKey;
  points: SeriesPoint[];
  height?: number;
  showPrevious?: boolean;
}) {
  const spec = METRICS[metric];
  const hasPrevious = showPrevious && points.some((p) => p.previous !== null);
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id={`fill-${metric}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.22} />
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
            dataKey="date"
            tickFormatter={shortDate}
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
            width={44}
            reversed={!spec.higherIsBetter}
            allowDecimals={spec.format !== "count"}
            tickFormatter={(v: number) => formatMetric(metric, v)}
            domain={spec.format === "position" ? ["auto", "auto"] : [0, "auto"]}
          />
          <Tooltip
            cursor={{ stroke: "hsl(var(--muted-foreground))", strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as SeriesPoint;
              return (
                <div className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11.5px] shadow-md">
                  <div className="font-medium">
                    {shortDate(p.date)}: {formatMetric(metric, p.value)}
                  </div>
                  {hasPrevious && (
                    <div className="text-muted-foreground">
                      {shortDate(p.previousDate)}: {formatMetric(metric, p.previous)}
                    </div>
                  )}
                </div>
              );
            }}
          />
          {hasPrevious && (
            <Line
              type="monotone"
              dataKey="previous"
              name="Previous period"
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          )}
          <Area
            type="monotone"
            dataKey="value"
            name="This period"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            fill={`url(#fill-${metric})`}
            dot={false}
            connectNulls
            activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--card))" }}
          />
        </AreaChart>
      </ResponsiveContainer>
      {hasPrevious && (
        <div className="mt-1 flex items-center gap-3 text-[10.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="h-0.5 w-3 rounded bg-primary" /> This period
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-0 w-3 border-t border-dashed border-muted-foreground" /> Previous
            period
          </span>
        </div>
      )}
    </div>
  );
}

export type RankedColumn = { key: string; label: string; format: (v: number | null) => string };

/** A ranked breakdown (pages, queries, channels…) with a bar for the primary metric. */
export function RankedTable({
  rows,
  primaryLabel,
  primaryMetric,
  columns = [],
  empty = "Nothing to show for this period.",
  limit = 10,
  renderValue,
  onAsk,
}: {
  rows: RankedRow[];
  primaryLabel: string;
  primaryMetric: MetricKey;
  columns?: RankedColumn[];
  empty?: string;
  limit?: number;
  renderValue?: (value: string) => React.ReactNode;
  onAsk?: (row: RankedRow) => void;
}) {
  if (!rows.length)
    return <p className="py-4 text-center text-[12px] text-muted-foreground">{empty}</p>;
  const shown = rows.slice(0, limit);
  const max = Math.max(1, ...shown.map((r) => r.current));
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[420px] text-[12px]">
        <thead>
          <tr className="text-left text-[10.5px] uppercase tracking-wider text-muted-foreground">
            <th className="px-1 pb-2 font-medium">Name</th>
            <th className="px-1 pb-2 text-right font-medium">{primaryLabel}</th>
            <th className="px-1 pb-2 text-right font-medium">Change</th>
            {columns.map((c) => (
              <th key={c.key} className="hidden px-1 pb-2 text-right font-medium sm:table-cell">
                {c.label}
              </th>
            ))}
            {onAsk && <th className="w-6" />}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.value} className="group border-t border-border/50">
              <td className="max-w-0 px-1 py-2">
                <div className="truncate font-medium" title={r.value}>
                  {renderValue ? renderValue(r.value) : r.value}
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${(r.current / max) * 100}%` }}
                  />
                </div>
              </td>
              <td className="px-1 py-2 text-right tabular-nums">
                {formatMetric(primaryMetric, r.current)}
              </td>
              <td className="px-1 py-2 text-right tabular-nums">
                {r.previous === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : r.previous === 0 ? (
                  <span className="text-success">new</span>
                ) : r.pct === null || Math.abs(r.pct) < 0.5 ? (
                  <span className="text-muted-foreground">0%</span>
                ) : (
                  <span className={r.pct > 0 ? "text-success" : "text-destructive"}>
                    {r.pct > 0 ? "▲" : "▼"} {Math.abs(r.pct)}%
                  </span>
                )}
              </td>
              {columns.map((c) => (
                <td
                  key={c.key}
                  className="hidden px-1 py-2 text-right tabular-nums text-muted-foreground sm:table-cell"
                >
                  {c.format(r.extra[c.key] ?? null)}
                </td>
              ))}
              {onAsk && (
                <td className="py-2 pl-1">
                  <button
                    type="button"
                    onClick={() => onAsk(r)}
                    aria-label={`Ask Mellox about ${r.value}`}
                    className="rounded-full p-1 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Put a question in the Mellox chat composer (never sends on its own). */
export function askMellox(text: string) {
  emitAppEvent("chat:prefill", text);
  emitAppEvent("chat:focus");
}

export function AskButton({ prompt, label = "Ask Mellox" }: { prompt: string; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => askMellox(prompt)}
      className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-[12px] font-medium text-foreground/85 transition hover:border-foreground/30 hover:text-foreground"
    >
      <MessageSquare className="h-3.5 w-3.5" aria-hidden />
      {label}
    </button>
  );
}

/** Fact-only prompt for a KPI — the numbers come from Mellox, labelled with their source. */
export function kpiPrompt(kpi: Kpi, window: ReportWindow | null): string {
  const spec = METRICS[kpi.key];
  const c = kpi.comparison;
  const when = window ? ` (${formatWindow(window.current)})` : "";
  const before =
    c.status === "ok" && c.previous !== null
      ? `, compared with ${formatMetric(kpi.key, c.previous)} in the previous period`
      : "";
  return `My ${spec.label} (${DATA_SOURCES[spec.source].label}) is ${formatMetric(kpi.key, kpi.value)}${when}${before}. Explain what this means and what I should do next.`;
}

export const fmt = {
  count: (v: number | null) => (v === null ? "—" : formatMetric("ga4.sessions", v)),
  pct: (v: number | null) => (v === null ? "—" : formatMetric("gsc.ctr", v)),
  position: (v: number | null) => (v === null ? "—" : formatMetric("gsc.position", v)),
};

export function PageLink({ value }: { value: string }) {
  const isUrl = /^https?:\/\//.test(value);
  return (
    <span className="inline-flex items-center gap-1">
      {isUrl && <Globe className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />}
      {isUrl ? value.replace(/^https?:\/\/(www\.)?/, "") : value}
    </span>
  );
}
