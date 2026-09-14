"use client";

import { motion } from "framer-motion";
import {
  Bot,
  Brain,
  CheckCircle,
  FileCode2,
  Globe,
  RefreshCw,
  ShieldCheck,
  Spinner,
  Stop,
} from "@/components/icons";
import { StarAgent as BrandStar } from "@/components/StarAgent";
import { cn } from "@/lib/utils";
import type { GeoScanMode, GeoScanView } from "@/lib/geo/contracts";
import { displayUrl, ghostBtn, primaryBtn, Segmented } from "./geo-ui";

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
        className="flex flex-col gap-2 lg:flex-row lg:items-center"
      >
        <label className="relative flex min-w-0 flex-1 items-center">
          <span className="sr-only">Website to scan</span>
          <Globe
            className="pointer-events-none absolute left-3.5 h-4 w-4 text-muted-foreground"
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
            className="h-11 w-full rounded-full border border-border/70 bg-background/60 pl-10 pr-4 text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/25 disabled:opacity-60"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Scan depth"
            value={mode}
            onChange={onModeChange}
            className="h-11 items-center"
            options={[
              { value: "full", label: `Full site${maxPages ? ` · ${maxPages} pages` : ""}` },
              { value: "quick", label: "Homepage" },
            ]}
          />
          <button
            type="submit"
            disabled={!url.trim() || busy}
            className={cn(primaryBtn, "h-11 flex-1 px-5 text-[13.5px] sm:flex-none")}
          >
            {busy ? (
              <>
                <Spinner className="h-4 w-4 animate-spin" /> {starting ? "Starting…" : "Scanning…"}
              </>
            ) : canRescan ? (
              <>
                <RefreshCw className="h-4 w-4" /> Re-scan
              </>
            ) : (
              "Run scan"
            )}
          </button>
        </div>
      </form>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-2 text-[12px] text-muted-foreground">
        <div className="min-w-0">{hint}</div>
        {probesAvailable && mode === "full" && (
          <label className="inline-flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={probes}
              onChange={(e) => onProbesChange(e.target.checked)}
              className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
            />
            Ask AI engines about your brand{" "}
            <span className="text-muted-foreground/70">(uses AI credits)</span>
          </label>
        )}
      </div>
    </div>
  );
}

const STAGES = [
  { id: "discovering", label: "Reading robots.txt, sitemap and llms.txt" },
  { id: "crawling", label: "Crawling pages" },
  { id: "analyzing", label: "Scoring every check and writing findings" },
  { id: "probing", label: "Asking AI engines about your brand" },
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
  const { fetched, failed, skipped, discovered } = scan.progress;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      aria-live="polite"
      className="rounded-2xl border border-border/60 bg-card/50 p-5 sm:p-6"
    >
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        <BrandStar mood="scanning" size={72} animate />
        <div className="w-full min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold text-foreground">
                {scan.mode === "quick" ? "Checking" : "Scanning"} {displayUrl(scan.url)}
              </div>
              <div className="mt-0.5 text-[12.5px] text-muted-foreground">
                {scan.cancelRequested
                  ? "Stopping after the current batch of pages…"
                  : scan.mode === "quick"
                    ? "Reading your homepage the way AI crawlers do — usually 5 to 15 seconds."
                    : `Up to ${scan.maxPages} pages. You can close this window — the scan keeps running.`}
              </div>
            </div>
            <button
              type="button"
              onClick={onCancel}
              disabled={scan.cancelRequested}
              className={cn(ghostBtn, "px-3 py-1.5 text-[12px]")}
            >
              <Stop className="h-3.5 w-3.5" /> Cancel
            </button>
          </div>
          <div
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-border/50"
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
          <ol className="mt-3.5 space-y-2">
            {stages.map((stage, i) => (
              <li key={stage.id} className="flex items-center gap-2.5 text-[13px]">
                {i < currentIndex || scan.stage === "done" ? (
                  <CheckCircle className="h-4 w-4 text-success" strokeWidth={2.2} />
                ) : i === currentIndex ? (
                  <Spinner className="h-4 w-4 animate-spin text-primary" />
                ) : (
                  <span className="grid h-4 w-4 place-items-center">
                    <span className="h-1.5 w-1.5 rounded-full bg-border" />
                  </span>
                )}
                <span
                  className={i <= currentIndex ? "text-foreground/90" : "text-muted-foreground/70"}
                >
                  {stage.label}
                  {stage.id === "crawling" && (discovered > 0 || fetched > 0) && (
                    <span className="ml-1.5 tabular-nums text-muted-foreground">
                      · {fetched} read{failed ? ` · ${failed} failed` : ""}
                      {skipped ? ` · ${skipped} skipped` : ""} of{" "}
                      {Math.min(scan.maxPages, Math.max(discovered, fetched))}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </motion.div>
  );
}

const FEATURES = [
  {
    icon: Bot,
    title: "AI crawler access",
    body: "Whether GPTBot, ClaudeBot, PerplexityBot and Google-Extended can read you.",
  },
  {
    icon: FileCode2,
    title: "Schema & entities",
    body: "The structured data engines use to understand your brand and quote it.",
  },
  {
    icon: Brain,
    title: "Answer-ready content",
    body: "Questions, direct answers and topical focus the way LLMs like to cite.",
  },
  {
    icon: ShieldCheck,
    title: "Authority & trust",
    body: "Authorship, sourcing, contact and identity signals engines weigh.",
  },
];

export function ScanIntro({ hasUrl, maxPages }: { hasUrl: boolean; maxPages: number | null }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/50 p-5 sm:p-6"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl"
      />
      <div className="relative flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
        <BrandStar mood={hasUrl ? "happy" : "waving"} size={64} animate />
        <div className="min-w-0">
          <p className="text-[16px] font-semibold text-foreground">
            See how ChatGPT, Claude, Gemini and Perplexity read your site
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {hasUrl
              ? `Run a full scan of up to ${maxPages ?? 25} pages, or a quick homepage check. It only reads public pages — nothing on your site changes.`
              : "Enter your website above to run your first AI Visibility scan."}
          </p>
        </div>
      </div>
      <div className="relative mt-5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-xl border border-border/60 bg-background/50 p-3.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/12 text-primary">
              <Icon className="h-4 w-4" strokeWidth={2.1} />
            </span>
            <div className="mt-2.5 text-[13.5px] font-semibold text-foreground">{title}</div>
            <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{body}</div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
