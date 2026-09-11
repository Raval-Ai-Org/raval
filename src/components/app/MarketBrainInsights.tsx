"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  Globe2,
  Lightbulb,
  ListChecks,
  MessageSquarePlus,
  Minus,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import { emitAppEvent } from "@/lib/app-events";
import type { Intelligence, Priority, TrendData } from "@/lib/market-brain-store";
import { relativeTime } from "@/lib/market-brain-store";
import { cn } from "@/lib/utils";

const SERIES_COLORS = ["#10b981", "#0ea5e9", "#8b5cf6", "#f59e0b", "#f43f5e"];
const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

function askRavi(prompt: string) {
  emitAppEvent("chat:prefill", prompt);
  emitAppEvent("chat:focus");
}

/** Staggered fade-up used when results arrive. */
export function Reveal({ index = 0, children }: { index?: number; children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ duration: 0.45, delay: index * 0.07, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/* -------------------------------- metrics -------------------------------- */

export type TrendMetrics = {
  keyword: string;
  current: number | null;
  changePct: number | null;
  peak: { value: number; label: string } | null;
  average: number | null;
  topRegion: { name: string; value: number } | null;
  direction: "rising" | "declining" | "stable";
};

function formatPointDate(point: { date: string; timestamp: number }): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(point.date);
  const date = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    : new Date(point.timestamp * 1000);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

/** At-a-glance numbers derived only from the measured Google Trends series. */
export function computeTrendMetrics(data: TrendData): TrendMetrics {
  const points = data.interestOverTime.filter(
    (point) => !point.missingData && typeof point.values[0] === "number",
  );
  const value = (point: (typeof points)[number]) => point.values[0] ?? 0;
  const mean = (list: typeof points) =>
    list.length ? list.reduce((sum, point) => sum + value(point), 0) / list.length : 0;
  // Compare the average of the first and last few points so one noisy week
  // does not decide the direction.
  const window = Math.max(1, Math.min(4, Math.floor(points.length / 4)));
  const startAvg = mean(points.slice(0, window));
  const endAvg = mean(points.slice(-window));
  const changePct =
    points.length > 1 && startAvg > 0 ? ((endAvg - startAvg) / startAvg) * 100 : null;
  const peakPoint = points.reduce<(typeof points)[number] | null>(
    (best, point) => (!best || value(point) > value(best) ? point : best),
    null,
  );
  const region = [...data.regionalInterest]
    .filter((item) => typeof item.values[0] === "number")
    .sort((a, b) => (b.values[0] ?? 0) - (a.values[0] ?? 0))[0];
  return {
    keyword: data.keywords[0] ?? "",
    current: points.length ? value(points[points.length - 1]) : null,
    changePct,
    peak: peakPoint ? { value: value(peakPoint), label: formatPointDate(peakPoint) } : null,
    average: points.length ? Math.round(mean(points)) : null,
    topRegion: region ? { name: region.geoName, value: region.values[0] ?? 0 } : null,
    direction:
      changePct === null
        ? "stable"
        : changePct > 10
          ? "rising"
          : changePct < -10
            ? "declining"
            : "stable",
  };
}

function Tile({
  label,
  value,
  hint,
  tone = "default",
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "up" | "down";
  icon?: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border/60 bg-card/80 px-3 py-2.5">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div
        className={cn(
          "mt-1 truncate text-[17px] font-semibold leading-6 tabular-nums tracking-tight",
          tone === "up" && "text-emerald-600 dark:text-emerald-400",
          tone === "down" && "text-rose-600 dark:text-rose-400",
          tone === "default" && "text-foreground",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 truncate text-[10.5px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function KpiStrip({ metrics }: { metrics: TrendMetrics }) {
  const change = metrics.changePct;
  return (
    <div
      className="grid grid-cols-2 gap-2 @xl:grid-cols-4"
      aria-label="Market at a glance"
      data-testid="market-brain-kpis"
    >
      <Tile label="Interest now" value={metrics.current ?? "—"} hint="Index, 0–100" />
      <Tile
        label="Change"
        tone={change === null ? "default" : change >= 0 ? "up" : "down"}
        icon={
          change === null ? null : change >= 0 ? (
            <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
          ) : (
            <ArrowDownRight className="h-3 w-3" aria-hidden="true" />
          )
        }
        value={change === null ? "—" : `${change >= 0 ? "+" : ""}${Math.round(change)}%`}
        hint="Over the measured period"
      />
      <Tile
        label="Peak"
        value={metrics.peak?.value ?? "—"}
        hint={metrics.peak ? `on ${metrics.peak.label}` : "No peak yet"}
      />
      <Tile
        label="Top region"
        value={<span className="text-[15px]">{metrics.topRegion?.name ?? "—"}</span>}
        hint={metrics.topRegion ? `Interest ${metrics.topRegion.value}/100` : "No regional data"}
      />
    </div>
  );
}

/* ------------------------------ pulse card ------------------------------- */

function DirectionBadge({ direction }: { direction: TrendMetrics["direction"] }) {
  const Icon =
    direction === "rising" ? TrendingUp : direction === "declining" ? TrendingDown : Minus;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
        direction === "rising" && "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
        direction === "declining" && "bg-rose-500/12 text-rose-600 dark:text-rose-400",
        direction === "stable" && "bg-secondary text-muted-foreground",
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {direction === "rising" ? "Rising" : direction === "declining" ? "Declining" : "Steady"}
    </span>
  );
}

function ConfidenceMeter({ confidence }: { confidence: Intelligence["confidence"] }) {
  const level = confidence === "high" ? 3 : confidence === "medium" ? 2 : 1;
  return (
    <div className="flex items-center gap-2" aria-label={`Confidence: ${confidence}`}>
      <span className="text-[10.5px] text-muted-foreground">Confidence</span>
      <span className="flex gap-0.5" aria-hidden="true">
        {[1, 2, 3].map((step) => (
          <span
            key={step}
            className={cn(
              "h-1.5 w-4 rounded-full",
              step <= level ? "bg-emerald-500" : "bg-foreground/10",
            )}
          />
        ))}
      </span>
      <span className="text-[10.5px] font-semibold capitalize text-foreground/80">
        {confidence}
      </span>
    </div>
  );
}

export function PulseSummary({
  intelligence,
  direction,
  completedAt,
}: {
  intelligence: Intelligence;
  direction: TrendMetrics["direction"] | null;
  completedAt: string | null;
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.08] via-card to-sky-500/[0.05] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-emerald-600 dark:text-emerald-400">
          <Sparkles className="h-3 w-3" aria-hidden="true" /> Market pulse
        </span>
        {direction && <DirectionBadge direction={direction} />}
      </div>
      <p className="mt-2 text-[13.5px] font-medium leading-relaxed text-foreground @2xl:text-[14.5px]">
        {intelligence.summary}
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2.5">
        <ConfidenceMeter confidence={intelligence.confidence} />
        {completedAt && (
          <span className="text-[10.5px] text-muted-foreground">
            Data from {relativeTime(completedAt)}
          </span>
        )}
      </div>
    </section>
  );
}

/* --------------------------------- chart --------------------------------- */

export function TrendChart({ trendData }: { trendData: TrendData }) {
  const gradientPrefix = useId().replace(/:/g, "");
  const keywords = trendData.keywords.slice(0, SERIES_COLORS.length);
  const rows = useMemo(
    () =>
      trendData.interestOverTime.map((point) => {
        const row: Record<string, number | string | null> = { label: formatPointDate(point) };
        keywords.forEach((_, index) => {
          row[`k${index}`] = typeof point.values[index] === "number" ? point.values[index] : null;
        });
        return row;
      }),
    [trendData.interestOverTime, keywords],
  );
  const peak = useMemo(() => {
    let best: { label: string; value: number } | null = null;
    for (const row of rows) {
      const value = row.k0;
      if (typeof value === "number" && (!best || value > best.value)) {
        best = { label: String(row.label), value };
      }
    }
    return best;
  }, [rows]);

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Measured signal
          </div>
          <div className="mt-0.5 text-[12.5px] font-semibold text-foreground">
            Search interest over time
          </div>
        </div>
        <span className="rounded-full bg-secondary px-2 py-1 text-[10px] text-muted-foreground">
          Google Trends · 0–100
        </span>
      </div>
      {keywords.length > 1 && (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1" aria-label="Keywords">
          {keywords.map((keyword, index) => (
            <li key={keyword} className="flex items-center gap-1.5 text-[11px] text-foreground/80">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: SERIES_COLORS[index] }}
                aria-hidden="true"
              />
              {keyword}
            </li>
          ))}
        </ul>
      )}
      {rows.length > 1 ? (
        <div className="mt-3 h-44 w-full @4xl:h-60">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
              <defs>
                {keywords.map((keyword, index) => (
                  <linearGradient
                    key={keyword}
                    id={`${gradientPrefix}-${index}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor={SERIES_COLORS[index]} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={SERIES_COLORS[index]} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.5} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                minTickGap={32}
              />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 50, 100]}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                width={34}
              />
              <Tooltip
                cursor={{ stroke: "hsl(var(--muted-foreground))", strokeOpacity: 0.3 }}
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid hsl(var(--border))",
                  background: "hsl(var(--card))",
                  fontSize: 11.5,
                  boxShadow: "0 12px 32px -16px rgba(0,0,0,0.45)",
                }}
                labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
                formatter={(value, name) => {
                  const index = Number(String(name).slice(1));
                  return [value, keywords[index] ?? String(name)];
                }}
              />
              {keywords.map((keyword, index) => (
                <Area
                  key={keyword}
                  type="monotone"
                  dataKey={`k${index}`}
                  stroke={SERIES_COLORS[index]}
                  fill={`url(#${gradientPrefix}-${index})`}
                  strokeWidth={index === 0 ? 2.25 : 1.75}
                  dot={false}
                  activeDot={{ r: 3.5 }}
                  connectNulls
                />
              ))}
              {peak && (
                <ReferenceDot
                  x={peak.label}
                  y={peak.value}
                  r={4}
                  fill={SERIES_COLORS[0]}
                  stroke="hsl(var(--card))"
                  strokeWidth={2}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mt-3 rounded-lg bg-secondary/35 px-3 py-2 text-[11px] text-muted-foreground">
          Trend history is still compact for this collection; the analysis uses the available
          regional and related-search evidence.
        </div>
      )}
    </section>
  );
}

/* ------------------------------ insight tabs ----------------------------- */

type InsightTabId = "actions" | "signals" | "opportunities" | "searches";

function PriorityPill({ priority }: { priority: Priority }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize",
        priority === "high" && "bg-rose-500/12 text-rose-600 dark:text-rose-400",
        priority === "medium" && "bg-amber-500/15 text-amber-700 dark:text-amber-400",
        priority === "low" && "bg-secondary text-muted-foreground",
      )}
    >
      {priority}
    </span>
  );
}

function Expandable({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group mt-2">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[11px] font-semibold text-foreground/80 hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronDown
          className="h-3 w-3 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
        {label}
      </summary>
      <div className="mt-1.5 space-y-1.5 text-[11.5px] leading-relaxed text-muted-foreground [&_li]:text-[11.5px] [&_p]:text-[11.5px] [&_p]:leading-relaxed">
        {children}
      </div>
    </details>
  );
}

function ActionsList({ intelligence }: { intelligence: Intelligence }) {
  const actions = [...intelligence.recommendations].sort(
    (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
  );
  if (!actions.length) return <EmptyTab text="No recommended moves for this scan." />;
  return (
    <ol className="space-y-2">
      {actions.map((item, index) => (
        <li key={item.action} className="rounded-xl border border-border/60 bg-card p-3">
          <div className="flex items-start gap-2.5">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-foreground text-[11px] font-semibold tabular-nums text-background">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[12.5px] font-semibold leading-snug text-foreground">
                  {item.action}
                </p>
                <PriorityPill priority={item.priority} />
              </div>
              <Expandable label="Why and expected impact">
                <p>
                  <strong className="font-medium text-foreground/85">Why: </strong>
                  {item.reason}
                </p>
                <p>
                  <strong className="font-medium text-foreground/85">Impact: </strong>
                  {item.expectedMarketingImpact}
                </p>
              </Expandable>
              <button
                type="button"
                onClick={() =>
                  askRavi(
                    `Help me execute this marketing move from Market Brain: "${item.action}". Why it matters: ${item.reason}`,
                  )
                }
                className="mt-2 inline-flex min-h-8 items-center gap-1 rounded-full border border-border/70 px-2.5 text-[11px] font-semibold text-foreground/85 transition hover:bg-secondary hover:text-foreground"
              >
                <MessageSquarePlus className="h-3 w-3" aria-hidden="true" /> Ask Ravi to plan it
              </button>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function SignalsList({ intelligence }: { intelligence: Intelligence }) {
  if (!intelligence.trendSignals.length) return <EmptyTab text="No distinct signals this time." />;
  return (
    <div className="space-y-2">
      {intelligence.trendSignals.map((signal) => {
        const rising = signal.direction === "rising";
        const declining = signal.direction === "declining";
        const Icon = rising ? TrendingUp : declining ? TrendingDown : Minus;
        return (
          <article key={signal.title} className="rounded-xl border border-border/60 bg-card p-3">
            <div className="flex items-start gap-2.5">
              <span
                className={cn(
                  "grid h-7 w-7 shrink-0 place-items-center rounded-lg",
                  rising && "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
                  declining && "bg-rose-500/12 text-rose-600 dark:text-rose-400",
                  !rising && !declining && "bg-secondary text-muted-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h4 className="text-[12.5px] font-semibold leading-snug text-foreground">
                    {signal.title}
                  </h4>
                  <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">
                    {signal.direction}
                  </span>
                </div>
                <ul className="mt-1.5 space-y-1">
                  {signal.evidence.map((line) => (
                    <li
                      key={line}
                      className="flex gap-2 text-[11.5px] leading-relaxed text-muted-foreground"
                    >
                      <span
                        className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-emerald-500"
                        aria-hidden="true"
                      />
                      <span className="min-w-0">{line}</span>
                    </li>
                  ))}
                </ul>
                <Expandable label="Why it matters">
                  <p>{signal.significance}</p>
                  {signal.opportunities.length > 0 && (
                    <ul className="space-y-1">
                      {signal.opportunities.map((idea) => (
                        <li key={idea} className="flex gap-1.5">
                          <Lightbulb
                            className="mt-0.5 h-3 w-3 shrink-0 text-amber-500"
                            aria-hidden="true"
                          />
                          {idea}
                        </li>
                      ))}
                    </ul>
                  )}
                </Expandable>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function OpportunitiesList({ intelligence }: { intelligence: Intelligence }) {
  const items = [...intelligence.opportunities].sort(
    (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
  );
  if (!items.length) return <EmptyTab text="No opportunities stood out in this scan." />;
  return (
    <div className="grid gap-2 @xl:grid-cols-2">
      {items.map((item) => (
        <article
          key={item.title}
          className="flex flex-col rounded-xl border border-border/60 bg-card p-3"
        >
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-[12.5px] font-semibold leading-snug text-foreground">
              {item.title}
            </h4>
            <PriorityPill priority={item.priority} />
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
            {item.explanation}
          </p>
          <div className="mt-2 inline-flex max-w-full items-center gap-1.5 self-start rounded-full bg-secondary/70 px-2 py-0.5 text-[10.5px] text-foreground/80">
            <Users className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{item.targetAudience}</span>
          </div>
          <div className="mt-2 flex items-start gap-1.5 border-t border-border/50 pt-2 text-[11.5px] leading-relaxed text-foreground/85">
            <ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" aria-hidden="true" />
            {item.recommendedAction}
          </div>
        </article>
      ))}
    </div>
  );
}

function SearchesPanel({
  intelligence,
  trendData,
}: {
  intelligence: Intelligence | null;
  trendData: TrendData | null;
}) {
  const regions = [...(trendData?.regionalInterest ?? [])]
    .filter((item) => typeof item.values[0] === "number" && (item.values[0] ?? 0) > 0)
    .sort((a, b) => (b.values[0] ?? 0) - (a.values[0] ?? 0))
    .slice(0, 5);
  const related = [
    ...(trendData?.relatedQueries ?? []).map((item) => ({
      label: item.query,
      value: item.value,
      kind: item.kind,
    })),
    ...(trendData?.relatedTopics ?? []).map((item) => ({
      label: item.topicTitle,
      value: item.value,
      kind: item.kind,
    })),
  ];
  const rising = related.filter((item) => item.kind === "rising").slice(0, 8);
  const top = related.filter((item) => item.kind === "top").slice(0, 8);
  const fallback =
    !related.length && intelligence
      ? [...intelligence.relatedQueries, ...intelligence.relatedTopics].slice(0, 12)
      : [];

  if (!regions.length && !related.length && !fallback.length) {
    return <EmptyTab text="Google Trends returned no regional or related-search data." />;
  }
  return (
    <div className="grid gap-3 @xl:grid-cols-2">
      {regions.length > 0 && (
        <section className="rounded-xl border border-border/60 bg-card p-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Top regions
          </h4>
          <ul className="mt-2 space-y-2">
            {regions.map((region) => {
              const value = region.values[0] ?? 0;
              return (
                <li key={region.geoId} className="text-[11.5px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-foreground/90">{region.geoName}</span>
                    <span className="tabular-nums text-muted-foreground">{value}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                    <motion.div
                      className="h-full origin-left rounded-full bg-gradient-to-r from-emerald-500 to-sky-400"
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: value / 100 }}
                      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {(rising.length > 0 || top.length > 0 || fallback.length > 0) && (
        <section className="space-y-3 rounded-xl border border-border/60 bg-card p-3">
          {rising.length > 0 && <ChipGroup title="Rising searches" items={rising} rising />}
          {top.length > 0 && <ChipGroup title="Top searches" items={top} />}
          {fallback.length > 0 && (
            <ChipGroup
              title="Related searches"
              items={fallback.map((label) => ({ label, value: "" }))}
            />
          )}
        </section>
      )}
    </div>
  );
}

function ChipGroup({
  title,
  items,
  rising = false,
}: {
  title: string;
  items: { label: string; value: string }[];
  rising?: boolean;
}) {
  return (
    <div>
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {title}
      </h4>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span
            key={`${item.label}-${item.value}`}
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-border/60 bg-secondary/40 px-2 py-1 text-[11px] text-foreground/85"
          >
            <span className="truncate">{item.label}</span>
            {item.value && (
              <span
                className={cn(
                  "shrink-0 text-[10px] font-semibold",
                  rising ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
                )}
              >
                {item.value}
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

function EmptyTab({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border/70 px-3 py-4 text-center text-[11.5px] text-muted-foreground">
      {text}
    </div>
  );
}

export function InsightTabs({
  intelligence,
  trendData,
}: {
  intelligence: Intelligence;
  trendData: TrendData | null;
}) {
  const [tab, setTab] = useState<InsightTabId>("actions");
  const regionCount = trendData?.regionalInterest.length ?? 0;
  const relatedCount =
    (trendData?.relatedQueries.length ?? 0) + (trendData?.relatedTopics.length ?? 0);
  const tabs: { id: InsightTabId; label: string; icon: typeof ListChecks; count: number }[] = [
    {
      id: "actions",
      label: "Next moves",
      icon: ListChecks,
      count: intelligence.recommendations.length,
    },
    { id: "signals", label: "Signals", icon: TrendingUp, count: intelligence.trendSignals.length },
    {
      id: "opportunities",
      label: "Opportunities",
      icon: Lightbulb,
      count: intelligence.opportunities.length,
    },
    {
      id: "searches",
      label: "Regions & searches",
      icon: Globe2,
      count: regionCount + relatedCount,
    },
  ];

  return (
    <section className="rounded-2xl border border-border/60 bg-secondary/15 p-2.5">
      <div
        role="tablist"
        aria-label="Market insights"
        className="flex gap-1 overflow-x-auto scrollbar-none rounded-xl bg-secondary/50 p-1"
      >
        {tabs.map((item) => {
          const active = tab === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`market-insight-tab-${item.id}`}
              aria-selected={active}
              aria-controls={`market-insight-panel-${item.id}`}
              onClick={() => setTab(item.id)}
              className={cn(
                "relative inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-semibold transition-colors @xl:flex-1 @xl:justify-center",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {active && (
                <motion.span
                  layoutId="market-insight-tab-indicator"
                  className="absolute inset-0 rounded-lg bg-card shadow-sm ring-1 ring-border/60"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              <Icon className="relative h-3.5 w-3.5" aria-hidden="true" />
              <span className="relative whitespace-nowrap">{item.label}</span>
              {item.count > 0 && (
                <span className="relative rounded-full bg-foreground/10 px-1.5 text-[10px] tabular-nums">
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          role="tabpanel"
          id={`market-insight-panel-${tab}`}
          aria-labelledby={`market-insight-tab-${tab}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2 }}
          className="mt-2.5"
        >
          {tab === "actions" && <ActionsList intelligence={intelligence} />}
          {tab === "signals" && <SignalsList intelligence={intelligence} />}
          {tab === "opportunities" && <OpportunitiesList intelligence={intelligence} />}
          {tab === "searches" && (
            <SearchesPanel intelligence={intelligence} trendData={trendData} />
          )}
        </motion.div>
      </AnimatePresence>
    </section>
  );
}

/** Regions & searches are useful even before (or without) an analysis. */
export function TrendExtras({ trendData }: { trendData: TrendData }) {
  return <SearchesPanel intelligence={null} trendData={trendData} />;
}
