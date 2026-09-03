"use client";

import { useEffect, useState, createContext, useContext, useMemo } from "react";
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
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  Search,
  Share2,
  Users,
  ArrowUpRight,
  Activity,
  AlertCircle,
  AlertTriangle,
  Info,
  ChevronDown,
  FileText,
  RefreshCcw,
  WifiOff,
  Loader2,
} from "@/components/ui/gemini-icons";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  getAnalyticsSummary,
  getAnalyticsDrilldown,
  type AnalyticsSummary,
  type DrilldownItem,
} from "@/lib/analytics.functions";
import { AnalyticsTabs, type AnalyticsTab } from "@/components/app/AnalyticsTabs";
import { AgentManagementPanel } from "@/components/app/AgentManagementPanel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

function useActiveWorkspaceId(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const read = () => {
      try {
        setId(localStorage.getItem("workspace:selected"));
      } catch {}
    };
    read();
    const onWorkspaceChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ id?: string }>).detail;
      if (detail?.id) setId(detail.id);
      else read();
    };
    window.addEventListener("storage", read);
    window.addEventListener("workspace:changed", onWorkspaceChanged);
    return () => {
      window.removeEventListener("storage", read);
      window.removeEventListener("workspace:changed", onWorkspaceChanged);
    };
  }, []);
  return id;
}

/* -------------------- Date range (weekly / monthly / quarterly) -------------------- */

export type RangeDays = 7 | 30 | 90;
const RANGE_STORAGE_KEY = "analytics:range-days";
const RANGE_OPTIONS: { label: string; sub: string; value: RangeDays }[] = [
  { label: "Weekly", sub: "7d", value: 7 },
  { label: "Monthly", sub: "30d", value: 30 },
  { label: "Quarterly", sub: "90d", value: 90 },
];

const RangeContext = createContext<{ days: RangeDays; setDays: (d: RangeDays) => void }>({
  days: 30,
  setDays: () => {},
});

function RangeProvider({ children }: { children: React.ReactNode }) {
  const [days, setDaysState] = useState<RangeDays>(30);
  useEffect(() => {
    const raw = Number(localStorage.getItem(RANGE_STORAGE_KEY));
    if (raw === 7 || raw === 30 || raw === 90) setDaysState(raw);
  }, []);
  const value = useMemo(
    () => ({
      days,
      setDays: (d: RangeDays) => {
        setDaysState(d);
        try {
          localStorage.setItem(RANGE_STORAGE_KEY, String(d));
        } catch {
          /* ignore */
        }
      },
    }),
    [days],
  );
  return <RangeContext.Provider value={value}>{children}</RangeContext.Provider>;
}

function useRangeDays() {
  return useContext(RangeContext);
}

function RangePicker() {
  const { days, setDays } = useRangeDays();
  return (
    <div
      role="tablist"
      aria-label="Date range"
      className="inline-flex items-center rounded-full border border-border bg-card/80 p-0.5 text-[11.5px]"
    >
      {RANGE_OPTIONS.map((opt) => {
        const active = days === opt.value;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            onClick={() => setDays(opt.value)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium transition ${
              active
                ? "bg-foreground text-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>{opt.label}</span>
            <span className={active ? "opacity-70" : "opacity-60"}>· {opt.sub}</span>
          </button>
        );
      })}
    </div>
  );
}

function useAnalyticsSummary(workspaceId: string | null) {
  const { days } = useRangeDays();
  const fetcher = useServerFn(getAnalyticsSummary);
  const qc = useQueryClient();
  const query = useQuery<AnalyticsSummary>({
    queryKey: ["analytics-summary", workspaceId, days],
    enabled: !!workspaceId,
    queryFn: () => fetcher({ data: { workspaceId: workspaceId as string, days } }),
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
    window.addEventListener("geo:audit-complete", invalidate);
    window.addEventListener("workspace:changed", invalidate);
    return () => {
      window.removeEventListener("geo:audit-complete", invalidate);
      window.removeEventListener("workspace:changed", invalidate);
    };
  }, [qc, workspaceId]);
  return query;
}

type DrillTarget = { dimension: "channel" | "agent" | "kind"; value: string } | null;

function useDrilldown(workspaceId: string | null, target: DrillTarget) {
  const { days } = useRangeDays();
  const fetcher = useServerFn(getAnalyticsDrilldown);
  return useQuery<DrilldownItem[]>({
    queryKey: ["analytics-drilldown", workspaceId, target?.dimension, target?.value, days],
    enabled: !!workspaceId && !!target,
    queryFn: () =>
      fetcher({
        data: {
          workspaceId: workspaceId as string,
          dimension: (target as { dimension: "channel" | "agent" | "kind" }).dimension,
          value: (target as { value: string }).value,
          days,
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
  const { days } = useRangeDays();
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
            Content items in the last {days} days for this {target?.dimension}.
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
                window.dispatchEvent(new CustomEvent("chat:prefill", { detail: ask }));
                window.dispatchEvent(new CustomEvent("chat:focus"));
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
  showHeader = true,
}: {
  tab: AnalyticsTab;
  onTabChange: (t: AnalyticsTab) => void;
  showHeader?: boolean;
}) {
  return (
    <RangeProvider>
      <div className="mx-auto w-full max-w-6xl space-y-5 p-3 pb-16 sm:p-5 lg:p-6">
        {showHeader && (
          <motion.header {...fade(0)} className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Everything your AI team is moving — across organic, AI, social, and content.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <RangePicker />
              <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/80 px-3 py-1.5 text-[11px] text-muted-foreground">
                <Activity className="h-3 w-3 text-aura" />
                Auto-updated
              </div>
            </div>
          </motion.header>
        )}

        <AnalyticsTabs value={tab} onChange={onTabChange} />

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="space-y-5"
          >
            {tab === "overview" && <OverviewPanel />}
            {tab === "organic" && <OrganicPanel />}
            {tab === "social" && <SocialPanel />}
            {tab === "content" && <ContentPanel />}
            {tab === "audience" && <AudiencePanel />}
            {tab === "automations" && <AutomationsTabPanel />}
          </motion.div>
        </AnimatePresence>
      </div>
    </RangeProvider>
  );
}

/* -------------------- Overview -------------------- */

function OverviewPanel() {
  const workspaceId = useActiveWorkspaceId();
  const query = useAnalyticsSummary(workspaceId);
  const { data, isLoading } = query;
  const { days } = useRangeDays();
  const rangeLabel = days === 7 ? "week" : days === 30 ? "month" : "quarter";

  const [drill, setDrill] = useState<DrillTarget>(null);

  const t = data?.totals;
  const d = data?.deltas;
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`);
  const pct = (n: number | undefined) => (n === undefined ? "—" : `${n > 0 ? "+" : ""}${n}%`);

  const liveKpis = [
    {
      label: "Content items",
      value: fmt(t?.items ?? 0),
      delta: pct(d?.items),
      positive: (d?.items ?? 0) >= 0,
    },
    {
      label: `Published (${days}d)`,
      value: fmt(t?.published ?? 0),
      delta: pct(d?.published),
      positive: (d?.published ?? 0) >= 0,
    },
    {
      label: "Scheduled",
      value: fmt(t?.scheduled ?? 0),
      delta: `${t?.pending ?? 0} pending`,
      positive: true,
    },
    {
      label: "Approvals waiting",
      value: fmt(data?.approvals.pending ?? 0),
      delta: `${data?.approvals.approved ?? 0} approved`,
      positive: (data?.approvals.pending ?? 0) === 0,
    },
  ];

  const series = (data?.daily ?? []).map((row) => ({
    day: row.day,
    organic: row.created,
    ai: row.published,
  }));

  return (
    <>
      <SystemDesignCard />
      <PanelState query={query} skeletonRows={4}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {liveKpis.map((k, i) => {
            const Up = k.positive ? TrendingUp : TrendingDown;
            return (
              <motion.div
                key={k.label}
                {...fade(i + 1)}
                className="group rounded-2xl border border-border bg-card/70 p-4 backdrop-blur transition hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-sm"
              >
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {k.label}
                </div>
                <div className="mt-2 text-2xl font-semibold tabular-nums">
                  {isLoading && !data ? "—" : k.value}
                </div>
                <div
                  className={`mt-1 inline-flex items-center gap-1 text-[11.5px] font-medium ${k.positive ? "text-success" : "text-destructive"}`}
                >
                  <Up className="h-3 w-3" /> {k.delta}
                </div>
              </motion.div>
            );
          })}
        </div>

        <motion.section
          {...fade(5)}
          className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-aura/5 via-card/80 to-card p-5"
        >
          <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-aura/15 blur-3xl" />
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-aura">
            <Sparkles className="h-3.5 w-3.5" /> This {rangeLabel}, in plain English
          </div>
          <p className="mt-3 text-[14.5px] leading-relaxed text-foreground/90">
            {data && t ? (
              <>
                You have <b>{t.items}</b> content items in the last {days} days —{" "}
                <b>{t.published}</b> published, <b>{t.scheduled}</b> scheduled, and{" "}
                <b>{data.approvals.pending}</b> awaiting your approval. Connect your site, Google
                &amp; Meta accounts to unlock organic and AI-citation tracking.
              </>
            ) : (
              <>
                This is your <b>AI CMO</b> view. Once you connect your site, Google &amp; Meta
                accounts, Ravi 1.0 will summarize what moved this {rangeLabel} and recommend the
                next 3 moves.
              </>
            )}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {[
              "Run a Brand DNA scan on my website",
              "Draft this week's content plan",
              "Show me which AI assistants cite my brand",
            ].map((p) => (
              <button
                key={p}
                onClick={() => window.dispatchEvent(new CustomEvent("chat:prefill", { detail: p }))}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-[12px] font-medium text-foreground/85 backdrop-blur transition hover:-translate-y-0.5 hover:border-foreground/30 hover:text-foreground"
              >
                {p} <ArrowUpRight className="h-3 w-3" />
              </button>
            ))}
          </div>
        </motion.section>

        <motion.div {...fade(6)}>
          <Section
            title="Content created vs published"
            subtitle={`Daily activity over the last ${days} days, from your workspace`}
          >
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" opacity={0.4} />
                  <XAxis
                    dataKey="day"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
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
                    dataKey="organic"
                    name={data ? "Created" : "Organic"}
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="ai"
                    name={data ? "Published" : "AI referrals"}
                    stroke="hsl(var(--aura))"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Section>
        </motion.div>

        {data && data.byChannel.length > 0 && (
          <motion.div {...fade(7)}>
            <Section title="Content by channel" subtitle="Click a channel to see the items">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {data.byChannel.slice(0, 8).map((c, i) => {
                  const hues = [217, 270, 38, 142, 0, 190, 320, 95];
                  const hue = hues[i % hues.length];
                  return (
                    <button
                      key={c.channel}
                      onClick={() => setDrill({ dimension: "channel", value: c.channel })}
                      className="flex items-center gap-3 rounded-xl border border-border bg-card/70 p-3 text-left transition hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-sm"
                    >
                      <div
                        className="grid h-9 w-9 place-items-center rounded-lg text-white"
                        style={{
                          background: `linear-gradient(135deg, hsl(${hue} 75% 60%), hsl(${hue} 80% 45%))`,
                        }}
                      >
                        <FileText className="h-4 w-4" strokeWidth={2.2} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground truncate">
                          {c.channel}
                        </div>
                        <div className="text-sm font-semibold tabular-nums">{c.count}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Section>
          </motion.div>
        )}

        {data && data.byAgent.length > 0 && (
          <motion.div {...fade(8)}>
            <Section title="Content by agent" subtitle="Click an agent to see what they created">
              <ul className="divide-y divide-border/60">
                {data.byAgent.slice(0, 10).map((a) => {
                  const max = data.byAgent[0]?.count || 1;
                  const pct = Math.round((a.count / max) * 100);
                  return (
                    <li key={a.agent}>
                      <button
                        onClick={() => setDrill({ dimension: "agent", value: a.agent })}
                        className="flex w-full items-center gap-3 py-2.5 text-left text-[12.5px] transition hover:bg-muted/40"
                      >
                        <span className="w-28 shrink-0 truncate font-medium capitalize">
                          {a.agent}
                        </span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
                          {a.count}
                        </span>
                        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Section>
          </motion.div>
        )}

        {data && data.recent.length > 0 && (
          <motion.div {...fade(8)}>
            <Section title="Recent activity" subtitle="Latest items created by your agents">
              <ul className="divide-y divide-border/60">
                {data.recent.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-3 py-2.5 text-[12.5px]"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{r.title ?? "Untitled item"}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {r.agent} · {r.channel ?? "no channel"} ·{" "}
                        {new Date(r.created_at).toLocaleString()}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full border border-border/60 px-2 py-0.5 text-[10.5px] uppercase tracking-wider text-muted-foreground">
                      {r.status}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          </motion.div>
        )}
      </PanelState>

      <DrilldownDialog workspaceId={workspaceId} target={drill} onClose={() => setDrill(null)} />
    </>
  );
}

/* -------------------- System design card -------------------- */

function SystemDesignCard() {
  const [open, setOpen] = useState(false);
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card/50">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-card/80 sm:px-5"
      >
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-[hsl(var(--brand-blue)/0.25)] to-[hsl(var(--brand-green)/0.25)]">
            <Sparkles className="h-3.5 w-3.5 text-foreground/80" />
          </span>
          <div>
            <div className="text-[12.5px] font-semibold">How this works</div>
            <div className="text-[11px] text-muted-foreground">
              System design & user flow — no jargon
            </div>
          </div>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="space-y-4 border-t border-border/60 px-4 py-4 sm:px-5">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  User flow
                </div>
                <ol className="mt-2 grid gap-2 text-[12.5px] sm:grid-cols-2">
                  {[
                    ["1. Sign in", "We load your workspace."],
                    [
                      "2. Talk in Chat",
                      "Brainstorm freely. Chat never runs ads, posts, or scans on its own.",
                    ],
                    [
                      "3. Open Analytics",
                      "Click the Analytics button to see Organic, Social, Content and Audience.",
                    ],
                    [
                      "4. Run Automations",
                      "Toggle agents on/off from the Automations tab inside Analytics.",
                    ],
                  ].map(([t, d]) => (
                    <li key={t} className="rounded-xl border border-border/60 bg-background/40 p-3">
                      <div className="font-medium">{t}</div>
                      <div className="text-muted-foreground">{d}</div>
                    </li>
                  ))}
                </ol>
              </div>
              <p className="text-[11.5px] text-muted-foreground">
                Rule: <b>Chat is advisory only.</b> Anything that spends money, posts publicly, or
                changes your site only runs when you click a button here or toggle an automation.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/* -------------------- Organic -------------------- */

function OrganicPanel() {
  const workspaceId = useActiveWorkspaceId();
  const query = useAnalyticsSummary(workspaceId);
  const { data, isLoading } = query;
  const audit = data?.latestAudit;
  const subs = audit?.subscores ?? {};
  const scoreCards = [
    { label: "SEO", key: "content", color: "#2D7EF8" },
    { label: "AEO", key: "schema", color: "#F59E0B" },
    { label: "GEO", key: "ai-access", color: "#EF4444" },
  ].map((s) => ({ ...s, score: Math.round((subs[s.key] as number) ?? 0) }));

  const actions = audit?.topActions ?? [];

  return (
    <PanelState query={query} skeletonRows={3}>
      <PanelIntro
        tone="blue"
        headline={
          audit
            ? `Your visibility score is ${audit.score}/100.`
            : "Run a Visibility scan to see how AI engines read your site."
        }
        sentence={
          audit ? (
            <>
              Last scan checked {audit.url ?? "your site"} and flagged <b>{actions.length}</b>{" "}
              improvements to raise SEO, AEO and GEO. Fix the top ones to move up.
            </>
          ) : (
            <>
              Open the AI Visibility panel and enter your URL — we'll run a live 40-point audit and
              store the score here.
            </>
          )
        }
        ask={
          audit
            ? "Draft a plan to fix the top 3 visibility issues"
            : "Run a visibility audit on my website"
        }
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <Section
          title="Latest visibility scores"
          subtitle={audit ? new Date(audit.created_at).toLocaleString() : "No audit yet"}
        >
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {scoreCards.map((s) => {
              const c = 2 * Math.PI * 32;
              return (
                <div
                  key={s.label}
                  className="rounded-xl border border-border/60 bg-background/40 p-3 text-center"
                >
                  <svg width="84" height="84" viewBox="0 0 84 84" className="mx-auto">
                    <circle
                      cx="42"
                      cy="42"
                      r="32"
                      stroke="hsl(var(--border))"
                      strokeWidth="7"
                      fill="none"
                    />
                    <circle
                      cx="42"
                      cy="42"
                      r="32"
                      stroke={s.color}
                      strokeWidth="7"
                      fill="none"
                      strokeDasharray={c}
                      strokeDashoffset={c - (c * s.score) / 100}
                      strokeLinecap="round"
                      transform="rotate(-90 42 42)"
                    />
                    <text
                      x="42"
                      y="47"
                      textAnchor="middle"
                      className="fill-foreground"
                      style={{ fontSize: 18, fontWeight: 600 }}
                    >
                      {s.score}
                    </text>
                  </svg>
                  <div className="mt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {s.label}
                  </div>
                </div>
              );
            })}
          </div>
          {!audit && !isLoading && (
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("open:visibility"))}
              className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-border/70 bg-background/70 px-3 py-2 text-[12px] font-medium hover:border-foreground/30"
            >
              Run first visibility audit <ArrowUpRight className="h-3 w-3" />
            </button>
          )}
        </Section>

        <Section title="Sub-scores" subtitle="Per-section breakdown of the latest scan">
          {audit ? (
            <ul className="space-y-3">
              {Object.entries(subs).map(([k, v]) => (
                <li key={k}>
                  <div className="mb-1 flex items-center justify-between text-[12.5px]">
                    <span className="font-medium capitalize">{k.replace(/-/g, " ")}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {Math.round(v as number)}/100
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${Math.round(v as number)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-muted-foreground">
              No audit stored yet. Run one to populate this panel.
            </p>
          )}
        </Section>
      </div>

      <Section title="Top actions from the last audit" subtitle="Ranked by impact on AI visibility">
        {actions.length ? (
          <ul className="space-y-2">
            {actions.map((a) => {
              const Icon =
                a.priority === "high" ? AlertCircle : a.priority === "med" ? AlertTriangle : Info;
              const color =
                a.priority === "high"
                  ? "text-destructive"
                  : a.priority === "med"
                    ? "text-warning"
                    : "text-muted-foreground";
              return (
                <li
                  key={a.id}
                  className="flex items-start gap-2.5 rounded-lg border border-border/70 bg-background/40 p-2.5"
                >
                  <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${color}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium leading-snug">{a.title}</div>
                    <div className="text-[11px] text-muted-foreground">{a.detail}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[12px] text-muted-foreground">
            Once your first scan runs, the highest-impact fixes will appear here.
          </p>
        )}
      </Section>
    </PanelState>
  );
}

function SocialPanel() {
  const workspaceId = useActiveWorkspaceId();
  const query = useAnalyticsSummary(workspaceId);
  const { data } = query;
  const { days } = useRangeDays();
  const upcoming = data?.upcoming ?? [];
  const byChannel = data?.byChannel ?? [];
  const totals = data?.totals;

  const kpis = [
    { label: "Scheduled posts", value: String(totals?.scheduled ?? 0) },
    { label: `Published (${days}d)`, value: String(totals?.published ?? 0) },

    { label: "Active automations", value: String(upcoming.length) },
    { label: "Channels in use", value: String(byChannel.length) },
  ];

  return (
    <PanelState query={query} skeletonRows={2}>
      <PanelIntro
        tone="violet"
        headline={
          upcoming.length ? `${upcoming.length} scheduled posts queued.` : "No scheduled posts yet."
        }
        sentence={
          upcoming.length ? (
            <>
              Your next post goes out {new Date(upcoming[0].next_run_at).toLocaleString()}. Review
              the queue below or shuffle from the calendar.
            </>
          ) : (
            <>Ask Ravi to draft a week and schedule it — items will appear here automatically.</>
          )
        }
        ask={upcoming.length ? "Plan next week's social posts" : "Draft this week's content plan"}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-2xl border border-border bg-card/70 p-4">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {k.label}
            </div>
            <div className="mt-2 text-xl font-semibold tabular-nums">{k.value}</div>
          </div>
        ))}
      </div>

      <Section title="Upcoming runs" subtitle="Next scheduled posts and automations">
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
                    <span className="w-16 shrink-0 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      {when.toLocaleDateString(undefined, { weekday: "short" })}
                    </span>
                    <span className="rounded-md border border-border/60 bg-background/40 px-2 py-0.5 text-[10.5px] text-muted-foreground">
                      {p.channel ?? p.agent}
                    </span>
                    <span className="truncate font-medium">{p.title}</span>
                  </div>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ·{" "}
                    {p.cadence}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[12px] text-muted-foreground">
            Nothing scheduled. Create a content item with a schedule to see it here.
          </p>
        )}
      </Section>
    </PanelState>
  );
}

/* -------------------- Content -------------------- */

function ContentPanel() {
  const workspaceId = useActiveWorkspaceId();
  const query = useAnalyticsSummary(workspaceId);
  const { data } = query;
  const drafts = data?.drafts ?? [];
  const totals = data?.totals;
  const stages = [
    { label: "Draft", n: totals?.drafts ?? 0 },
    { label: "In review", n: totals?.pending ?? 0 },
    { label: "Approved", n: totals?.approved ?? 0 },
    { label: "Scheduled", n: totals?.scheduled ?? 0 },
    { label: "Published", n: totals?.published ?? 0 },
  ];

  return (
    <PanelState query={query} skeletonRows={2}>
      <PanelIntro
        tone="green"
        headline={
          drafts.length
            ? `${drafts.length} pieces are moving through the pipeline.`
            : "No drafts in flight yet."
        }
        sentence={
          drafts.length ? (
            <>
              Focus on approvals to keep publishing momentum. <b>{totals?.pending ?? 0}</b> pieces
              are awaiting review.
            </>
          ) : (
            <>
              Ask Ravi to draft an article, brief or post — new items land here as they're created.
            </>
          )
        }
        ask={drafts.length ? "Move the top 3 drafts through approval" : "Draft an AEO landing page"}
      />
      <Section title="Pipeline" subtitle="Counts by stage across your workspace">
        <div className="flex items-center justify-between gap-2 overflow-x-auto">
          {stages.map((s, i) => (
            <div key={s.label} className="flex flex-1 items-center gap-2">
              <div
                className={`grid h-7 min-w-7 place-items-center rounded-full px-2 text-[11px] font-semibold ${s.n > 0 ? "bg-primary text-primary-foreground" : "border border-border bg-background text-muted-foreground"}`}
              >
                {s.n}
              </div>
              <span
                className={`text-[12px] ${s.n > 0 ? "text-foreground" : "text-muted-foreground"}`}
              >
                {s.label}
              </span>
              {i < stages.length - 1 && <div className="h-px flex-1 bg-border" />}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Drafts" subtitle={`${drafts.length} pieces in flight`}>
        {drafts.length ? (
          <ul className="divide-y divide-border">
            {drafts.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-2.5 text-[12.5px]">
                <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{d.title ?? "Untitled"}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {d.words} words · {d.kind}
                    {d.channel ? ` · ${d.channel}` : ""}
                  </div>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10.5px] capitalize ${d.status === "approved" ? "bg-success/20 text-success" : d.status === "scheduled" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}
                >
                  {d.status.replace("_", " ")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-muted-foreground">
            No drafts yet. Anything Ravi generates lands here first.
          </p>
        )}
      </Section>
    </PanelState>
  );
}

/* -------------------- Audience -------------------- */

function AudiencePanel() {
  const segments = [
    { name: "AI-curious marketers", size: 38, color: "#2D7EF8" },
    { name: "SaaS founders", size: 24, color: "#10A37F" },
    { name: "Agency owners", size: 18, color: "#F59E0B" },
    { name: "In-house SEO leads", size: 12, color: "#A855F7" },
    { name: "Other", size: 8, color: "#94A3B8" },
  ];
  const geo = [
    { country: "United States", pct: 42 },
    { country: "India", pct: 14 },
    { country: "United Kingdom", pct: 9 },
    { country: "Germany", pct: 7 },
    { country: "Canada", pct: 6 },
    { country: "Rest of world", pct: 22 },
  ];
  return (
    <>
      <PanelIntro
        tone="violet"
        headline="Your audience is mostly AI-curious marketers in the US."
        sentence={
          <>
            The top segment makes up <b>38%</b> of visits, mostly from the United States. Tailor
            your next 2 pages to their language to lift signal score.
          </>
        }
        ask="Write 2 pages tuned to AI-curious marketers"
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Sessions (30d)", value: "62.4K" },
          { label: "New vs return", value: "61 / 39" },
          { label: "Avg. session", value: "2m 14s" },
          { label: "Signal score", value: "78" },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-border bg-card/70 p-4">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {k.label}
            </div>
            <div className="mt-2 text-xl font-semibold tabular-nums">{k.value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Segments" subtitle="Who's showing up most this month">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={segments}
                  dataKey="size"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                >
                  {segments.map((s) => (
                    <Cell key={s.name} fill={s.color} stroke="hsl(var(--card))" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 10,
                    fontSize: 12,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 space-y-1.5">
            {segments.map((s) => (
              <li key={s.name} className="flex items-center justify-between text-[11.5px]">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                  {s.name}
                </span>
                <span className="tabular-nums text-muted-foreground">{s.size}%</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Geography" subtitle="Top countries by traffic share">
          <ul className="space-y-2.5">
            {geo.map((g) => (
              <li key={g.country}>
                <div className="mb-1 flex items-center justify-between text-[12px]">
                  <span className="font-medium">{g.country}</span>
                  <span className="tabular-nums text-muted-foreground">{g.pct}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${g.pct * 2.2}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </>
  );
}

/* -------------------- Automations -------------------- */

function AutomationsTabPanel() {
  return (
    <>
      <PanelIntro
        tone="green"
        headline="Toggle background helpers on and off."
        sentence={
          <>
            Each one runs on a schedule so you don't have to. Switch any on and pick how often it
            should work.
          </>
        }
      />
      <div className="rounded-2xl border border-border bg-card/40 p-1">
        <AgentManagementPanel />
      </div>
    </>
  );
}
