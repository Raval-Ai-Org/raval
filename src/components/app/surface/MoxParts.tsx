"use client";

// The small Holo-style pieces every Mellox 2.0 screen is built from:
//   BackPill      "← Back" at the top left of a page
//   StepPills     "1. Idea  2. Details  3. Review" at the top centre
//   GradProgress  the thin Mox-gradient progress bar
//   MoxSpeech     Mox (render or face) with a speech bubble, one bold phrase
//   CardArrow     the round arrow in the corner of a card

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check } from "@/components/icons";
import { Mox, type MoxPose } from "@/components/brand/mox/Mox";
import { MoxFace, type MoxMood } from "@/components/brand/mox/MoxFace";
import { cn } from "@/lib/utils";
import { dsFocus } from "./buttons";

export function BackPill({
  onClick,
  label = "Back",
  className,
}: {
  onClick: () => void;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] pl-2.5 pr-3.5 text-[12.5px] font-semibold text-foreground/80 shadow-[var(--ds-card-shadow)] transition-all hover:text-foreground hover:shadow-[var(--ds-card-shadow-hover)] active:scale-[0.97]",
        dsFocus,
        className,
      )}
    >
      <ArrowLeft
        className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5"
        aria-hidden
      />
      {label}
    </button>
  );
}

export type Step = { id: string; label: string };

export function StepPills({
  steps,
  current,
  onPick,
  className,
}: {
  steps: Step[];
  current: string;
  /** Lets a person go back to a finished step; later steps stay closed. */
  onPick?: (id: string) => void;
  className?: string;
}) {
  const at = Math.max(
    0,
    steps.findIndex((s) => s.id === current),
  );
  return (
    <ol
      aria-label="Steps"
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-[var(--ds-well-bg)] p-1",
        className,
      )}
    >
      {steps.map((s, i) => {
        const active = i === at;
        const done = i < at;
        return (
          <li key={s.id} className="relative">
            {active && (
              <motion.span
                layoutId="step-pill"
                className="absolute inset-0 rounded-full bg-[var(--ds-card-bg)] shadow-[var(--ds-card-shadow)]"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <button
              type="button"
              disabled={!done || !onPick}
              onClick={() => onPick?.(s.id)}
              aria-current={active ? "step" : undefined}
              className={cn(
                "relative z-10 inline-flex h-7 items-center gap-1 rounded-full px-3 text-[12px] font-semibold transition-colors",
                active
                  ? "text-foreground"
                  : done
                    ? "text-foreground/70 hover:text-foreground"
                    : "text-muted-foreground/70",
                dsFocus,
              )}
            >
              {done ? (
                <Check className="h-3 w-3 text-primary-ink" aria-hidden />
              ) : (
                <span className="tabular-nums">{i + 1}.</span>
              )}
              {s.label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function GradProgress({
  value,
  className,
  label = "Progress",
}: {
  /** 0..1 */
  value: number;
  className?: string;
  label?: string;
}) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      className={cn("h-1 overflow-hidden rounded-full bg-[var(--ds-well-bg)]", className)}
    >
      <motion.div
        className="ds-grad-bar h-full rounded-full"
        initial={false}
        animate={{ width: `${Math.max(v * 100, 3)}%` }}
        transition={{ type: "spring", stiffness: 140, damping: 24 }}
      />
    </div>
  );
}

export function MoxSpeech({
  children,
  pose,
  mood = "happy",
  size = 96,
  className,
  bubbleClassName,
}: {
  children: ReactNode;
  /** A 3D render; without one Mox shows as the drawn face. */
  pose?: MoxPose;
  mood?: MoxMood;
  size?: number;
  className?: string;
  bubbleClassName?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      {pose ? (
        <Mox pose={pose} size={size} alt="" shadow={size >= 80} />
      ) : (
        <MoxFace mood={mood} size={size} track />
      )}
      <motion.div
        key={typeof children === "string" ? children : undefined}
        initial={{ opacity: 0, x: -6, scale: 0.96 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 26, delay: 0.08 }}
        className={cn(
          "relative max-w-[300px] rounded-2xl rounded-bl-md border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] px-3.5 py-2.5 text-[13.5px] leading-snug text-foreground/85 shadow-[var(--ds-card-shadow)] [&_b]:font-bold [&_b]:text-foreground [&_strong]:font-bold [&_strong]:text-foreground",
          bubbleClassName,
        )}
      >
        {children}
      </motion.div>
    </div>
  );
}

export function CardArrow({ className }: { className?: string }) {
  return (
    <span
      data-arrow
      aria-hidden
      className={cn(
        "grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] text-foreground/70 shadow-[var(--ds-card-shadow)]",
        className,
      )}
    >
      <ArrowRight className="h-3.5 w-3.5" />
    </span>
  );
}
