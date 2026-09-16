"use client";

// Building blocks shared by the UGC studio steps. Token-only styling: neutral
// surfaces, the Ultra Moss primary for selection and progress.
import type * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check } from "@/components/icons";
import { cn } from "@/lib/utils";
import { duration, ease } from "@/lib/motion";
import type { RenderStatus } from "@/lib/ugc/schemas";

export function Panel({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-2xl bg-surface-2/70 p-4 ring-1 ring-border/60 sm:p-5", className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-xs font-medium text-foreground/90">
          {label}
        </label>
        {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

export type ChipOption<T extends string> = {
  id: T;
  label: string;
  hint?: string;
  disabled?: boolean;
};

/** Single-select chip group (radio semantics). */
export function ChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
  size = "md",
}: {
  label: string;
  options: readonly ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex flex-wrap gap-1.5", className)}>
      {options.map((o) => {
        const selected = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={o.disabled}
            title={o.hint}
            onClick={() => onChange(o.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full font-medium ring-1 transition-[background-color,color,box-shadow] duration-[--motion-duration-fast]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-40",
              size === "sm" ? "h-7 px-2.5 text-[11.5px]" : "h-8 px-3 text-xs",
              selected
                ? "bg-primary/15 text-foreground ring-primary/70"
                : "bg-surface-3/60 text-muted-foreground ring-border/70 hover:bg-surface-3 hover:text-foreground",
            )}
          >
            {selected ? <Check className="size-3.5 text-primary" aria-hidden /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export const STEPS = [
  { id: "product", label: "Product" },
  { id: "brief", label: "Brief" },
  { id: "concepts", label: "Concepts" },
  { id: "script", label: "Script" },
  { id: "generate", label: "Generate" },
] as const;
export type StepId = (typeof STEPS)[number]["id"];

export function Stepper({
  current,
  reachable,
  onSelect,
}: {
  current: StepId;
  reachable: (id: StepId) => boolean;
  onSelect: (id: StepId) => void;
}) {
  const index = STEPS.findIndex((s) => s.id === current);
  return (
    <nav aria-label="Ad steps" className="-mx-1 overflow-x-auto px-1">
      <ol className="flex min-w-max items-center gap-1">
        {STEPS.map((s, i) => {
          const done = i < index;
          const active = s.id === current;
          const enabled = reachable(s.id);
          return (
            <li key={s.id} className="flex items-center gap-1">
              <button
                type="button"
                disabled={!enabled}
                aria-current={active ? "step" : undefined}
                onClick={() => onSelect(s.id)}
                className={cn(
                  "flex h-8 items-center gap-2 rounded-full pl-1 pr-3 text-xs font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-default",
                  active
                    ? "bg-surface-3 text-foreground ring-1 ring-border"
                    : "text-muted-foreground",
                  enabled && !active && "hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid size-6 place-items-center rounded-full text-[11px] tabular-nums",
                    active
                      ? "bg-primary text-primary-foreground"
                      : done
                        ? "bg-primary/20 text-primary"
                        : "bg-surface-3 text-muted-foreground",
                  )}
                >
                  {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
                </span>
                {s.label}
              </button>
              {i < STEPS.length - 1 ? (
                <span aria-hidden className="h-px w-3 bg-border sm:w-5" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Motion presets for the studio (token durations and curves). */
export const motionPreset = {
  base: { duration: duration.base, ease: ease.standard },
  medium: { duration: duration.medium, ease: ease.standard },
  slow: { duration: duration.slow, ease: ease.emphasized },
} as const;

export const listVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.02 } },
} as const;

export const itemVariants = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: { duration: duration.medium, ease: ease.standard } },
} as const;

/** Step body transition. */
export function StepFrame({ stepKey, children }: { stepKey: string; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      key={stepKey}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={motionPreset.medium}
      className="space-y-4"
    >
      {children}
    </motion.div>
  );
}

const STATUS_LABEL: Record<RenderStatus, string> = {
  queued: "Queued",
  submitting: "Starting",
  processing: "Rendering",
  persisting: "Saving",
  succeeded: "Ready",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function RenderStatusChip({
  status,
  className,
}: {
  status: RenderStatus;
  className?: string;
}) {
  const live =
    status === "queued" ||
    status === "submitting" ||
    status === "processing" ||
    status === "persisting";
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-[10.5px] font-medium",
        status === "succeeded" && "bg-primary/15 text-primary",
        (status === "failed" || status === "cancelled") && "bg-danger-surface text-danger",
        live && "bg-surface-3 text-foreground",
        className,
      )}
    >
      {live ? (
        <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-hidden />
      ) : null}
      {STATUS_LABEL[status]}
    </span>
  );
}

export function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return "<$0.01";
  return `$${value.toFixed(value < 10 ? 2 : 0)}`;
}

/** A sticky footer action bar inside a step (stays reachable on phones). */
export function StepActions({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-border/60 bg-background/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6",
        className,
      )}
    >
      {children}
    </div>
  );
}
