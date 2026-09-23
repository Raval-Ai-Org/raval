"use client";

import { motion } from "framer-motion";
import { CheckCircle, Globe, RefreshCw, Spinner, Stop } from "@/components/icons";
import { StarAgent as BrandStar } from "@/components/StarAgent";
import { cn } from "@/lib/utils";
import type { GeoScanMode, GeoScanView } from "@/lib/geo/contracts";
import { displayUrl, EngineMark, ghostBtn, primaryBtn } from "./geo-ui";

/**
 * The scan box: one rounded field in the manner of a Gemini prompt — the
 * site, the depth and the button live on one line.
 */
export function ScanBar({
  url,
  onUrlChange,
  mode,
  onModeChange,
  maxPages,
  probesAvailable,
  probes,
  onProbesChange,
  busy,
  starting,
  canRescan,
  onRun,
  hint,
}: {
  url: string;
  onUrlChange: (v: string) => void;
  mode: GeoScanMode;
  onModeChange: (m: GeoScanMode) => void;
  maxPages: number | null;
  probesAvailable: boolean;
  probes: boolean;
  onProbesChange: (v: boolean) => void;
  /** A scan is being started or is running. */
  busy: boolean;
  /** The start request itself is in flight. */
  starting: boolean;
  canRescan: boolean;
  onRun: () => void;
  hint: React.ReactNode;
}) {
  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onRun();
        }}
        data-no-rhythm
        className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-[28px] border border-border/60 bg-surface-3 p-1.5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-colors focus-within:border-primary/50 dark:border-white/[0.08] dark:bg-white/[0.04] sm:flex-nowrap sm:rounded-full"
      >
        <label className="relative flex h-10 min-w-0 flex-1 basis-[200px] items-center">
          <span className="sr-only">Website to scan</span>
          <Globe
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            strokeWidth={2}
          />
          <input
            type="text"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            placeholder="yourwebsite.com"
            value={url}
            disabled={busy}
            onChange={(e) => onUrlChange(e.target.value)}
            className="h-10 w-full rounded-full bg-transparent pl-10 pr-3 text-[14px] text-foreground outline-none placeholder:text-muted-foreground/60 disabled:opacity-60"
          />
        </label>
        <div
          role="group"
          aria-label="Scan depth"
          className="flex h-10 shrink-0 items-center rounded-full bg-foreground/[0.05] p-1 text-[12.5px]"
        >
          {(
            [
              {
                value: "full",
                label: "Full site",
                title: maxPages ? `Up to ${maxPages} pages` : undefined,
              },
              { value: "quick", label: "Homepage", title: "Just the homepage — about 10 seconds" },
            ] as const
          ).map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={mode === o.value}
              title={o.title}
              onClick={() => onModeChange(o.value)}
              className={cn(
                "h-8 whitespace-nowrap rounded-full px-3 font-medium transition-colors",
                mode === o.value
                  ? "bg-background text-foreground shadow-sm dark:bg-white/[0.12]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        <button
          type="submit"
          disabled={!url.trim() || busy}
          className={cn(primaryBtn, "h-10 shrink-0 px-5 text-[13.5px]")}
        >
          {busy ? (
            <>
              <Spinner className="h-4 w-4 animate-spin" /> {starting ? "Starting" : "Scanning"}
            </>
          ) : canRescan ? (
            <>
              <RefreshCw className="h-4 w-4" /> Scan again
            </>
          ) : (
            "Scan"
          )}
        </button>
      </form>
      {(hint || (probesAvailable && mode === "full")) && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 text-[12px] text-muted-foreground">
          <div className="min-w-0">{hint}</div>
          {probesAvailable && mode === "full" && (
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={probes}
                onChange={(e) => onProbesChange(e.target.checked)}
                className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
              />
              Ask AI engines about my brand
              <span className="text-muted-foreground/70">· uses credits</span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}

const STAGES = [
  { id: "discovering", label: "Reading site files" },
  { id: "crawling", label: "Reading pages" },
  { id: "analyzing", label: "Scoring" },
  { id: "probing", label: "Asking AI engines" },
] as const;

function progressPct(scan: GeoScanView): number {
  const p = scan.progress;
  switch (scan.stage) {
    case "queued":
      return 3;
    case "discovering":
      return 8;
    case "crawling": {
      const denom = Math.max(1, Math.min(scan.maxPages, p.discovered || 1));
      return 10 + Math.round((70 * Math.min(denom, p.fetched + p.failed + p.skipped)) / denom);
    }
    case "analyzing":
      return 86;
    case "probing":
      return 93;
    default:
      return 100;
  }
}

export function ScanProgress({ scan, onCancel }: { scan: GeoScanView; onCancel: () => void }) {
  const stages = STAGES.filter((s) => s.id !== "probing" || scan.probesRequested);
  const currentIndex = Math.max(
    0,
    stages.findIndex((s) => s.id === scan.stage),
  );
  const pct = progressPct(scan);
  const { fetched, discovered } = scan.progress;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      aria-live="polite"
      className="rounded-[24px] border border-border/50 bg-surface-3 p-5 dark:border-white/[0.06] dark:bg-white/[0.035] sm:p-6"
    >
      <div className="flex items-center gap-4">
        <BrandStar mood="scanning" size={52} animate />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-foreground">
            {scan.cancelRequested ? "Stopping" : "Scanning"} {displayUrl(scan.url)}
          </div>
          <div className="mt-0.5 text-[12.5px] text-muted-foreground">
            {scan.mode === "quick"
              ? "About 10 seconds"
              : discovered > 0
                ? `${fetched} of ${Math.min(scan.maxPages, Math.max(discovered, fetched))} pages · you can close this`
                : "You can close this — it keeps running"}
          </div>
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={scan.cancelRequested}
          className={cn(ghostBtn, "h-9 shrink-0 px-3.5 text-[12.5px]")}
        >
          <Stop className="h-3.5 w-3.5" /> Stop
        </button>
      </div>
      <div
        className="mt-5 h-1.5 overflow-hidden rounded-full bg-foreground/[0.08]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <motion.div
          className="h-full rounded-full bg-primary"
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6 }}
        />
      </div>
      <ol className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-5">
        {stages.map((stage, i) => {
          const done = i < currentIndex || scan.stage === "done";
          const now = i === currentIndex && !done;
          return (
            <li key={stage.id} className="flex items-center gap-2 text-[12.5px]">
              {done ? (
                <CheckCircle className="h-4 w-4 text-success" strokeWidth={2.2} />
              ) : now ? (
                <Spinner className="h-4 w-4 animate-spin text-primary" />
              ) : (
                <span className="grid h-4 w-4 place-items-center">
                  <span className="h-1.5 w-1.5 rounded-full bg-border" />
                </span>
              )}
              <span className={done || now ? "text-foreground/90" : "text-muted-foreground/70"}>
                {stage.label}
              </span>
            </li>
          );
        })}
      </ol>
    </motion.div>
  );
}

const ENGINES = [
  { id: "chatgpt", name: "ChatGPT" },
  { id: "claude", name: "Claude" },
  { id: "gemini", name: "Gemini" },
  { id: "perplexity", name: "Perplexity" },
];

/** First run: a centred question, the engines as logos, and the scan box. */
export function ScanIntro({ hasUrl, children }: { hasUrl: boolean; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center text-center"
    >
      <BrandStar mood={hasUrl ? "happy" : "waving"} size={72} animate />
      <h3 className="mt-5 text-[26px] font-semibold leading-tight tracking-tight text-foreground sm:text-[30px]">
        How does AI see your site?
      </h3>
      <p className="mt-2 text-[14px] text-muted-foreground">
        One scan. Clear fixes. Nothing on your site changes.
      </p>
      <ul className="mt-6 flex flex-wrap items-center justify-center gap-2" aria-label="AI engines">
        {ENGINES.map((e) => (
          <li
            key={e.id}
            className="flex items-center gap-2 rounded-full bg-foreground/[0.05] py-1.5 pl-1.5 pr-3.5 text-[12.5px] font-medium text-foreground/85"
          >
            <EngineMark id={e.id} name={e.name} size={24} />
            {e.name}
          </li>
        ))}
      </ul>
      <div className="mt-8 w-full text-left">{children}</div>
    </motion.div>
  );
}
