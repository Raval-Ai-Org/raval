"use client";
// Shared pieces for everything that shows an audience score: the Audience
// page, the Studio editor, the calendar and the video concept step. They draw
// what they are given and hold no data.
import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { AlertTriangle, Check, Trophy, X } from "@/components/icons";
import { dsGhostBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { useReducedMotionSafe } from "@/hooks/use-reduced-motion-safe";
import {
  DIMENSION_LABEL,
  DIMENSIONS,
  isActiveRun,
  type Dimensions,
  type PredictionView,
  type PulseResult,
  type RunView,
  type Stance,
  type TournamentOutput,
  type TraitSource,
} from "@/lib/audience/contracts";
import { CONFIDENCE_LABEL, toneFor, verdictFor, type ScoreTone } from "@/lib/audience/score";
import { SOURCE_LABEL } from "@/lib/audience/twins";
import { duration, ease } from "@/lib/motion";

const medium = { duration: duration.medium, ease: ease.standard };
const base = { duration: duration.base, ease: ease.standard };

const TONE: Record<ScoreTone, { text: string; bg: string; soft: string; stroke: string }> = {
  success: {
    text: "text-success",
    bg: "bg-success",
    soft: "bg-success/12",
    stroke: "stroke-success",
  },
  primary: {
    text: "text-primary",
    bg: "bg-primary",
    soft: "bg-primary/12",
    stroke: "stroke-primary",
  },
  warning: {
    text: "text-warning",
    bg: "bg-warning",
    soft: "bg-warning/12",
    stroke: "stroke-warning",
  },
  destructive: {
    text: "text-destructive",
    bg: "bg-destructive",
    soft: "bg-destructive/12",
    stroke: "stroke-destructive",
  },
};

/** A number that counts up once when it appears. Jumps straight there under reduced motion. */
function useCountUp(target: number): number {
  const reduce = useReducedMotionSafe();
  const [value, setValue] = useState(reduce ? target : 0);
  useEffect(() => {
    if (reduce) {
      setValue(target);
      return;
    }
    let frame = 0;
    const started = performance.now();
    const length = duration.xslow * 1000 * 1.5;
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / length);
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, reduce]);
  return value;
}

/** The small score shown in lists and beside a version. */
export function ScoreChip({
  overall,
  className,
  title,
}: {
  overall: number;
  className?: string;
  title?: string;
}) {
  const tone = TONE[toneFor(overall)];
  return (
    <span
      title={title ?? `Mellox Score ${overall}: how your audience is likely to react`}
      aria-label={`Mellox Score ${overall} out of 100`}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2 text-[11.5px] font-semibold tabular-nums",
        tone.soft,
        tone.text,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", tone.bg)} />
      {overall}
    </span>
  );
}

/** The big score: a ring that fills and a number that counts up. */
export function ScoreDial({ overall, size = 104 }: { overall: number; size?: number }) {
  const shown = useCountUp(overall);
  const tone = TONE[toneFor(overall)];
  const r = 44;
  const circumference = 2 * Math.PI * r;
  return (
    <div
      className="relative shrink-0"
      style={{ height: size, width: size }}
      role="img"
      aria-label={`Mellox Score ${overall} out of 100`}
    >
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth="8"
          className="stroke-[var(--ds-well-bg)]"
        />
        <motion.circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          className={tone.stroke}
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - overall / 100) }}
          transition={{ duration: duration.xslow * 1.5, ease: ease.emphasized }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className="text-[30px] font-semibold leading-none tabular-nums">{shown}</span>
      </div>
    </div>
  );
}

export function DimensionBars({ dimensions }: { dimensions: Dimensions }) {
  return (
    <ul className="space-y-2">
      {DIMENSIONS.map((key, i) => {
        const value = dimensions[key] ?? 0;
        const tone = TONE[toneFor(value)];
        return (
          <li key={key} className="flex items-center gap-3 text-[12.5px]">
            <span className="w-[118px] shrink-0 text-muted-foreground">{DIMENSION_LABEL[key]}</span>
            <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--ds-well-bg)]">
              <motion.span
                className={cn("block h-full rounded-full", tone.bg)}
                initial={{ width: 0 }}
                animate={{ width: `${value}%` }}
                transition={{ duration: duration.xslow, delay: i * 0.05, ease: ease.emphasized }}
              />
            </span>
            <span className="w-7 shrink-0 text-right font-medium tabular-nums">{value}</span>
          </li>
        );
      })}
    </ul>
  );
}

const SOURCE_TONE: Record<TraitSource, string> = {
  user: "bg-primary/12 text-foreground",
  measured: "bg-success/12 text-success",
  brand_dna: "bg-[var(--ds-well-bg)] text-foreground/80",
  website: "bg-[var(--ds-well-bg)] text-foreground/80",
  market: "bg-[var(--ds-well-bg)] text-foreground/80",
  competitor: "bg-[var(--ds-well-bg)] text-foreground/80",
  assumed: "bg-warning/12 text-warning",
};

/** Where a statement about the audience came from. */
export function SourceTag({ source }: { source: TraitSource }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[10.5px] font-medium",
        SOURCE_TONE[source],
      )}
    >
      {SOURCE_LABEL[source]}
    </span>
  );
}

const STANCE: Record<Stance, { label: string; tone: ScoreTone }> = {
  love: { label: "Loves it", tone: "success" },
  like: { label: "Likes it", tone: "primary" },
  neutral: { label: "Unsure", tone: "warning" },
  skip: { label: "Scrolls past", tone: "warning" },
  dislike: { label: "Put off", tone: "destructive" },
};

function SentimentBar({ sentiment }: { sentiment: PulseResult["sentiment"] }) {
  const parts = [
    { key: "positive", label: "Positive", value: sentiment.positive, cls: "bg-success" },
    { key: "neutral", label: "Unsure", value: sentiment.neutral, cls: "bg-warning" },
    { key: "negative", label: "Negative", value: sentiment.negative, cls: "bg-destructive" },
  ];
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-[var(--ds-well-bg)]">
        {parts.map((p) => (
          <motion.span
            key={p.key}
            className={p.cls}
            initial={{ width: 0 }}
            animate={{ width: `${p.value}%` }}
            transition={{ duration: duration.xslow, ease: ease.emphasized }}
          />
        ))}
      </div>
      <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-muted-foreground">
        {parts.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1">
            <span className={cn("h-1.5 w-1.5 rounded-full", p.cls)} />
            {p.label} {p.value}%
          </span>
        ))}
      </p>
    </div>
  );
}

/** What the simulated panel said. Always labelled as simulated. */
export function Reactions({ pulse, limit = 6 }: { pulse: PulseResult; limit?: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? pulse.reactions : pulse.reactions.slice(0, limit);
  return (
    <div className="space-y-3">
      <SentimentBar sentiment={pulse.sentiment} />
      {pulse.segments.length > 1 && (
        <ul className="flex flex-wrap gap-1.5">
          {pulse.segments.map((segment) => (
            <li
              key={segment.twinId}
              title={segment.note}
              className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[var(--ds-well-bg)] pl-2.5 pr-1 text-[12px]"
            >
              {segment.name}
              <ScoreChip
                overall={segment.score}
                className="h-5"
                title={segment.note || undefined}
              />
            </li>
          ))}
        </ul>
      )}
      <ul className="space-y-1.5">
        {shown.map((reaction, i) => {
          const stance = STANCE[reaction.stance];
          return (
            <motion.li
              key={`${reaction.twinId}-${i}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...medium, delay: Math.min(i, 8) * 0.06 }}
              className="rounded-[var(--ds-radius-control)] bg-[var(--ds-well-bg)] px-3 py-2"
            >
              <p className="text-[13px] leading-snug">“{reaction.quote}”</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted-foreground">
                <span className={cn("font-medium", TONE[stance.tone].text)}>{stance.label}</span>
                <span className="truncate">
                  {reaction.who} · {reaction.twinName}
                </span>
              </p>
            </motion.li>
          );
        })}
      </ul>
      <p className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
        <span>{pulse.people} simulated people, not real customers.</span>
        {pulse.reactions.length > limit && (
          <button
            type="button"
            onClick={() => setAll((v) => !v)}
            className="font-medium hover:text-foreground"
          >
            {all ? "Show fewer" : `Show all ${pulse.reactions.length}`}
          </button>
        )}
      </p>
    </div>
  );
}

function Lines({ title, items, icon }: { title: string; items: string[]; icon: ReactNode }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="ds-label mb-1.5">{title}</p>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-[13px] leading-snug">
            <span className="mt-0.5 shrink-0">{icon}</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One prediction, in full: the number, how sure, why, and what to change. */
export function PredictionDetail({
  prediction,
  compact,
}: {
  prediction: PredictionView;
  compact?: boolean;
}) {
  const tone = TONE[toneFor(prediction.overall)];
  const warnings = prediction.notes.filter((n) => n.level === "warn").map((n) => n.text);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <ScoreDial overall={prediction.overall} size={compact ? 84 : 104} />
        <div className="min-w-0">
          <p className={cn("text-[17px] font-semibold leading-tight", tone.text)}>
            {verdictFor(prediction.overall)}
          </p>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {CONFIDENCE_LABEL[prediction.confidence]}
            {prediction.measuredPosts > 0
              ? ` · adjusted using ${prediction.measuredPosts} of your posts`
              : prediction.depth === "pulse"
                ? " · from a simulated panel"
                : " · a quick read"}
          </p>
          {prediction.why && <p className="mt-2 text-[13px] leading-snug">{prediction.why}</p>}
        </div>
      </div>
      <DimensionBars dimensions={prediction.dimensions} />
      <Lines
        title="What to change"
        items={[...prediction.fixes, ...warnings].slice(0, 5)}
        icon={<AlertTriangle className="h-3.5 w-3.5 text-warning" />}
      />
      {prediction.pulse && (
        <>
          <Lines
            title="What works"
            items={prediction.pulse.strengths}
            icon={<Check className="h-3.5 w-3.5 text-success" />}
          />
          <Lines
            title="What holds people back"
            items={prediction.pulse.objections}
            icon={<X className="h-3.5 w-3.5 text-destructive" />}
          />
          <div>
            <p className="ds-label mb-2">Reactions</p>
            <Reactions pulse={prediction.pulse} limit={compact ? 4 : 6} />
          </div>
        </>
      )}
    </div>
  );
}

const STAGE_LABEL: Record<string, string> = {
  queued: "Starting…",
  reading: "Reading what we know about your audience…",
  asking: "Asking your audience…",
  summarizing: "Putting it together…",
  writing: "Writing other versions…",
  judging: "Your audience is comparing them…",
};

/** A run in progress: real steps counted, the latest thing that happened, and a way to stop. */
export function RunProgress({ run, onCancel }: { run: RunView; onCancel?: () => void }) {
  const { done, total } = run.progress;
  const share = total > 0 ? Math.min(1, done / total) : 0;
  const last = run.events[run.events.length - 1];
  return (
    <div className="space-y-2.5" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[13px] font-medium">
          <span className="relative flex h-2 w-2">
            <span className="audience-pulse absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60 motion-reduce:hidden" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
          {STAGE_LABEL[run.stage] ?? "Working…"}
        </p>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-[12px] font-medium text-muted-foreground hover:text-foreground"
          >
            Stop
          </button>
        )}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--ds-well-bg)]">
        <motion.div
          className="h-full rounded-full bg-primary"
          animate={{ width: `${Math.max(6, share * 100)}%` }}
          transition={{ duration: duration.slow, ease: ease.standard }}
        />
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={last?.at ?? "none"}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={base}
          className="min-h-[1.2em] text-[12px] text-muted-foreground"
        >
          {last?.summary ?? (total > 0 ? `${done} of ${total} steps` : "")}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

/** Versions ranked by the audience. Rows slide into their place. */
export function Ranking({
  tournament,
  onUse,
  useLabel = "Use this version",
  busy,
}: {
  tournament: TournamentOutput;
  /** Called with the version's index. Omit to show the ranking only. */
  onUse?: (index: number) => void;
  useLabel?: string;
  busy?: boolean;
}) {
  const [open, setOpen] = useState<number | null>(tournament.winnerIndex);
  const ordered = [...tournament.variants].sort((a, b) => a.rank - b.rank);
  return (
    <div className="space-y-2.5">
      {tournament.summary && <p className="text-[13px] leading-snug">{tournament.summary}</p>}
      <ol className="space-y-1.5">
        {ordered.map((variant, i) => {
          const winner = variant.index === tournament.winnerIndex && !tournament.tooClose;
          const expanded = open === variant.index;
          return (
            <motion.li
              key={variant.index}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...medium, delay: i * 0.07 }}
              className={cn(
                "rounded-[var(--ds-radius-control)] border px-3 py-2.5",
                winner ? "border-primary/40 bg-primary/[0.06]" : "border-border/60 bg-card/60",
              )}
            >
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : variant.index)}
                aria-expanded={expanded}
                className="flex w-full items-center gap-2.5 text-left"
              >
                <span
                  className={cn(
                    "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11.5px] font-semibold",
                    winner ? "bg-primary text-primary-foreground" : "bg-[var(--ds-well-bg)]",
                  )}
                >
                  {winner ? <Trophy className="h-3.5 w-3.5" /> : variant.rank}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                  {variant.label}
                </span>
                <span className="shrink-0 text-[11.5px] text-muted-foreground">
                  {variant.picked}% picked it
                </span>
                <ScoreChip overall={variant.overall} />
              </button>
              {expanded && (
                <div className="mt-2.5 space-y-2.5">
                  {variant.why && (
                    <p className="text-[12.5px] text-muted-foreground">{variant.why}</p>
                  )}
                  <p className="max-h-52 overflow-y-auto whitespace-pre-wrap rounded-[var(--ds-radius-control)] bg-[var(--ds-well-bg)] px-3 py-2 text-[13px] leading-snug scrollbar-thin">
                    {variant.body}
                  </p>
                  {onUse && !variant.isOriginal && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onUse(variant.index)}
                      className={cn(winner ? dsPrimaryBtn : dsGhostBtn, "h-8 px-3.5 text-[12.5px]")}
                    >
                      {useLabel}
                    </button>
                  )}
                </div>
              )}
            </motion.li>
          );
        })}
      </ol>
      <p className="text-[11.5px] text-muted-foreground">
        {CONFIDENCE_LABEL[tournament.confidence]} · ranked by a simulated panel, not real customers.
      </p>
    </div>
  );
}

export function runIsActive(run: RunView | null | undefined): run is RunView {
  return !!run && isActiveRun(run.status);
}
