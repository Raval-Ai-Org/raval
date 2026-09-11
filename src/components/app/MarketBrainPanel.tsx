"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import {
  AlertTriangle,
  BrainCircuit,
  Clock,
  Info,
  Loader2,
  MapPin,
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
  Wand2,
} from "lucide-react";
import {
  analyzeCurrentResult,
  checkPendingScan,
  hydrateMarketBrain,
  relativeTime,
  startMarketScan,
  useMarketBrain,
  type MarketLens,
  type MarketNotice,
} from "@/lib/market-brain-store";
import { cn } from "@/lib/utils";
import {
  computeTrendMetrics,
  InsightTabs,
  KpiStrip,
  PulseSummary,
  Reveal,
  TrendChart,
  TrendExtras,
} from "./MarketBrainInsights";
import { PendingNotice, ResultsSkeleton, ScanProgress } from "./MarketBrainProgress";

const MARKET_LOCATION_KEY = "market-brain:location:";
const MARKET_KEYWORDS_KEY = "market-brain:keywords:";

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

function parseKeywords(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
}

/** Re-renders once a minute so relative times ("2h ago") stay current. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function MarketBrainPanel({ workspaceId, brandKeywords = [] }: Props) {
  const snap = useMarketBrain(workspaceId);
  const defaults = useMemo(() => brandKeywords.filter(Boolean).slice(0, 5), [brandKeywords]);
  const [location, setLocation] = useState(
    () => loadLocal(MARKET_LOCATION_KEY, workspaceId) ?? "United States",
  );
  const [keywords, setKeywords] = useState(
    () => loadLocal(MARKET_KEYWORDS_KEY, workspaceId) ?? defaults.join(", "),
  );
  const [editing, setEditing] = useState(false);
  const [lensError, setLensError] = useState<string | null>(null);
  const now = useMinuteClock();

  useEffect(() => {
    setLocation(loadLocal(MARKET_LOCATION_KEY, workspaceId) ?? "United States");
    setKeywords(loadLocal(MARKET_KEYWORDS_KEY, workspaceId) ?? defaults.join(", "));
    setEditing(false);
    setLensError(null);
  }, [workspaceId, defaults]);

  // Show the stored result (free) every time the panel opens.
  useEffect(() => {
    if (workspaceId) void hydrateMarketBrain(workspaceId);
  }, [workspaceId]);

  // Inputs follow the stored result's lens unless the user saved one here.
  const resultLens = snap.resultLens;
  useEffect(() => {
    if (!resultLens || !workspaceId) return;
    if (!loadLocal(MARKET_KEYWORDS_KEY, workspaceId) && resultLens.keywords.length) {
      setKeywords(resultLens.keywords.join(", "));
    }
    if (!loadLocal(MARKET_LOCATION_KEY, workspaceId) && resultLens.location) {
      setLocation(resultLens.location);
    }
  }, [resultLens, workspaceId]);

  const inputLens = (): MarketLens | null => {
    const parsed = parseKeywords(keywords);
    const market = location.trim();
    return parsed.length && market ? { keywords: parsed, location: market } : null;
  };

  const runScan = () => {
    if (!workspaceId) return;
    const lens = inputLens();
    if (!lens) {
      setLensError("Add a market and at least one keyword to start the scan.");
      setEditing(true);
      return;
    }
    saveLocal(MARKET_LOCATION_KEY, workspaceId, lens.location);
    saveLocal(MARKET_KEYWORDS_KEY, workspaceId, lens.keywords.join(", "));
    setKeywords(lens.keywords.join(", "));
    setLensError(null);
    setEditing(false);
    void startMarketScan(workspaceId, lens);
  };

  const onPrimary = () => {
    if (!workspaceId) return;
    if (snap.pending) {
      const lens = inputLens() ?? snap.resultLens;
      if (lens) void checkPendingScan(workspaceId, lens);
      return;
    }
    runScan();
  };

  const onNoticeAction = (notice: MarketNotice) => {
    if (!workspaceId) return;
    if (notice.action === "analyze") void analyzeCurrentResult(workspaceId);
    else runScan();
  };

  const { running, phase, trendData, intelligence, notice } = snap;
  const hasResults = Boolean(trendData || intelligence);
  const refreshing = running && snap.staleResults;
  const analyzingFresh = running && phase === "analyzing" && !intelligence && Boolean(trendData);
  const metrics = useMemo(() => (trendData ? computeTrendMetrics(trendData) : null), [trendData]);
  const fresh = snap.freshUntil ? new Date(snap.freshUntil).getTime() > now : false;
  const showSetup = snap.hydrated && !hasResults && !running && !snap.pending;
  const displayLens = snap.resultLens ?? inputLens();
  const buttonLabel = running
    ? phase === "analyzing"
      ? "Analyzing…"
      : "Scanning…"
    : snap.pending
      ? "Check status"
      : "Refresh";

  return (
    <MotionConfig reducedMotion="user">
      <div className="@container space-y-3" data-testid="market-brain" aria-busy={running}>
        {/* ── Header ─────────────────────────────────────────── */}
        <header className="relative overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-emerald-500/[0.08] via-card to-sky-500/[0.06] p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-400">
                <BrainCircuit className="h-3.5 w-3.5" aria-hidden="true" /> Market Brain
                {running && (
                  <span className="relative ml-0.5 flex h-1.5 w-1.5" aria-hidden="true">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  </span>
                )}
              </div>
              <h2 className="mt-1.5 text-[17px] font-semibold leading-tight tracking-tight text-foreground @xl:text-[19px]">
                What is changing in your market?
              </h2>
              <p className="mt-1 max-w-[52ch] text-[12px] leading-relaxed text-muted-foreground">
                Ravi turns measured search interest into your next marketing move.
              </p>
            </div>
            <motion.button
              type="button"
              onClick={onPrimary}
              disabled={running || !workspaceId}
              whileTap={running ? undefined : { scale: 0.96 }}
              aria-label={running ? buttonLabel : "Refresh market signals"}
              title={
                fresh && !running
                  ? "Data is fresh — refreshing reuses the stored scan at no extra cost"
                  : "Refresh market signals"
              }
              className="group relative inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full bg-foreground px-3.5 text-[11.5px] font-semibold text-background shadow-sm transition-[opacity,box-shadow] hover:opacity-90 hover:shadow-md disabled:cursor-wait"
            >
              {running && (
                <motion.span
                  aria-hidden="true"
                  className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-background/25 to-transparent"
                  animate={{ x: ["-120%", "260%"] }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                />
              )}
              {running ? (
                <Loader2 className="relative h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw
                  className="relative h-3.5 w-3.5 transition-transform duration-500 group-hover:rotate-180"
                  aria-hidden="true"
                />
              )}
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={buttonLabel}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18 }}
                  className="relative"
                >
                  {buttonLabel}
                </motion.span>
              </AnimatePresence>
            </motion.button>
          </div>

          {(snap.completedAt || snap.nextRunAt) && (
            <div
              className="mt-3 flex flex-wrap items-center gap-1.5"
              data-testid="market-brain-freshness"
            >
              {snap.completedAt && (
                <Chip>
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      fresh ? "bg-emerald-500" : "bg-amber-500",
                    )}
                    aria-hidden="true"
                  />
                  Updated {relativeTime(snap.completedAt, now)}
                  {!fresh && <span className="text-muted-foreground/80">· refresh available</span>}
                </Chip>
              )}
              {snap.nextRunAt && (
                <Chip>
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  Auto-refresh {relativeTime(snap.nextRunAt, now)}
                </Chip>
              )}
            </div>
          )}
        </header>

        {/* ── Market lens ────────────────────────────────────── */}
        {hasResults && !editing && displayLens && (
          <LensBar lens={displayLens} disabled={running} onEdit={() => setEditing(true)} />
        )}
        {(showSetup || editing) && (
          <LensEditor
            mode={showSetup && !editing ? "setup" : "edit"}
            location={location}
            keywords={keywords}
            error={lensError}
            running={running}
            onLocation={setLocation}
            onKeywords={setKeywords}
            onSubmit={runScan}
            onCancel={hasResults ? () => setEditing(false) : undefined}
          />
        )}

        {/* ── Loading / progress ─────────────────────────────── */}
        <AnimatePresence>
          {!snap.hydrated && workspaceId && <ResultsSkeleton key="hydrating" />}
        </AnimatePresence>
        <AnimatePresence mode="wait">
          {running && (
            <ScanProgress
              key="scan-progress"
              phase={phase}
              startedAt={snap.startedAt}
              phaseStartedAt={snap.phaseStartedAt}
              refreshing={refreshing}
            />
          )}
        </AnimatePresence>
        {!running && snap.pending && <PendingNotice onCheck={onPrimary} />}

        <AnimatePresence>
          {notice && !running && (
            <NoticeCard key={notice.message} notice={notice} onAction={onNoticeAction} />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {running && !hasResults && <ResultsSkeleton key="skeleton-full" />}
        </AnimatePresence>

        {/* ── Results (kept, dimmed, while a refresh runs) ───── */}
        {hasResults && (
          <div
            className={cn(
              "transition-[opacity,filter] duration-500",
              refreshing && "pointer-events-none select-none opacity-40 blur-[1.5px] saturate-50",
            )}
            aria-hidden={refreshing || undefined}
          >
            <div className="grid gap-3 @4xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] @4xl:items-start">
              <div className="min-w-0 space-y-3">
                <AnimatePresence mode="wait">
                  {intelligence ? (
                    <Reveal key={`pulse-${intelligence.generatedAt}`}>
                      <PulseSummary
                        intelligence={intelligence}
                        direction={metrics?.direction ?? null}
                        completedAt={snap.completedAt}
                      />
                    </Reveal>
                  ) : analyzingFresh ? (
                    <ResultsSkeleton key="skeleton-summary" variant="summary" />
                  ) : null}
                </AnimatePresence>
                {metrics && (
                  <Reveal index={1}>
                    <KpiStrip metrics={metrics} />
                  </Reveal>
                )}
                {trendData && (
                  <Reveal index={2}>
                    <TrendChart trendData={trendData} />
                  </Reveal>
                )}
              </div>
              <div className="min-w-0">
                <AnimatePresence mode="wait">
                  {intelligence ? (
                    <Reveal key={`insights-${intelligence.generatedAt}`} index={3}>
                      <InsightTabs intelligence={intelligence} trendData={trendData} />
                    </Reveal>
                  ) : analyzingFresh ? (
                    <ResultsSkeleton key="skeleton-details" variant="details" />
                  ) : trendData && !running ? (
                    <Reveal key="extras" index={3}>
                      <TrendExtras trendData={trendData} />
                    </Reveal>
                  ) : null}
                </AnimatePresence>
              </div>
            </div>
          </div>
        )}
      </div>
    </MotionConfig>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[10.5px] font-medium text-foreground/80 backdrop-blur">
      {children}
    </span>
  );
}

function LensBar({
  lens,
  disabled,
  onEdit,
}: {
  lens: MarketLens;
  disabled: boolean;
  onEdit: () => void;
}) {
  return (
    <div
      className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/70 px-3 py-2"
      data-testid="market-brain-lens"
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {lens.location && (
          <span className="inline-flex items-center gap-1 rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[11px] font-semibold text-foreground">
            <MapPin className="h-3 w-3" aria-hidden="true" />
            {lens.location}
          </span>
        )}
        {lens.keywords.map((keyword) => (
          <span
            key={keyword}
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-foreground/80"
          >
            <Search className="h-2.5 w-2.5 shrink-0 opacity-60" aria-hidden="true" />
            <span className="truncate">{keyword}</span>
          </span>
        ))}
      </div>
      <button
        type="button"
        onClick={onEdit}
        disabled={disabled}
        className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-semibold text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-50"
        aria-label="Edit market lens"
      >
        <Pencil className="h-3 w-3" aria-hidden="true" /> Edit
      </button>
    </div>
  );
}

function LensEditor({
  mode,
  location,
  keywords,
  error,
  running,
  onLocation,
  onKeywords,
  onSubmit,
  onCancel,
}: {
  mode: "setup" | "edit";
  location: string;
  keywords: string;
  error: string | null;
  running: boolean;
  onLocation: (value: string) => void;
  onKeywords: (value: string) => void;
  onSubmit: () => void;
  onCancel?: () => void;
}) {
  const keywordCount = parseKeywords(keywords).length;
  return (
    <motion.section
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "rounded-2xl border p-4",
        mode === "setup"
          ? "border-dashed border-border/80 bg-secondary/20"
          : "border-border/70 bg-card",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="hidden h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-500/15 to-sky-500/15 text-emerald-600 @md:grid dark:text-emerald-400">
          <MapPin className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold text-foreground">
            {mode === "setup" ? "Set your market lens" : "Edit market lens"}
          </h3>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
            {mode === "setup"
              ? "Choose where you sell and up to 5 topics worth watching. Results are saved and refresh automatically every day."
              : "Changing the lens starts a new scan. Your current results stay visible until it finishes."}
          </p>
          <form
            className="mt-3 grid gap-2 @xl:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            <label className="min-w-0">
              <span className="mb-1 block text-[10.5px] font-semibold text-muted-foreground">
                Market
              </span>
              <span className="relative block">
                <MapPin
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <input
                  value={location}
                  onChange={(event) => onLocation(event.target.value)}
                  placeholder="United States"
                  aria-label="Market location"
                  className="h-10 w-full rounded-lg border border-border/70 bg-background/70 pl-8 pr-2 text-[12.5px] outline-none transition focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
                />
              </span>
            </label>
            <label className="min-w-0">
              <span className="mb-1 flex items-center justify-between text-[10.5px] font-semibold text-muted-foreground">
                Keywords <span className="font-normal tabular-nums">{keywordCount}/5</span>
              </span>
              <span className="relative block">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <input
                  value={keywords}
                  onChange={(event) => onKeywords(event.target.value)}
                  placeholder="AI marketing, marketing automation"
                  aria-label="Market keywords"
                  className="h-10 w-full rounded-lg border border-border/70 bg-background/70 pl-8 pr-2 text-[12.5px] outline-none transition focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
                />
              </span>
            </label>
            <div className="flex items-end gap-2">
              {onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="inline-flex h-10 flex-1 items-center justify-center rounded-lg px-3 text-[12px] font-semibold text-muted-foreground transition hover:bg-secondary hover:text-foreground @xl:flex-none"
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                disabled={running}
                className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-foreground px-4 text-[12px] font-semibold text-background transition hover:opacity-90 disabled:opacity-60 @xl:flex-none"
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Scan
              </button>
            </div>
          </form>
          {error && (
            <p
              className="mt-2 text-[11.5px] font-medium text-amber-700 dark:text-amber-400"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>
      </div>
    </motion.section>
  );
}

function NoticeCard({
  notice,
  onAction,
}: {
  notice: MarketNotice;
  onAction: (notice: MarketNotice) => void;
}) {
  const isError = notice.tone === "error";
  const testId = isError
    ? "market-brain-error"
    : notice.action === "analyze"
      ? "market-brain-notice"
      : "market-brain-no-data";
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className={cn(
        "flex items-start gap-2.5 rounded-xl border p-3 text-[12px] leading-relaxed",
        isError
          ? "border-amber-500/30 bg-amber-500/[0.07] text-amber-800 dark:text-amber-300"
          : "border-border/70 bg-secondary/30 text-muted-foreground",
      )}
      role={isError ? "alert" : "status"}
      data-testid={testId}
    >
      {isError ? (
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">{notice.message}</div>
      {notice.action && (
        <button
          type="button"
          onClick={() => onAction(notice)}
          className={cn(
            "group inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11.5px] font-semibold transition",
            isError ? "hover:bg-amber-500/15" : "bg-foreground text-background hover:opacity-90",
          )}
        >
          {notice.action === "analyze" && !isError ? (
            <>
              <Wand2 className="h-3 w-3" aria-hidden="true" /> Analyze now
            </>
          ) : (
            <>
              <RefreshCw
                className="h-3 w-3 transition-transform duration-500 group-hover:rotate-180"
                aria-hidden="true"
              />
              {notice.action === "analyze" ? "Retry analysis" : "Retry"}
            </>
          )}
        </button>
      )}
    </motion.div>
  );
}
