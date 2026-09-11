"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BrainCircuit, Check, Clock, RefreshCw, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export type ScanPhase = "starting" | "collecting" | "analyzing";

const STEPS: { phase: ScanPhase; label: string }[] = [
  { phase: "starting", label: "Started" },
  { phase: "collecting", label: "Google Trends" },
  { phase: "analyzing", label: "Analysis" },
];

const PHASE_ORDER: Record<ScanPhase, number> = { starting: 0, collecting: 1, analyzing: 2 };

const COPY: Record<ScanPhase, { title: string; footnote: string; activity: string[] }> = {
  starting: {
    title: "Starting your market scan…",
    footnote: "Setting up the scan. This takes a moment.",
    activity: ["Preparing the scan for your keywords and market…"],
  },
  collecting: {
    title: "Market data is still being collected",
    footnote:
      "We'll update this automatically. Collection usually takes 1–3 minutes — you can keep working.",
    activity: [
      "Requesting Google Trends data for your keywords…",
      "Reading search interest over the last 12 months…",
      "Mapping regional demand across your market…",
      "Checking related searches and rising topics…",
    ],
  },
  analyzing: {
    title: "Ravi is analyzing your market…",
    footnote: "Trend data collected. Analysis usually takes under a minute.",
    activity: [
      "Separating measured evidence from interpretation…",
      "Connecting the signals to your business context…",
      "Ranking opportunities by priority…",
      "Drafting your next marketing moves…",
    ],
  },
};

// Estimated progress per phase, easing toward each phase's ceiling so the bar
// keeps moving without ever claiming completion before the result arrives.
// Collection usually takes 1-3 min; analysis ~35-40s.
function estimateProgress(phase: ScanPhase, phaseElapsedMs: number): number {
  const ease = (tauMs: number) => 1 - Math.exp(-phaseElapsedMs / tauMs);
  if (phase === "starting") return 3 + 7 * ease(1_500);
  if (phase === "collecting") return 10 + 52 * ease(50_000);
  return 64 + 32 * ease(22_000);
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Re-renders every `intervalMs` while mounted so time-based UI keeps moving. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function ScanProgress({
  phase,
  startedAt,
  phaseStartedAt,
  refreshing,
}: {
  phase: ScanPhase;
  startedAt: number;
  phaseStartedAt: number;
  /** A previous result stays on screen underneath while this scan runs. */
  refreshing: boolean;
}) {
  const now = useNow(500);
  const progress = estimateProgress(phase, now - phaseStartedAt);
  const copy = COPY[phase];
  const activityIndex = Math.floor((now - phaseStartedAt) / 3_800) % copy.activity.length;
  const elapsed = formatElapsed(now - startedAt);

  return (
    <motion.section
      layout
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.2 } }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
      className="relative overflow-hidden rounded-2xl border border-emerald-500/25 bg-card p-4 shadow-[0_12px_32px_-18px_rgb(16_185_129/0.35)]"
      role="status"
      aria-live="polite"
      data-testid="market-brain-pending"
    >
      {/* Soft breathing glow behind the content. */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_120%_at_0%_0%,rgb(16_185_129/0.10),transparent_60%),radial-gradient(50%_100%_at_100%_100%,rgb(14_165_233/0.08),transparent_60%)]"
        animate={{ opacity: [0.55, 1, 0.55] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="relative flex items-start gap-3.5">
        <PulseOrb phase={phase} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div className="relative min-w-0 flex-1">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={phase}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25 }}
                  className="text-[13px] font-semibold leading-5 text-foreground"
                >
                  {refreshing && phase === "starting" ? "Refreshing market signals…" : copy.title}
                </motion.div>
              </AnimatePresence>
            </div>
            <span
              className="shrink-0 rounded-full bg-secondary/80 px-2 py-0.5 font-mono text-[10.5px] leading-4 tabular-nums text-muted-foreground"
              title="Elapsed time"
            >
              {elapsed}
            </span>
          </div>

          <div className="relative mt-1 h-4 overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`${phase}-${activityIndex}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="absolute inset-x-0 truncate text-[11.5px] leading-4 text-muted-foreground"
              >
                {copy.activity[activityIndex]}
              </motion.div>
            </AnimatePresence>
          </div>

          <ProgressBar value={progress} />
          <Stepper phase={phase} />

          <div className="mt-3 text-[10.5px] leading-relaxed text-muted-foreground/80">
            {copy.footnote}
          </div>
        </div>
      </div>
    </motion.section>
  );
}

function Stepper({ phase }: { phase: ScanPhase }) {
  const current = PHASE_ORDER[phase];
  return (
    <ol className="mt-3 flex items-center" aria-label="Scan steps">
      {STEPS.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <Fragment key={step.phase}>
            {index > 0 && (
              <li aria-hidden="true" className="relative mx-2 h-px min-w-3 flex-1 bg-border">
                <motion.span
                  className="absolute inset-0 origin-left bg-emerald-500"
                  initial={false}
                  animate={{ scaleX: index <= current ? 1 : 0 }}
                  transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                />
              </li>
            )}
            <li
              className={cn(
                "flex shrink-0 items-center gap-1.5 text-[10.5px] font-medium leading-4 transition-colors duration-500",
                done && "text-emerald-600 dark:text-emerald-400",
                active && "text-foreground",
                !done && !active && "text-muted-foreground/60",
              )}
              aria-current={active ? "step" : undefined}
            >
              <span className="relative grid h-4 w-4 place-items-center">
                {done ? (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 500, damping: 22 }}
                    className="grid h-4 w-4 place-items-center rounded-full bg-emerald-500 text-white"
                  >
                    <Check className="h-2.5 w-2.5" strokeWidth={3} />
                  </motion.span>
                ) : active ? (
                  <>
                    <motion.span
                      className="absolute inset-0 rounded-full bg-emerald-500/35"
                      animate={{ scale: [1, 2], opacity: [0.7, 0] }}
                      transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
                    />
                    <span className="relative h-2 w-2 rounded-full bg-emerald-500" />
                  </>
                ) : (
                  <span className="h-2 w-2 rounded-full border border-current" />
                )}
              </span>
              <span className="whitespace-nowrap">{step.label}</span>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

function PulseOrb({ phase }: { phase: ScanPhase }) {
  const Icon = phase === "analyzing" ? BrainCircuit : Search;
  return (
    <span className="relative grid h-11 w-11 shrink-0 place-items-center" aria-hidden="true">
      {[0, 0.6, 1.2].map((delay) => (
        <motion.span
          key={delay}
          className="absolute inset-0 rounded-full border border-emerald-500/40"
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: [0.6, 1.35], opacity: [0.7, 0] }}
          transition={{ duration: 1.8, delay, repeat: Infinity, ease: "easeOut" }}
        />
      ))}
      <motion.span
        className="relative grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-emerald-500/20 to-sky-500/20 text-emerald-500 ring-1 ring-emerald-500/30"
        animate={{ scale: [1, 1.06, 1] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={phase === "analyzing" ? "brain" : "search"}
            initial={{ opacity: 0, rotate: -30, scale: 0.6 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, rotate: 30, scale: 0.6 }}
            transition={{ duration: 0.25 }}
          >
            <Icon className="h-4 w-4" />
          </motion.span>
        </AnimatePresence>
      </motion.span>
    </span>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div
      className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-secondary"
      role="progressbar"
      aria-label="Scan progress (estimated)"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
    >
      {/* scaleX, not width: stays on the compositor (see styles.css guidance). */}
      <motion.div
        className="absolute inset-0 origin-left rounded-full bg-gradient-to-r from-emerald-500 via-emerald-400 to-sky-400"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: value / 100 }}
        transition={{ type: "spring", stiffness: 40, damping: 18 }}
      />
      <motion.div
        aria-hidden="true"
        className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/50 to-transparent dark:via-white/25"
        animate={{ x: ["-100%", "300%"] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

/**
 * Placeholder for the result layout while a scan runs: the whole layout during
 * collection, or just the summary / detail slots around the already-visible
 * trend chart while Ravi analyzes it.
 */
export function ResultsSkeleton({
  variant = "full",
}: {
  variant?: "full" | "summary" | "details";
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ duration: 0.3, delay: 0.15 }}
      className="space-y-3"
      aria-hidden="true"
      data-testid="market-brain-skeleton"
    >
      {variant !== "details" && (
        <SkeletonCard className="rounded-2xl">
          <Bone className="h-2.5 w-24" />
          <Bone className="mt-3 h-3 w-[92%]" />
          <Bone className="mt-2 h-3 w-[70%]" />
        </SkeletonCard>
      )}
      {variant === "full" && (
        <SkeletonCard>
          <div className="flex items-center justify-between">
            <Bone className="h-2.5 w-28" />
            <Bone className="h-4 w-16 rounded-full" />
          </div>
          <svg
            viewBox="0 0 300 80"
            preserveAspectRatio="none"
            className="mt-3 h-24 w-full text-foreground/[0.07]"
          >
            <path
              d="M0 62 C 30 58, 45 40, 75 44 S 120 60, 150 38 S 210 18, 240 30 S 285 12, 300 16 L 300 80 L 0 80 Z"
              fill="currentColor"
            />
          </svg>
        </SkeletonCard>
      )}
      {variant !== "summary" && (
        <div className="grid gap-2 sm:grid-cols-2">
          {[0, 1].map((key) => (
            <SkeletonCard key={key}>
              <Bone className="h-3 w-[60%]" />
              <Bone className="mt-3 h-2.5 w-full" />
              <Bone className="mt-2 h-2.5 w-[80%]" />
            </SkeletonCard>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function SkeletonCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border/50 bg-card/60 p-4",
        className,
      )}
    >
      {children}
      <motion.div
        className="pointer-events-none absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-foreground/[0.05] to-transparent"
        animate={{ x: ["-100%", "220%"] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

function Bone({ className }: { className?: string }) {
  return <div className={cn("rounded-md bg-foreground/[0.07]", className)} />;
}

/** A scan whose provider task is still running after the client stopped polling. */
export function PendingNotice({ onCheck }: { onCheck: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-3 rounded-xl border border-border/70 bg-card p-4"
      role="status"
      aria-live="polite"
      data-testid="market-brain-pending"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-500/10 text-emerald-500">
        <Clock className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-semibold text-foreground">
          Google Trends is still processing this scan.
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          It's taking longer than usual. Check again in a minute — no new scan will be started.
        </div>
      </div>
      <button
        type="button"
        onClick={onCheck}
        className="group inline-flex shrink-0 items-center gap-1 text-[11.5px] font-semibold text-foreground hover:underline"
      >
        <RefreshCw className="h-3 w-3 transition-transform duration-500 group-hover:rotate-180" />{" "}
        Check status
      </button>
    </motion.div>
  );
}
