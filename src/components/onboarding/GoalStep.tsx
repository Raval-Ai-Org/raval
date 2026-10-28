"use client";

import { useState, type Ref } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  MessageCircle,
  Minus,
  Plus,
  Rocket,
  ShoppingBag,
  Spinner,
  Target,
  TrendingUp,
  Users,
  type LucideIcon,
} from "@/components/icons";
import { dsGhostBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import {
  FOCUS_LABELS,
  FOCUS_METRIC,
  GOAL_FOCUSES,
  METRIC_LABELS,
  TIMEFRAMES,
  type GoalFocus,
  type TimeframeWeeks,
} from "@/lib/goals/contracts";
import { platformLabel } from "@/lib/goals/decide";
import { duration, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Eyebrow } from "./ui";

export type GoalDraft = {
  focus: GoalFocus | null;
  target: string;
  baseline: string;
  platform: string;
  timeframeWeeks: TimeframeWeeks;
  postsPerWeek: number;
  channels: string[];
};

export const emptyGoalDraft: GoalDraft = {
  focus: null,
  target: "",
  baseline: "",
  platform: "",
  timeframeWeeks: 12,
  postsPerWeek: 3,
  channels: [],
};

/** The draft as decideGoals reads it. Numbers stay strings: the server cleans them. */
export function goalDraftToRaw(d: GoalDraft): Record<string, unknown> {
  const metric = d.focus ? FOCUS_METRIC[d.focus] : null;
  return {
    focus: d.focus,
    targets:
      metric && d.target.trim()
        ? [
            {
              metric,
              ...(d.platform ? { platform: d.platform } : {}),
              target: d.target,
              ...(d.baseline.trim() ? { baseline: d.baseline } : {}),
            },
          ]
        : [],
    timeframeWeeks: d.timeframeWeeks,
    postsPerWeek: d.postsPerWeek,
    channels: d.channels,
  };
}

const FOCUS_ICONS: Record<GoalFocus, LucideIcon> = {
  followers: Users,
  reach: TrendingUp,
  leads: Target,
  sales: ShoppingBag,
  engagement: MessageCircle,
  launch: Rocket,
};

const TIMEFRAME_LABELS: Record<TimeframeWeeks, string> = {
  4: "1 month",
  12: "3 months",
  26: "6 months",
  52: "1 year",
};

const CHANNELS = ["instagram", "tiktok", "linkedin", "facebook", "youtube", "twitter", "threads"];

/** Counted on one platform: followers and reach are per account. */
const PER_PLATFORM: Partial<Record<GoalFocus, true>> = { followers: true, reach: true };

const field =
  "h-11 w-full min-w-0 rounded-[var(--ds-radius-well)] border border-border/70 bg-[var(--ds-well-bg)] px-3.5 text-[15px] tabular-nums outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/20";

export function GoalStep({
  draft,
  saving,
  error,
  warnings,
  reduce,
  headingRef,
  scanStrip,
  onChange,
  onBack,
  onContinue,
}: {
  draft: GoalDraft;
  saving: boolean;
  error: string | null;
  warnings: string[];
  reduce: boolean;
  headingRef: Ref<HTMLHeadingElement>;
  /** The live scan, pinned above the questions while it runs. */
  scanStrip?: React.ReactNode;
  onChange: (patch: Partial<GoalDraft>) => void;
  onBack?: () => void;
  onContinue: () => void;
}) {
  const [showNumbers, setShowNumbers] = useState(Boolean(draft.target));
  const metric = draft.focus ? FOCUS_METRIC[draft.focus] : null;
  const perPlatform = draft.focus ? PER_PLATFORM[draft.focus] : false;
  const reveal = {
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: duration.medium, ease: ease.emphasized },
  };

  const toggleChannel = (id: string) => {
    const has = draft.channels.includes(id);
    const channels = has
      ? draft.channels.filter((c) => c !== id)
      : [...draft.channels, id].slice(0, 5);
    onChange({
      channels,
      platform: draft.platform && !channels.includes(draft.platform) ? "" : draft.platform,
    });
  };

  return (
    <div>
      {scanStrip}
      <Eyebrow icon={Target} className={scanStrip ? "mt-8" : undefined}>
        Your goal
      </Eyebrow>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="mt-4 text-[clamp(1.9rem,4.6vw,2.75rem)] font-semibold leading-[1.05] tracking-[-0.035em] outline-none"
      >
        What should your marketing do first?
      </h1>
      <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
        Mellox plans every post around this. You can change it any time in Brain.
      </p>

      <div
        role="radiogroup"
        aria-label="Main goal"
        className="mt-7 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-2.5"
      >
        {GOAL_FOCUSES.map((focus) => {
          const Icon = FOCUS_ICONS[focus];
          const selected = draft.focus === focus;
          return (
            <button
              key={focus}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange({ focus })}
              className={cn(
                "ds-tile group flex min-h-[92px] flex-col items-start gap-2 p-3.5 text-left transition-[border-color,background-color,box-shadow] duration-200 sm:p-4",
                selected
                  ? "border-primary/60 bg-primary/[0.07] shadow-[0_0_0_3px_hsl(var(--primary)/0.14)]"
                  : "ds-tile-hover",
              )}
            >
              <span
                className={cn(
                  "grid h-8 w-8 place-items-center rounded-full transition-colors",
                  selected ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span>
                <span className="block text-[14px] font-semibold leading-tight">
                  {FOCUS_LABELS[focus].label}
                </span>
                <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">
                  {FOCUS_LABELS[focus].hint}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {draft.focus && (
        <motion.div {...reveal} className="mt-8 space-y-7">
          <section aria-labelledby="goal-channels">
            <p id="goal-channels" className="ds-label">
              Where do you want to grow?
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {CHANNELS.map((id) => {
                const on = draft.channels.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleChannel(id)}
                    className={cn(
                      "h-9 rounded-full border px-3.5 text-[13px] font-medium transition-colors",
                      on
                        ? "border-primary/60 bg-primary/10 text-foreground"
                        : "border-border/70 bg-card/70 text-foreground/80 hover:border-foreground/25",
                    )}
                  >
                    {platformLabel(id)}
                  </button>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="goal-cadence">
            <p id="goal-cadence" className="ds-label">
              Posts a week you can look over
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-card/80 p-1">
                <button
                  type="button"
                  aria-label="Fewer posts"
                  disabled={draft.postsPerWeek <= 1}
                  onClick={() => onChange({ postsPerWeek: draft.postsPerWeek - 1 })}
                  className="grid h-9 w-9 place-items-center rounded-full transition hover:bg-secondary disabled:opacity-40"
                >
                  <Minus className="h-4 w-4" aria-hidden />
                </button>
                <output
                  aria-live="polite"
                  className="w-10 text-center text-[17px] font-semibold tabular-nums"
                >
                  {draft.postsPerWeek}
                </output>
                <button
                  type="button"
                  aria-label="More posts"
                  disabled={draft.postsPerWeek >= 14}
                  onClick={() => onChange({ postsPerWeek: draft.postsPerWeek + 1 })}
                  className="grid h-9 w-9 place-items-center rounded-full transition hover:bg-secondary disabled:opacity-40"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                </button>
              </div>
              <p className="text-[12.5px] text-muted-foreground">
                Mellox drafts them. Nothing goes out until you approve it.
              </p>
            </div>
          </section>

          <section aria-labelledby="goal-numbers">
            <div className="flex items-center justify-between gap-3">
              <p id="goal-numbers" className="ds-label">
                A number to aim for <span className="normal-case tracking-normal">(optional)</span>
              </p>
              {!showNumbers && (
                <button
                  type="button"
                  onClick={() => setShowNumbers(true)}
                  className={cn(dsGhostBtn, "h-8 px-3 text-[12.5px]")}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden /> Add a target
                </button>
              )}
            </div>
            {showNumbers && metric && (
              <motion.div {...reveal} className="ds-tile mt-3 space-y-4 p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
                  <label className="block">
                    <span className="mb-1.5 block text-[12px] text-muted-foreground">
                      Where you are today
                    </span>
                    <input
                      inputMode="numeric"
                      value={draft.baseline}
                      onChange={(e) => onChange({ baseline: e.target.value })}
                      placeholder="e.g. 1,200"
                      className={field}
                    />
                  </label>
                  <ArrowRight
                    className="mx-auto hidden h-4 w-4 text-muted-foreground sm:mb-3.5 sm:block"
                    aria-hidden
                  />
                  <label className="block">
                    <span className="mb-1.5 block text-[12px] text-muted-foreground">
                      Where you want to be ({METRIC_LABELS[metric]})
                    </span>
                    <input
                      inputMode="numeric"
                      value={draft.target}
                      onChange={(e) => onChange({ target: e.target.value })}
                      placeholder="e.g. 5,000"
                      className={field}
                    />
                  </label>
                </div>
                {perPlatform && draft.channels.length > 0 && (
                  <div>
                    <span className="mb-1.5 block text-[12px] text-muted-foreground">
                      Counted on
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {["", ...draft.channels].map((id) => (
                        <button
                          key={id || "all"}
                          type="button"
                          aria-pressed={draft.platform === id}
                          onClick={() => onChange({ platform: id })}
                          className={cn(
                            "h-8 rounded-full border px-3 text-[12.5px] transition-colors",
                            draft.platform === id
                              ? "border-primary/60 bg-primary/10"
                              : "border-border/70 hover:border-foreground/25",
                          )}
                        >
                          {id ? platformLabel(id) : "All channels"}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <span className="mb-1.5 block text-[12px] text-muted-foreground">By when</span>
                  <div
                    role="radiogroup"
                    aria-label="Timeframe"
                    className="ds-well inline-flex flex-wrap gap-1 rounded-full p-1"
                  >
                    {TIMEFRAMES.map((weeks) => (
                      <button
                        key={weeks}
                        type="button"
                        role="radio"
                        aria-checked={draft.timeframeWeeks === weeks}
                        onClick={() => onChange({ timeframeWeeks: weeks })}
                        className={cn(
                          "h-8 rounded-full px-3.5 text-[12.5px] font-medium transition-colors",
                          draft.timeframeWeeks === weeks
                            ? "bg-card text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {TIMEFRAME_LABELS[weeks]}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </section>
        </motion.div>
      )}

      {(error || warnings.length > 0) && (
        <div className="mt-6 space-y-2" aria-live="polite">
          {error && (
            <p
              role="alert"
              className="rounded-2xl bg-destructive/[0.07] px-4 py-3 text-[13px] text-destructive"
            >
              {error}
            </p>
          )}
          {warnings.map((w) => (
            <p
              key={w}
              className="rounded-2xl bg-warning-surface px-4 py-3 text-[13px] text-warning"
            >
              {w}
            </p>
          ))}
        </div>
      )}

      <div className="mt-9 flex flex-wrap items-center justify-between gap-3">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className={cn(dsGhostBtn, "h-11 px-4 text-[13.5px]")}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          disabled={!draft.focus || saving}
          onClick={onContinue}
          className={cn(dsPrimaryBtn, "h-12 px-6 text-[14.5px]")}
        >
          Set my goal
          {saving ? (
            <Spinner className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <ArrowRight className="h-4 w-4" aria-hidden />
          )}
        </button>
      </div>
    </div>
  );
}
