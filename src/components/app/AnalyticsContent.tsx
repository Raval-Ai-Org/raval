"use client";

// AnalyticsContent — the unified analytics surface (ADR-0015). Sections:
//   Overview        every source side by side (never blended)
//   Website         Google Analytics 4
//   Search          Google Search Console
//   Content         Mellox content pipeline + social performance
//   AI Visibility   Mellox scan score
//   Insights        deterministic changes + cached AI explanations
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { addAppEventListener, emitAppEvent, removeAppEventListener } from "@/lib/app-events";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@/lib/use-server-fn";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  AlertCircle,
  FileText,
  RefreshCcw,
  WifiOff,
  Loader2,
} from "@/components/icons";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  getAnalyticsSummary,
  getAnalyticsDrilldown,
  type AnalyticsSummary,
  type DrilldownItem,
} from "@/lib/analytics.functions";
import { AnalyticsTabs, type AnalyticsTab } from "@/components/app/AnalyticsTabs";
import { SocialPerformance } from "@/components/app/SocialPerformance";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { AiVisibilityPanel } from "@/components/app/analytics/AiVisibilityPanel";
import { useAnalyticsInvalidation } from "@/components/app/analytics/hooks";
import { InsightsPanel } from "@/components/app/analytics/InsightsPanel";
import { OverviewPanel } from "@/components/app/analytics/OverviewPanel";
import { AnalyticsRangeProvider, RangeBar, useAnalyticsRange } from "@/components/app/analytics/range";
import { SearchPanel } from "@/components/app/analytics/SearchPanel";
import { SourceBadge } from "@/components/app/analytics/ui";
import { WebsitePanel } from "@/components/app/analytics/WebsitePanel";

function useActiveWorkspaceId(): string | null {
  return useOptionalWorkspaceId();
}
/** The shared analytics range, plus its length in days for day-based widgets. */
function useRangeDays() {
  return useAnalyticsRange();
}

function useAnalyticsSummary(workspaceId: string | null) {
  const { range, key } = useRangeDays();
  const fetcher = useServerFn(getAnalyticsSummary);
  const qc = useQueryClient();
  const query = useQuery<AnalyticsSummary>({
    queryKey: ["analytics-summary", workspaceId, key],
    enabled: !!workspaceId,
    queryFn: () => fetcher({ data: { workspaceId: workspaceId as string, range } }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 2,
    retryDelay: (i) => Math.min(1000 * 2 ** i, 8000),
  });
  useEffect(() => {
    if (!workspaceId) return;
    const invalidate = () => {
      qc.invalidateQueries({ queryKey: ["analytics-summary", workspaceId] });
      qc.invalidateQueries({ queryKey: ["analytics-drilldown", workspaceId] });
    };
    addAppEventListener("geo:audit-complete", invalidate);
    return () => {
      removeAppEventListener("geo:audit-complete", invalidate);
    };
  }, [qc, workspaceId]);
  return query;
}

type DrillTarget = { dimension: "channel" | "agent" | "kind"; value: string } | null;

function useDrilldown(workspaceId: string | null, target: DrillTarget) {
  const { range, key } = useRangeDays();
  const fetcher = useServerFn(getAnalyticsDrilldown);
  return useQuery<DrilldownItem[]>({
    queryKey: ["analytics-drilldown", workspaceId, target?.dimension, target?.value, key],
    enabled: !!workspaceId && !!target,
    queryFn: () =>
      fetcher({
        data: {
          workspaceId: workspaceId as string,
          dimension: (target as { dimension: "channel" | "agent" | "kind" }).dimension,
          value: (target as { value: string }).value,
          range,
          limit: 100,
        },
      }),
    staleTime: 30_000,
    retry: 2,
    retryDelay: (i) => Math.min(1000 * 2 ** i, 8000),
  });
}

/* -------------------- Loading / error primitives -------------------- */

function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-[86px] animate-pulse rounded-2xl border border-border bg-muted/40"
          />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-2xl border border-border bg-muted/30" />
      ))}
    </div>
  );
}
function isNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /network|fetch|failed to fetch|offline|timeout/i.test(msg);
}

function PanelError({
  error,
  onRetry,
  isRetrying,
}: {
  error: unknown;
  onRetry: () => void;
  isRetrying?: boolean;
}) {
  const net = isNetworkError(error);
  const message =
    error instanceof Error ? error.message : "Something went wrong loading this panel.";
  const Icon = net ? WifiOff : AlertCircle;
  return (
    <div
      role="alert"
      className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-center"
    >
      <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-destructive/10 text-destructive">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-3 text-[13.5px] font-semibold">
        {net ? "You appear to be offline" : "We couldn't load this panel"}
      </h3>
      <p className="mx-auto mt-1 max-w-md text-[12px] text-muted-foreground">
        {net
          ? "Check your connection and try again — your data is safe."
          : "This is usually a transient hiccup. Retrying often fixes it."}
      </p>
      <p className="mt-2 truncate text-[11px] text-muted-foreground/70" title={message}>
        {message}
      </p>
      <button
        onClick={onRetry}
        disabled={isRetrying}
        className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-[12px] font-medium hover:border-foreground/30 disabled:opacity-60"
      >
        {isRetrying ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <RefreshCcw className="h-3 w-3" />
        )}
        {isRetrying ? "Retrying…" : "Try again"}
      </button>
    </div>
  );
}

/**
 * Wraps a panel body so error/loading states are handled once.
 * When `data` is present we keep rendering it (stale-while-revalidate) —
 * a background refetch failure surfaces as a toast instead of blowing away
 * the whole panel.
 */
function PanelState({
  query,
  children,
  skeletonRows,
}: {
  query: ReturnType<typeof useAnalyticsSummary>;
  children: React.ReactNode;
  skeletonRows?: number;
}) {
  const { data, isLoading, error, isFetching, refetch } = query;
  useEffect(() => {
    if (error && data) {
      toast.error("Analytics refresh failed", {
        description: "Showing the last known data.",
        action: { label: "Retry", onClick: () => void refetch() },
      });
    }
  }, [error, data, refetch]);
  if (isLoading && !data) return <PanelSkeleton rows={skeletonRows} />;
  if (error && !data) {
    return <PanelError error={error} isRetrying={isFetching} onRetry={() => void refetch()} />;
  }
  return <>{children}</>;
}

function DrilldownDialog({
  workspaceId,
  target,
  onClose,
}: {
  workspaceId: string | null;
  target: DrillTarget;
  onClose: () => void;
}) {
  const { data, isLoading, error, isFetching, refetch } = useDrilldown(workspaceId, target);
  const { label } = useRangeDays();
  const open = !!target;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="capitalize">
            {target?.dimension}: {target?.value}
          </DialogTitle>
          <DialogDescription>
            Content items for this {target?.dimension} · {label}.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          {isLoading && (
            <div className="space-y-2 py-2" aria-busy="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded-md bg-muted/40" />
              ))}
            </div>
          )}
          {error && !isLoading && (
            <PanelError error={error} isRetrying={isFetching} onRetry={() => void refetch()} />
          )}
          {!isLoading && !error && data && data.length === 0 && (
            <p className="py-6 text-center text-[12px] text-muted-foreground">
              No items in this window.
            </p>
          )}
          {data && data.length > 0 && (
            <ul className="divide-y divide-border">
              {data.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2.5 text-[12.5px]">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{r.title ?? "Untitled item"}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.agent} · {r.channel ?? "no channel"} · {r.kind} · {r.words} words ·{" "}
                      {new Date(r.created_at).toLocaleString()}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full border border-border/60 px-2 py-0.5 text-[10.5px] uppercase tracking-wider text-muted-foreground">
                    {r.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const EASE = [0.22, 1, 0.36, 1] as const;
const fade = (i = 0) => ({
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.32, ease: EASE, delay: i * 0.04 },
});

function Section({
  title,
  subtitle,
  children,
  action,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card/60 p-4 backdrop-blur sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[11.5px] text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Plain-English summary card shown at the top of every tab. */
function PanelIntro({
  headline,
  sentence,
  tone = "blue",
  ask,
}: {
  headline: string;
  sentence: React.ReactNode;
  tone?: "blue" | "green" | "amber" | "violet";
  ask?: string;
}) {
  const halo: Record<string, string> = {
    blue: "from-[hsl(var(--brand-blue)/0.18)] to-transparent",
    green: "from-[hsl(var(--brand-green)/0.18)] to-transparent",
    amber: "from-amber-500/15 to-transparent",
    violet: "from-violet-500/15 to-transparent",
  };
  const dot: Record<string, string> = {
    blue: "bg-[hsl(var(--brand-blue))]",
    green: "bg-[hsl(var(--brand-green))]",
    amber: "bg-amber-500",
    violet: "bg-violet-500",
  };
  return (
    <motion.section
      {...fade(0)}
      className={`relative overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br ${halo[tone]} via-card/80 to-card/90 p-4 sm:p-5`}
    >
      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-aura/10 blur-3xl" />
      <div className="flex items-start gap-3">
        <span
          className={`mt-1 h-2 w-2 shrink-0 rounded-full ${dot[tone]} shadow-[0_0_10px_currentColor]`}
        />
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            In plain English
          </div>
          <h3 className="mt-0.5 text-[15px] font-semibold tracking-tight">{headline}</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-foreground/80">{sentence}</p>
          {ask && (
            <button
              onClick={() => {
                emitAppEvent("chat:prefill", ask);
                emitAppEvent("chat:focus");
              }}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-[12px] font-medium text-foreground/85 backdrop-blur transition hover:-translate-y-0.5 hover:border-foreground/30 hover:text-foreground"
            >
              {ask} <ArrowUpRight className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </motion.section>
  );
}

export function AnalyticsContent({
  tab,
  onTabChange,
}: {
  tab: AnalyticsTab;
  onTabChange: (t: AnalyticsTab) => void;
  /** Kept for callers; the range bar always shows. */
  showHeader?: boolean;
}) {
  useAnalyticsInvalidation();
  return (
    <AnalyticsRangeProvider>
      <div className="mx-auto w-full max-w-6xl space-y-4 p-3 pb-16 sm:p-5 lg:p-6">
        <div className="flex flex-col gap-2">
          <AnalyticsTabs value={tab} onChange={onTabChange} />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <RangeBar />
          </div>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="space-y-5"
          >
            {tab === "overview" && <OverviewPanel onTabChange={onTabChange} />}
            {tab === "website" && <WebsitePanel />}
            {tab === "search" && <SearchPanel />}
            {tab === "content" && <ContentPanel />}
            {tab === "ai-visibility" && <AiVisibilityPanel />}
            {tab === "insights" && <InsightsPanel />}
          </motion.div>
        </AnimatePresence>
      </div>
    </AnalyticsRangeProvider>
  );
}

/* -------------------- Content (Mellox) -------------------- */

function ContentPanel() {
  const workspaceId = useActiveWorkspaceId();
  const query = useAnalyticsSummary(workspaceId);
  const { data } = query;
  const { days, label } = useRangeDays();
  const [drill, setDrill] = useState<DrillTarget>(null);
  const t = data?.totals;
  const d = data?.deltas;
  const pct = (n: number | undefined) => (n === undefined ? "—" : `${n > 0 ? "+" : ""}${n}%`);
  const kpis = [
    { label: "Created", value: t?.items ?? 0, delta: pct(d?.items), positive: (d?.items ?? 0) >= 0 },
    {
      label: "Published",
      value: t?.published ?? 0,
      delta: pct(d?.published),
      positive: (d?.published ?? 0) >= 0,
    },
    { label: "Scheduled", value: t?.scheduled ?? 0, delta: `${t?.pending ?? 0} in review`, positive: true },
    {
      label: "Waiting for approval",
      value: data?.approvals.pending ?? 0,
      delta: `${data?.approvals.approved ?? 0} approved`,
      positive: (data?.approvals.pending ?? 0) === 0,
    },
  ];
  const series = (data?.daily ?? []).map((row) => ({
    day: row.day,
    created: row.created,
    published: row.published,
  }));
  const drafts = data?.drafts ?? [];
  const upcoming = data?.upcoming ?? [];
  const stages = [
    { label: "Draft", n: t?.drafts ?? 0 },
    { label: "In review", n: t?.pending ?? 0 },
    { label: "Approved", n: t?.approved ?? 0 },
    { label: "Scheduled", n: t?.scheduled ?? 0 },
    { label: "Published", n: t?.published ?? 0 },
  ];

  const barList = (
    rows: Array<{ key: string; count: number }>,
    dimension: "channel" | "agent",
  ) => {
    const max = rows[0]?.count || 1;
    return (
      <ul className="divide-y divide-border/60">
        {rows.slice(0, 8).map((r) => (
          <li key={r.key}>
            <button
              onClick={() => setDrill({ dimension, value: r.key })}
              className="flex w-full items-center gap-3 py-2 text-left text-[12.5px] transition hover:bg-muted/40"
            >
              <span className="w-28 shrink-0 truncate font-medium capitalize">{r.key}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${(r.count / max) * 100}%` }}
                />
              </div>
              <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
                {r.count}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <PanelState query={query} skeletonRows={3}>
      <div className="flex items-center gap-2">
        <SourceBadge source="mellox" />
        <span className="text-[11px] text-muted-foreground">{label}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpis.map((k, i) => {
          const Up = k.positive ? TrendingUp : TrendingDown;
          return (
            <motion.div
              key={k.label}
              {...fade(i + 1)}
              className="rounded-2xl border border-border bg-card/70 p-4"
            >
              <div className="text-[11px] text-muted-foreground">{k.label}</div>
              <div className="mt-2 text-2xl font-semibold tabular-nums">{k.value}</div>
              <div
                className={`mt-1 inline-flex items-center gap-1 text-[11.5px] font-medium ${k.positive ? "text-success" : "text-destructive"}`}
              >
                <Up className="h-3 w-3" aria-hidden /> {k.delta}
              </div>
            </motion.div>
          );
        })}
      </div>

      <Section title="Created vs published" subtitle="Per day, from your workspace">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid
                stroke="hsl(var(--border))"
                strokeDasharray="3 3"
                vertical={false}
                opacity={0.5}
              />
              <XAxis
                dataKey="day"
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                minTickGap={20}
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                tickLine={false}
                axisLine={false}
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
              <Line
                type="monotone"
                dataKey="created"
                name="Created"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="published"
                name="Published"
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="4 3"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <SocialPerformance workspaceId={workspaceId} days={days} />

      <Section title="Pipeline" subtitle="Content by stage in this period">
        <div className="flex items-center justify-between gap-2 overflow-x-auto">
          {stages.map((s, i) => (
            <div key={s.label} className="flex flex-1 items-center gap-2">
              <div
                className={`grid h-7 min-w-7 place-items-center rounded-full px-2 text-[11px] font-semibold ${s.n > 0 ? "bg-primary text-primary-foreground" : "border border-border bg-background text-muted-foreground"}`}
              >
                {s.n}
              </div>
              <span
                className={`whitespace-nowrap text-[12px] ${s.n > 0 ? "text-foreground" : "text-muted-foreground"}`}
              >
                {s.label}
              </span>
              {i < stages.length - 1 && <div className="h-px min-w-3 flex-1 bg-border" />}
            </div>
          ))}
        </div>
      </Section>

      {data && (data.byChannel.length > 0 || data.byAgent.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.byChannel.length > 0 && (
            <Section title="By channel" subtitle="Click to see the items">
              {barList(
                data.byChannel.map((c) => ({ key: c.channel, count: c.count })),
                "channel",
              )}
            </Section>
          )}
          {data.byAgent.length > 0 && (
            <Section title="By agent" subtitle="Click to see what each made">
              {barList(
                data.byAgent.map((a) => ({ key: a.agent, count: a.count })),
                "agent",
              )}
            </Section>
          )}
        </div>
      )}

      <Section title="Coming up" subtitle="Next scheduled posts">
        {upcoming.length ? (
          <ul className="divide-y divide-border">
            {upcoming.map((p) => {
              const when = new Date(p.next_run_at);
              return (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 py-2.5 text-[12.5px]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="w-12 shrink-0 text-[11px] font-medium uppercase text-muted-foreground">
                      {when.toLocaleDateString(undefined, { weekday: "short" })}
                    </span>
                    <span className="rounded-md border border-border/60 bg-background/40 px-2 py-0.5 text-[10.5px] text-muted-foreground">
                      {p.channel ?? p.agent}
                    </span>
                    <span className="truncate font-medium">{p.title}</span>
                  </div>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[12px] text-muted-foreground">Nothing scheduled.</p>
        )}
      </Section>

      <Section title="Drafts" subtitle={`${drafts.length} in progress`}>
        {drafts.length ? (
          <ul className="divide-y divide-border">
            {drafts.map((dr) => (
              <li key={dr.id} className="flex items-center gap-3 py-2.5 text-[12.5px]">
                <FileText className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{dr.title ?? "Untitled"}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {dr.words} words · {dr.kind}
                    {dr.channel ? ` · ${dr.channel}` : ""}
                  </div>
                </div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] capitalize text-muted-foreground">
                  {dr.status.replace("_", " ")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <p className="text-[12px] text-muted-foreground">No drafts in this period.</p>
            <button
              onClick={() => {
                emitAppEvent("chat:prefill", "Draft this week's content plan");
                emitAppEvent("chat:focus");
              }}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-[12px] font-medium text-foreground/85 transition hover:border-foreground/30"
            >
              Plan this week&apos;s content <ArrowUpRight className="h-3 w-3" aria-hidden />
            </button>
          </>
        )}
      </Section>

      <DrilldownDialog workspaceId={workspaceId} target={drill} onClose={() => setDrill(null)} />
    </PanelState>
  );
}

