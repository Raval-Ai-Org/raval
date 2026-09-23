"use client";

import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
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
import { ExternalLink } from "@/components/icons";
import { emitAppEvent } from "@/lib/app-events";
import type { Intelligence, MarketSource, Priority, TrendData } from "@/lib/market-brain-store";
import { relativeTime } from "@/lib/market-brain-store";
import { cn } from "@/lib/utils";

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

function askMellox(prompt: string) {
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

export type SignalMetrics = {
  sourceCount: number;
  domainCount: number;
  newestDate: string | null;
  oldestDate: string | null;
  topDomain: { name: string; count: number } | null;
};

/** At-a-glance numbers derived only from the measured web sources. */
export function computeSignalMetrics(data: TrendData): SignalMetrics {
  const dated = data.sources
    .filter((source) => Boolean(source.publishedDate))
    .sort((a, b) => new Date(b.publishedDate!).getTime() - new Date(a.publishedDate!).getTime());
  const domainCounts = new Map<string, number>();
  for (const source of data.sources) {
    domainCounts.set(source.domain, (domainCounts.get(source.domain) ?? 0) + 1);
  }
  const topDomain = [...domainCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    sourceCount: data.sources.length,
    domainCount: domainCounts.size,
    newestDate: dated[0]?.publishedDate ?? null,
    oldestDate: dated[dated.length - 1]?.publishedDate ?? null,
    topDomain: topDomain ? { name: topDomain[0], count: topDomain[1] } : null,
  };
}

/** The model's own read across its signals — never a measured statistic. */
export function overallDirection(
  intelligence: Intelligence | null,
): "rising" | "declining" | "stable" | null {
  if (!intelligence?.trendSignals.length) return null;
  const counts = { rising: 0, declining: 0, stable: 0 };
  for (const signal of intelligence.trendSignals) {
    if (signal.direction === "rising") counts.rising += 1;
    else if (signal.direction === "declining") counts.declining += 1;
    else if (signal.direction === "stable") counts.stable += 1;
  }
  if (!counts.rising && !counts.declining && !counts.stable) return null;
  return (Object.entries(counts) as [keyof typeof counts, number][]).sort(
    (a, b) => b[1] - a[1],
  )[0][0];
}

function Tile({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border/60 bg-card/80 px-3 py-2.5">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 truncate text-[17px] font-semibold leading-6 tabular-nums tracking-tight text-foreground">
        {value}
      </div>
      {hint && <div className="mt-0.5 truncate text-[10.5px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function KpiStrip({ metrics }: { metrics: SignalMetrics }) {
  return (
    <div
      className="grid grid-cols-2 gap-2 @xl:grid-cols-4"
      aria-label="Market at a glance"
      data-testid="market-brain-kpis"
    >
      <Tile label="Sources found" value={metrics.sourceCount} hint="Recent web results" />
      <Tile
        label="Newest"
        value={metrics.newestDate ? relativeTime(metrics.newestDate) : "—"}
        hint="Most recent coverage"
      />
      <Tile label="Publishers" value={metrics.domainCount} hint="Distinct sites" />
      <Tile
        label="Most coverage"
        value={<span className="text-[15px]">{metrics.topDomain?.name ?? "—"}</span>}
        hint={metrics.topDomain ? `${metrics.topDomain.count} mentions` : "No repeat publisher"}
      />
    </div>
  );
}

/* ------------------------------ pulse card ------------------------------- */

function DirectionBadge({
  direction,
}: {
  direction: NonNullable<ReturnType<typeof overallDirection>>;
}) {
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
  direction: ReturnType<typeof overallDirection>;
  completedAt: string | null;
}) {
  return (
    <section className="ds-tile ds-glow relative overflow-hidden border-primary/20 p-4">
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

/* ------------------------------ signals feed ------------------------------ */

function SourceRow({ source }: { source: MarketSource }) {
  return (
    <li>
      <a
        href={source.url}
        target="_blank"
        rel="noreferrer noopener"
        className="group block rounded-lg border border-border/50 bg-card/60 p-2.5 transition hover:border-border hover:bg-card"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 text-[12px] font-semibold leading-snug text-foreground group-hover:underline">
            {source.title}
          </p>
          <ExternalLink
            className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden="true"
          />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
          <span className="truncate font-medium text-foreground/70">{source.domain}</span>
          {source.publishedDate && (
            <>
              <span aria-hidden="true">·</span>
              <span>{relativeTime(source.publishedDate)}</span>
            </>
          )}
        </div>
        {source.snippet && (
          <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground">
            {source.snippet}
          </p>
        )}
      </a>
    </li>
  );
}

/** The evidence itself: a compact feed of the web sources Mellox read. */
export function SignalsFeed({ trendData }: { trendData: TrendData }) {
  const top = trendData.sources.slice(0, 6);
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Measured signal
          </div>
          <div className="mt-0.5 text-[12.5px] font-semibold text-foreground">
            Recent web coverage
          </div>
        </div>
        <span className="rounded-full bg-secondary px-2 py-1 text-[10px] text-muted-foreground">
          Tavily · web search
        </span>
      </div>
      {top.length ? (
        <ul className="mt-3 space-y-1.5">
          {top.map((source) => (
            <SourceRow key={source.url} source={source} />
          ))}
        </ul>
      ) : (
        <div className="mt-3 rounded-lg bg-secondary/35 px-3 py-2 text-[11px] text-muted-foreground">
          No sources for this collection.
        </div>
      )}
    </section>
  );
}

/* ------------------------------ insight tabs ----------------------------- */

type InsightTabId = "actions" | "signals" | "opportunities" | "sources";

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
                  askMellox(
                    `Help me execute this marketing move from Market Brain: "${item.action}". Why it matters: ${item.reason}`,
                  )
                }
                className="mt-2 inline-flex min-h-8 items-center gap-1 rounded-full border border-border/70 px-2.5 text-[11px] font-semibold text-foreground/85 transition hover:bg-secondary hover:text-foreground"
              >
                <MessageSquarePlus className="h-3 w-3" aria-hidden="true" /> Ask Mellox to plan it
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
            <Lightbulb className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" aria-hidden="true" />
            {item.recommendedAction}
          </div>
        </article>
      ))}
    </div>
  );
}

function ChipGroup({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {title}
      </h4>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span
            key={item}
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-border/60 bg-secondary/40 px-2 py-1 text-[11px] text-foreground/85"
          >
            <span className="truncate">{item}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function SourcesPanel({
  intelligence,
  trendData,
}: {
  intelligence: Intelligence | null;
  trendData: TrendData | null;
}) {
  const topics = [...(intelligence?.relatedTopics ?? []), ...(intelligence?.relatedQueries ?? [])];
  const sources = trendData?.sources ?? [];

  if (!sources.length && !topics.length) {
    return <EmptyTab text="No sources or notable topics for this scan." />;
  }
  return (
    <div className="space-y-3">
      {topics.length > 0 && (
        <section className="rounded-xl border border-border/60 bg-card p-3">
          <ChipGroup title="Notable topics" items={topics.slice(0, 16)} />
        </section>
      )}
      {sources.length > 0 && (
        <section className="rounded-xl border border-border/60 bg-card p-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            All sources ({sources.length})
          </h4>
          <ul className="mt-2 space-y-1.5">
            {sources.map((source) => (
              <SourceRow key={source.url} source={source} />
            ))}
          </ul>
        </section>
      )}
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
  const sourceCount = trendData?.sources.length ?? 0;
  const topicCount =
    (intelligence.relatedQueries.length ?? 0) + (intelligence.relatedTopics.length ?? 0);
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
      id: "sources",
      label: "Sources & topics",
      icon: Globe2,
      count: sourceCount + topicCount,
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
          {tab === "sources" && <SourcesPanel intelligence={intelligence} trendData={trendData} />}
        </motion.div>
      </AnimatePresence>
    </section>
  );
}

/** Sources are useful even before (or without) an analysis. */
export function TrendExtras({ trendData }: { trendData: TrendData }) {
  return <SourcesPanel intelligence={null} trendData={trendData} />;
}
