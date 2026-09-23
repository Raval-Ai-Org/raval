"use client";

// Building blocks shared by the UGC studio steps. Token-only styling: ds tiles,
// neutral wells, and the Ultra Moss primary for selection and progress. Visual
// first: phone frames, icon tiles and animated progress instead of paragraphs.
import { useEffect, useState } from "react";
import type * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Check,
  ChevronDown,
  Lightbulb,
  PenLine,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Video,
  type LucideIcon,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import { duration, ease } from "@/lib/motion";
import type { RenderStatus } from "@/lib/ugc/schemas";

export function Panel({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("ds-tile p-4 sm:p-5", className)} {...rest}>
      {children}
    </div>
  );
}

/** Small uppercase label above a group, with an optional icon and trailing slot. */
export function SectionLabel({
  icon: Icon,
  children,
  trailing,
  className,
}: {
  icon?: LucideIcon;
  children: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      <span className="ds-label flex items-center gap-1.5 text-[11px]">
        {Icon ? <Icon className="size-3.5 text-primary" aria-hidden /> : null}
        {children}
      </span>
      {trailing}
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
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <label htmlFor={htmlFor} className="min-w-0 text-xs font-medium text-foreground/90">
          {label}
        </label>
        {hint ? (
          <span className="min-w-0 text-right text-[11px] text-muted-foreground">{hint}</span>
        ) : null}
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
  icon?: LucideIcon;
};

/** Single-select chip group (radio semantics) with a sliding selection pill. */
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
  const reduce = useReducedMotion();
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex flex-wrap gap-1.5", className)}>
      {options.map((o) => {
        const selected = o.id === value;
        const Icon = o.icon;
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
              "relative isolate inline-flex items-center gap-1.5 rounded-full font-medium transition-colors duration-[--motion-duration-fast]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-40",
              size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-3.5 text-[13px]",
              selected
                ? "text-primary-foreground"
                : "bg-[var(--ds-well-bg)] text-muted-foreground hover:bg-[var(--ds-well-bg-hover)] hover:text-foreground",
            )}
          >
            {selected ? (
              <motion.span
                layoutId={reduce ? undefined : `chip-${label}`}
                aria-hidden
                className="absolute inset-0 -z-10 rounded-full bg-primary"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            ) : null}
            {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A big selectable tile with a visual on top: the main way choices are made. */
export function ChoiceTile({
  selected,
  onSelect,
  label,
  sublabel,
  visual,
  disabled,
  className,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  sublabel?: string;
  visual: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      whileHover={reduce || disabled ? undefined : { y: -2 }}
      whileTap={reduce || disabled ? undefined : { scale: 0.97 }}
      transition={{ duration: duration.fast, ease: ease.standard }}
      title={sublabel}
      className={cn(
        "group relative flex min-w-0 flex-col items-center gap-2 rounded-[18px] border p-3 text-center transition-[border-color,background-color,box-shadow]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-40",
        selected
          ? "border-primary/70 bg-primary/10 shadow-[0_10px_30px_-18px_hsl(var(--primary)/0.9)]"
          : "border-[var(--ds-tile-border)] bg-[var(--ds-tile-bg)] hover:border-[var(--ds-tile-border-hover)]",
        className,
      )}
    >
      <AnimatePresence>
        {selected ? (
          <motion.span
            key="check"
            initial={reduce ? { opacity: 0 } : { scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 600, damping: 30 }}
            className="absolute right-2 top-2 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground"
            aria-hidden
          >
            <Check className="size-3" />
          </motion.span>
        ) : null}
      </AnimatePresence>
      <span
        className={cn(
          "grid size-11 place-items-center rounded-2xl transition-colors",
          selected
            ? "bg-primary text-primary-foreground"
            : "bg-[var(--ds-well-bg)] text-foreground/80 group-hover:text-foreground",
        )}
      >
        {visual}
      </span>
      <span className="line-clamp-2 w-full text-xs font-medium leading-tight">{label}</span>
    </motion.button>
  );
}

/** A thin outline rectangle drawn at an aspect ratio, e.g. "9:16". */
export function RatioShape({ ratio, className }: { ratio: string; className?: string }) {
  const [w, h] = ratio.split(":").map(Number);
  const scale = 18 / Math.max(w || 1, h || 1);
  return (
    <span
      aria-hidden
      className={cn("inline-block rounded-[3px] border-[1.5px] border-current", className)}
      style={{ width: Math.round((w || 1) * scale), height: Math.round((h || 1) * scale) }}
    />
  );
}

function phoneAspect(ratio: string) {
  switch (ratio) {
    case "16:9":
      return "aspect-video";
    case "1:1":
      return "aspect-square";
    case "3:4":
      return "aspect-[3/4]";
    case "4:3":
      return "aspect-[4/3]";
    default:
      return "aspect-[9/16]";
  }
}

/** A phone-style frame that previews the ad at its real shape. */
export function PhoneFrame({
  ratio = "9:16",
  children,
  className,
  screenClassName,
}: {
  ratio?: string;
  children?: React.ReactNode;
  className?: string;
  screenClassName?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      layout={!reduce}
      transition={{ duration: duration.slow, ease: ease.emphasized }}
      className={cn(
        "relative mx-auto w-full overflow-hidden rounded-[26px] bg-neutral-950 p-[5px] shadow-[0_24px_60px_-28px_hsl(var(--primary)/0.55),0_0_0_1px_hsl(var(--foreground)/0.08)]",
        className,
      )}
    >
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-[21px] bg-neutral-900 text-white",
          phoneAspect(ratio),
          screenClassName,
        )}
      >
        {children}
        {ratio === "9:16" || ratio === "3:4" ? (
          <span
            aria-hidden
            className="absolute left-1/2 top-1.5 z-20 h-1.5 w-12 -translate-x-1/2 rounded-full bg-black/70"
          />
        ) : null}
      </div>
    </motion.div>
  );
}

/** An abstract creator silhouette for phone previews before a video exists. */
export function CreatorSilhouette({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 90 160" aria-hidden className={cn("h-full w-full", className)}>
      <defs>
        <linearGradient id="ugc-sil" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="hsl(var(--primary))" stopOpacity="0.55" />
          <stop offset="1" stopColor="hsl(var(--primary))" stopOpacity="0.08" />
        </linearGradient>
      </defs>
      <circle cx="45" cy="62" r="17" fill="url(#ugc-sil)" />
      <path d="M12 160c0-30 15-52 33-52s33 22 33 52z" fill="url(#ugc-sil)" />
    </svg>
  );
}

export const STEPS = [
  { id: "product", label: "Product", icon: ShoppingBag },
  { id: "brief", label: "Style", icon: SlidersHorizontal },
  { id: "concepts", label: "Idea", icon: Lightbulb },
  { id: "script", label: "Script", icon: PenLine },
  { id: "generate", label: "Video", icon: Video },
] as const;
export type StepId = (typeof STEPS)[number]["id"];

/** Progress stepper: icon dots on a track that fills with lime as you go. */
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
  const pct = (index / (STEPS.length - 1)) * 100;
  return (
    <nav aria-label="Ad steps" className="w-full">
      <ol className="relative flex items-start justify-between">
        <span
          aria-hidden
          className="absolute left-[10%] right-[10%] top-[17px] h-[3px] rounded-full bg-[var(--ds-well-bg-hover)]"
        >
          <motion.span
            className="block h-full rounded-full bg-primary"
            initial={false}
            animate={{ width: `${pct}%` }}
            transition={{ duration: duration.xslow, ease: ease.emphasized }}
          />
        </span>
        {STEPS.map((s, i) => {
          const done = i < index;
          const active = s.id === current;
          const enabled = reachable(s.id);
          const Icon = s.icon;
          return (
            <li key={s.id} className="relative z-10 flex w-1/5 justify-center">
              <button
                type="button"
                disabled={!enabled}
                aria-current={active ? "step" : undefined}
                onClick={() => onSelect(s.id)}
                className="group flex flex-col items-center gap-1.5 rounded-2xl px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-default"
              >
                <motion.span
                  initial={false}
                  animate={{ scale: active ? 1.08 : 1 }}
                  transition={{ type: "spring", stiffness: 420, damping: 26 }}
                  className={cn(
                    "grid size-9 place-items-center rounded-full ring-4 ring-background transition-colors",
                    active
                      ? "bg-primary text-primary-foreground shadow-[0_0_0_6px_hsl(var(--primary)/0.18)]"
                      : done
                        ? "bg-primary/20 text-primary"
                        : "bg-surface-2 text-muted-foreground",
                    enabled && !active && "group-hover:text-foreground",
                  )}
                >
                  {done ? (
                    <Check className="size-4" aria-hidden />
                  ) : (
                    <Icon className="size-4" aria-hidden />
                  )}
                </motion.span>
                <span
                  className={cn(
                    "text-[11px] font-medium transition-colors",
                    active ? "text-foreground" : "text-muted-foreground",
                    !active && "max-sm:sr-only",
                  )}
                >
                  {s.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The one heading of a step, with an icon chip and an optional action on the right. */
export function StepHeader({
  icon: Icon,
  title,
  action,
}: {
  icon: LucideIcon;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="ds-page-title flex items-center gap-2.5 text-lg">
        <span className="grid size-8 place-items-center rounded-full bg-primary/15 text-primary">
          <Icon className="size-4" aria-hidden />
        </span>
        {title}
      </h3>
      {action}
    </div>
  );
}

/** A collapsible group: tidy away the detail most people never need. */
export function Disclosure({
  label,
  icon,
  defaultOpen = false,
  badge,
  children,
  className,
}: {
  label: string;
  icon?: LucideIcon;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const reduce = useReducedMotion();
  const Icon = icon;
  return (
    <div className={cn("ds-tile overflow-hidden", className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-[var(--ds-well-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
      >
        {Icon ? <Icon className="size-4 text-primary" aria-hidden /> : null}
        <span className="mr-auto">{label}</span>
        {badge}
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={motionPreset.base}>
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="body"
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={motionPreset.medium}
          >
            <div className="space-y-4 px-4 pb-4 pt-1">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/**
 * Waiting state: a breathing lime orb with an icon and a rotating status
 * line. It is a loading signal, so it keeps moving under reduced motion.
 */
export function ThinkingLoader({
  stages,
  intervalMs = 4500,
  icon: Icon = Sparkles,
  className,
}: {
  stages: readonly string[];
  intervalMs?: number;
  icon?: LucideIcon;
  className?: string;
}) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const id = window.setInterval(
      () => setStage((s) => Math.min(s + 1, stages.length - 1)),
      intervalMs,
    );
    return () => window.clearInterval(id);
  }, [stages.length, intervalMs]);
  return (
    <div className={cn("flex flex-col items-center gap-5 py-6", className)} aria-live="polite">
      <div className="relative grid size-24 place-items-center">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            aria-hidden
            className="absolute inset-0 rounded-full border border-primary/40"
            initial={{ scale: 0.6, opacity: 0.8 }}
            animate={{ scale: 1.5, opacity: 0 }}
            transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.8, ease: "easeOut" }}
          />
        ))}
        <motion.span
          aria-hidden
          className="absolute inset-2 rounded-full bg-[conic-gradient(from_0deg,hsl(var(--primary)/0.05),hsl(var(--primary)/0.7),hsl(var(--primary)/0.05))]"
          animate={{ rotate: 360 }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
        />
        <span className="relative grid size-14 place-items-center rounded-full bg-background text-primary shadow-[0_0_30px_-4px_hsl(var(--primary)/0.6)]">
          <Icon className="size-6" aria-hidden />
        </span>
      </div>
      <div className="h-5 overflow-hidden text-center">
        <AnimatePresence mode="wait">
          <motion.p
            key={stage}
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -12, opacity: 0 }}
            transition={motionPreset.medium}
            className="text-sm font-medium"
          >
            {stages[stage]}
          </motion.p>
        </AnimatePresence>
      </div>
      <div className="flex gap-1.5" aria-hidden>
        {stages.map((_, i) => (
          <motion.span
            key={i}
            className="h-1.5 rounded-full bg-primary"
            initial={false}
            animate={{ width: i === stage ? 20 : 6, opacity: i <= stage ? 1 : 0.25 }}
            transition={motionPreset.medium}
          />
        ))}
      </div>
    </div>
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
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
} as const;

export const itemVariants = {
  hidden: { opacity: 0, y: 10, scale: 0.98 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: duration.slow, ease: ease.emphasized },
  },
} as const;

/** Step body transition. */
export function StepFrame({ stepKey, children }: { stepKey: string; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      key={stepKey}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
      transition={motionPreset.slow}
      className="space-y-5"
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
        status === "succeeded" && "bg-primary text-primary-foreground",
        (status === "failed" || status === "cancelled") && "bg-danger-surface text-danger",
        live && "bg-black/60 text-white backdrop-blur",
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
        "sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--ds-tile-border)] bg-background/90 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6",
        className,
      )}
    >
      {children}
    </div>
  );
}
