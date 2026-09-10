"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AlertTriangle,
  ArrowUpRight,
  BrainCircuit,
  Check,
  ChevronDown,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { authedFetch } from "@/lib/authed-fetch";
import { cn } from "@/lib/utils";

const MARKET_LOCATION_KEY = "market-brain:location:";
const MARKET_KEYWORDS_KEY = "market-brain:keywords:";
const POLL_INTERVAL_MS = 2500;
const MAX_POLLS = 16;
const REQUEST_TIMEOUT_MS = 20_000;

type TrendPoint = { timestamp: number; date: string; values: number[]; averages?: number[] };
type TrendData = {
  keywords: string[];
  interestOverTime: TrendPoint[];
  regionalInterest: { geoId: string; geoName: string; values: number[] }[];
  relatedQueries: { query: string; value: string; kind: "top" | "rising" }[];
  relatedTopics: {
    topicId: string;
    topicTitle: string;
    topicType: string;
    value: string;
    kind: "top" | "rising";
  }[];
};
type Intelligence = {
  summary: string;
  trendSignals: {
    title: string;
    direction: "rising" | "declining" | "stable" | "mixed" | "unclear";
    evidence: string[];
    significance: string;
    opportunities: string[];
  }[];
  opportunities: {
    title: string;
    explanation: string;
    targetAudience: string;
    recommendedAction: string;
    priority: "high" | "medium" | "low";
  }[];
  recommendations: {
    action: string;
    reason: string;
    expectedMarketingImpact: string;
    priority: "high" | "medium" | "low";
  }[];
  relatedQueries: string[];
  relatedTopics: string[];
  confidence: "high" | "medium" | "low";
  generatedAt: string;
};
type ApiResult = {
  state: "cached" | "pending" | "completed" | "failed" | "no_data";
  collectionId?: string;
  taskId?: string;
  data?: TrendData;
  error?: { message?: string };
};

type Props = { workspaceId: string | null; brandKeywords?: string[] };

function loadLocal(key: string, workspaceId: string | null): string | null {
  if (!workspaceId || typeof window === "undefined") return null;
  try {
    return localStorage.getItem(`${key}${workspaceId}`);
  } catch {
    return null;
  }
}

function saveLocal(key: string, workspaceId: string | null, value: string) {
  if (!workspaceId) return;
  try {
    localStorage.setItem(`${key}${workspaceId}`, value);
  } catch {}
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = body.error;
    const message =
      typeof error === "string"
        ? error
        : error && typeof error === "object" && "message" in error
          ? String(error.message)
          : "Market Brain could not load";
    throw new Error(message);
  }
  return body;
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("Market scan aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

export function MarketBrainPanel({ workspaceId, brandKeywords = [] }: Props) {
  const defaults = useMemo(() => brandKeywords.filter(Boolean).slice(0, 5), [brandKeywords]);
  const [location, setLocation] = useState(
    () => loadLocal(MARKET_LOCATION_KEY, workspaceId) ?? "United States",
  );
  const [keywords, setKeywords] = useState(
    () => loadLocal(MARKET_KEYWORDS_KEY, workspaceId) ?? defaults.join(", "),
  );
  const [trendData, setTrendData] = useState<TrendData | null>(null);
  const [intelligence, setIntelligence] = useState<Intelligence | null>(null);
  const [state, setState] = useState<ApiResult["state"]>("no_data");
  const [error, setError] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const requestRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    controllerRef.current?.abort();
    setLocation(loadLocal(MARKET_LOCATION_KEY, workspaceId) ?? "United States");
    setKeywords(loadLocal(MARKET_KEYWORDS_KEY, workspaceId) ?? defaults.join(", "));
    setTrendData(null);
    setIntelligence(null);
    setState("no_data");
  }, [workspaceId, defaults]);

  const run = useCallback(async () => {
    if (!workspaceId) return;
    const requestId = ++requestRef.current;
    const parsedKeywords = keywords
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 5);
    if (!parsedKeywords.length || !location.trim()) {
      setSetupOpen(true);
      setError("Add a market and at least one keyword to start the scan.");
      return;
    }
    saveLocal(MARKET_LOCATION_KEY, workspaceId, location.trim());
    saveLocal(MARKET_KEYWORDS_KEY, workspaceId, parsedKeywords.join(", "));
    setKeywords(parsedKeywords.join(", "));
    setError(null);
    setIntelligence(null);
    setState("pending");
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);

    const fetchJson = async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        return await readJson(await authedFetch(input, { ...init, signal: controller.signal }));
      } finally {
        window.clearTimeout(timeout);
      }
    };

    try {
      const started = (await fetchJson("/api/market/trends", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId,
            keywords: parsedKeywords,
            location: location.trim(),
            language: "en",
          }),
        })) as ApiResult;
      if (requestId !== requestRef.current) return;
      if (!started.collectionId) throw new Error("Market collection could not be started");
      let collection = started;
      for (let poll = 0; poll < MAX_POLLS && collection.state === "pending"; poll++) {
        await sleep(POLL_INTERVAL_MS, controller.signal);
        if (requestId !== requestRef.current) return;
        collection = (await fetchJson(
          `/api/market/trends?collectionId=${encodeURIComponent(started.collectionId)}&workspaceId=${encodeURIComponent(workspaceId)}`,
        )) as ApiResult;
      }
      if (collection.state === "pending") {
        setState("pending");
        setError("Market data is still being collected. We'll update this automatically.");
        return;
      }
      if (collection.state === "failed" || collection.state === "no_data") {
        setState(collection.state);
        setError(
          collection.state === "failed"
            ? "Market scan couldn't be completed. Please try again."
            : "No reliable market data was found for this scan.",
        );
        return;
      }
      if (collection.data) setTrendData(collection.data);
      const analysis = (await fetchJson("/api/market/intelligence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId,
            collectionId: started.collectionId,
            analysisType: "market_strategy",
          }),
        })) as ApiResult & { data?: Intelligence };
      if (requestId !== requestRef.current) return;
      setIntelligence(analysis.data ?? null);
      setState(analysis.state);
      if (!analysis.data)
        setError(
          analysis.state === "failed"
            ? "Market scan couldn't be completed. Please try again."
            : "Market intelligence is not ready yet.",
        );
    } catch (cause) {
      if (requestId !== requestRef.current) return;
      setState("failed");
      setError(
        cause instanceof DOMException && cause.name === "AbortError"
          ? "Market scan timed out. Please try again."
          : "Market scan couldn't be completed. Please try again.",
      );
    } finally {
      if (requestId === requestRef.current) {
        setRunning(false);
        controllerRef.current = null;
      }
    }
  }, [keywords, location, workspaceId]);

  const chartData =
    trendData?.interestOverTime.map((point) => ({
      date:
        point.date ||
        new Date(point.timestamp * 1000).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
      value: point.values[0] ?? 0,
    })) ?? [];

  return (
    <div className="space-y-3" data-testid="market-brain">
      <header className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-gradient-to-br from-emerald-500/[0.07] via-card to-sky-500/[0.06] p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-emerald-500">
            <BrainCircuit className="h-3.5 w-3.5" aria-hidden="true" /> Market Brain
          </div>
          <h2 className="mt-1.5 text-[19px] font-semibold leading-tight tracking-tight text-foreground">
            What is changing in your market?
          </h2>
          <p className="mt-1 max-w-[52ch] text-[12px] leading-relaxed text-muted-foreground">
            Ravi turns measured search interest into the next useful marketing move.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={running}
          aria-label={running ? "Analyzing market" : "Refresh market signals"}
          title="Refresh market signals"
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full bg-foreground px-3 py-2 text-[11px] font-semibold text-background transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
        >
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {running ? "Analyzing…" : state === "pending" ? "Check status" : "Refresh"}
        </button>
      </header>

      {state === "no_data" && !trendData && !intelligence && (
        <MarketSetup
          location={location}
          keywords={keywords}
          open
          onLocation={setLocation}
          onKeywords={setKeywords}
          onSubmit={() => {
            setSetupOpen(false);
            void run();
          }}
        />
      )}
      {state === "pending" && <CollectingState />}
      {error && state !== "pending" && (
        <div
          className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3 text-[12px] text-amber-700 dark:text-amber-300"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0 flex-1">{error}</div>
          <button
            type="button"
            onClick={() => void run()}
            className="inline-flex shrink-0 items-center gap-1 font-semibold hover:underline"
          >
            <RefreshCw className="h-3 w-3" /> Retry
          </button>
        </div>
      )}
      {intelligence && (
        <IntelligenceView
          intelligence={intelligence}
          trendData={trendData}
          chartData={chartData}
          cached={state === "cached"}
        />
      )}
      {!intelligence && trendData && state !== "pending" && (
        <TrendEvidence trendData={trendData} chartData={chartData} />
      )}
    </div>
  );
}

function MarketSetup({
  location,
  keywords,
  open,
  onLocation,
  onKeywords,
  onSubmit,
}: {
  location: string;
  keywords: string;
  open: boolean;
  onLocation: (value: string) => void;
  onKeywords: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <section className="rounded-2xl border border-dashed border-border/80 bg-secondary/20 p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-foreground/5 text-foreground">
          <MapPin className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold text-foreground">Set your market lens</h3>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
            Choose where you sell and the topics worth watching. You can change this any time.
          </p>
          {open && (
            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_auto]">
              <label className="min-w-0">
                <span className="sr-only">Market location</span>
                <span className="relative block">
                  <MapPin className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    value={location}
                    onChange={(event) => onLocation(event.target.value)}
                    placeholder="United States"
                    className="h-9 w-full rounded-lg border border-border/70 bg-background/60 pl-8 pr-2 text-[12px] outline-none focus:border-foreground/40"
                  />
                </span>
              </label>
              <label className="min-w-0">
                <span className="sr-only">Market keywords</span>
                <span className="relative block">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    value={keywords}
                    onChange={(event) => onKeywords(event.target.value)}
                    placeholder="AI marketing, marketing automation"
                    className="h-9 w-full rounded-lg border border-border/70 bg-background/60 pl-8 pr-2 text-[12px] outline-none focus:border-foreground/40"
                  />
                </span>
              </label>
              <button
                type="button"
                onClick={onSubmit}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-foreground px-3 text-[11.5px] font-semibold text-background hover:opacity-90"
              >
                <Sparkles className="h-3.5 w-3.5" /> Scan
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function CollectingState() {
  return (
    <div
      className="flex items-center gap-3 rounded-xl border border-border/70 bg-card p-4"
      role="status"
      aria-live="polite"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-500/10 text-emerald-500">
        <Loader2 className="h-4 w-4 animate-spin" />
      </span>
      <div>
        <div className="text-[12.5px] font-semibold text-foreground">
          Market data is still being collected. We'll update this automatically.
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          The scan is running in the background. You can keep working.
        </div>
      </div>
    </div>
  );
}

function IntelligenceView({
  intelligence,
  trendData,
  chartData,
  cached,
}: {
  intelligence: Intelligence;
  trendData: TrendData | null;
  chartData: { date: string; value: number }[];
  cached: boolean;
}) {
  return (
    <>
      <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4">
        <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-emerald-500">
          <Sparkles className="h-3 w-3" /> Market pulse{" "}
          {cached && (
            <span className="ml-auto rounded-full bg-background/60 px-2 py-0.5 text-[9.5px] normal-case tracking-normal text-muted-foreground">
              Latest available
            </span>
          )}
        </div>
        <p className="mt-2 text-[14px] font-medium leading-relaxed text-foreground">
          {intelligence.summary}
        </p>
        <div className="mt-2 text-[10.5px] text-muted-foreground">
          Confidence:{" "}
          <span className="font-semibold capitalize text-foreground/80">
            {intelligence.confidence}
          </span>
        </div>
      </section>
      <TrendEvidence trendData={trendData} chartData={chartData} />
      <section>
        <SectionHeading eyebrow="Interpretation" title="What’s changing" />
        <div className="space-y-2">
          {intelligence.trendSignals.map((signal) => (
            <SignalCard key={signal.title} signal={signal} />
          ))}
        </div>
      </section>
      <section>
        <SectionHeading eyebrow="Opportunity" title="Where to lean in" />
        <div className="grid gap-2 sm:grid-cols-2">
          {intelligence.opportunities.map((item) => (
            <OpportunityCard key={item.title} opportunity={item} />
          ))}
        </div>
      </section>
      <section>
        <SectionHeading eyebrow="Action" title="What to do next" />
        <div className="space-y-2">
          {intelligence.recommendations.map((item) => (
            <RecommendationCard key={item.action} recommendation={item} />
          ))}
        </div>
      </section>
      <RelatedSearches queries={intelligence.relatedQueries} topics={intelligence.relatedTopics} />
    </>
  );
}

function TrendEvidence({
  trendData,
  chartData,
}: {
  trendData: TrendData | null;
  chartData: { date: string; value: number }[];
}) {
  if (!trendData) return null;
  return (
    <section className="rounded-xl border border-border/70 bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Measured signal
          </div>
          <div className="mt-1 text-[12px] font-medium text-foreground">
            {trendData.keywords.join(" · ")}
          </div>
        </div>
        <span className="rounded-full bg-secondary px-2 py-1 text-[10px] text-muted-foreground">
          Google Trends
        </span>
      </div>
      {chartData.length > 1 ? (
        <div className="mt-3 h-36 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 6, right: 4, left: -26, bottom: 0 }}>
              <defs>
                <linearGradient id="market-brain-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--brand-green))" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="hsl(var(--brand-green))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                minTickGap={28}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                width={34}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 10,
                  border: "1px solid hsl(var(--border))",
                  background: "hsl(var(--card))",
                  fontSize: 11,
                }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="hsl(var(--brand-green))"
                fill="url(#market-brain-fill)"
                strokeWidth={2}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mt-3 rounded-lg bg-secondary/35 px-3 py-2 text-[11px] text-muted-foreground">
          Trend history is still compact for this collection; the AI is using the available regional
          and related-search evidence.
        </div>
      )}
    </section>
  );
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-2 flex items-baseline gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {eyebrow}
      </span>
      <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
    </div>
  );
}

function SignalCard({ signal }: { signal: Intelligence["trendSignals"][number] }) {
  const rising = signal.direction === "rising";
  const declining = signal.direction === "declining";
  return (
    <article className="rounded-xl border border-border/70 bg-card p-3">
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg",
            rising
              ? "bg-emerald-500/10 text-emerald-500"
              : declining
                ? "bg-amber-500/10 text-amber-500"
                : "bg-secondary text-muted-foreground",
          )}
        >
          {rising ? (
            <TrendingUp className="h-3.5 w-3.5" />
          ) : declining ? (
            <TrendingDown className="h-3.5 w-3.5" />
          ) : (
            <span className="h-1.5 w-3 rounded-full bg-current" />
          )}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-foreground">
            <span>{signal.title}</span>
            <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[9.5px] font-medium capitalize text-muted-foreground">
              {signal.direction}
            </span>
          </div>
          <div className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
            <strong className="font-medium text-foreground/80">Evidence:</strong>{" "}
            {signal.evidence.join(" ")}
          </div>
          <div className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
            <strong className="font-medium text-foreground/80">Why it matters:</strong>{" "}
            {signal.significance}
          </div>
        </div>
      </div>
    </article>
  );
}

function OpportunityCard({ opportunity }: { opportunity: Intelligence["opportunities"][number] }) {
  return (
    <article className="rounded-xl border border-border/70 bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-[12.5px] font-semibold text-foreground">{opportunity.title}</h4>
        <span className="shrink-0 rounded-full bg-violet-500/10 px-2 py-0.5 text-[9.5px] font-semibold capitalize text-violet-500">
          {opportunity.priority}
        </span>
      </div>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
        {opportunity.explanation}
      </p>
      <div className="mt-2 border-t border-border/50 pt-2 text-[11px]">
        <span className="font-semibold text-foreground/80">For </span>
        <span className="text-muted-foreground">{opportunity.targetAudience}</span>
      </div>
      <div className="mt-1.5 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-foreground/85">
        <ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0 text-violet-500" />
        {opportunity.recommendedAction}
      </div>
    </article>
  );
}

function RecommendationCard({
  recommendation,
}: {
  recommendation: Intelligence["recommendations"][number];
}) {
  return (
    <article className="flex items-start gap-2.5 rounded-xl border border-border/70 bg-card p-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-foreground text-background">
        <Check className="h-3 w-3" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-foreground">
          <span>{recommendation.action}</span>
          <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[9.5px] font-medium capitalize text-muted-foreground">
            {recommendation.priority}
          </span>
        </div>
        <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
          <strong className="font-medium text-foreground/80">Why:</strong> {recommendation.reason}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          <strong className="font-medium text-foreground/80">Expected impact:</strong>{" "}
          {recommendation.expectedMarketingImpact}
        </p>
      </div>
    </article>
  );
}

function RelatedSearches({ queries, topics }: { queries: string[]; topics: string[] }) {
  if (!queries.length && !topics.length) return null;
  return (
    <section className="rounded-xl border border-border/70 bg-secondary/20 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <Search className="h-3 w-3" /> Related searches
      </div>
      <div className="flex flex-wrap gap-1.5">
        {[...queries, ...topics].slice(0, 12).map((item) => (
          <span
            key={item}
            className="rounded-full border border-border/60 bg-card/70 px-2 py-1 text-[10.5px] text-foreground/80"
          >
            {item}
          </span>
        ))}
      </div>
    </section>
  );
}
