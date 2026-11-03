"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Image as ImageIcon, Search, X } from "@/components/icons";
import { duration, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { PIN_FRAME } from "./PinCard";

/**
 * The pill controls that sit above a wall of pins (docs/design-system.md,
 * "Pinterest language"): tabs on a track, a filled search pill, pill selects
 * and a sideways row of chips.
 */

/** A native <select> drawn as a pill. */
export const PILL_SELECT =
  "h-9 rounded-full border-0 bg-surface-2/80 pl-3 pr-8 text-xs font-medium text-foreground ring-1 ring-border/60 outline-none focus-visible:ring-2 focus-visible:ring-ring/55";

/** The rounded track tabs and toggles sit on. */
export const PILL_TRACK = "inline-flex rounded-full bg-surface-2/80 p-1 ring-1 ring-border/60";

export type PillTab<T extends string> = {
  id: T;
  label: ReactNode;
  icon?: ReactNode;
  count?: number | null;
  testId?: string;
};

export function PillTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  layoutId,
  className,
}: {
  tabs: readonly PillTab<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  /** Unique per screen so the moving pill doesn't jump between tab rows. */
  layoutId: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        PILL_TRACK,
        "max-w-full overflow-x-auto [scrollbar-width:none]! [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {tabs.map((t) => {
        const on = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            data-testid={t.testId}
            onClick={() => onChange(t.id)}
            className={cn(
              "relative inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55",
              on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {on ? (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-full bg-surface-3 shadow-1 ring-1 ring-border/70"
                transition={{ duration: duration.medium, ease: ease.emphasized }}
              />
            ) : null}
            {t.icon ? <span className="relative inline-flex">{t.icon}</span> : null}
            <span className="relative">{t.label}</span>
            {t.count != null ? (
              <span className="relative tabular-nums text-muted-foreground">{t.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export const SearchPill = forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    /** Screen-reader name. */
    label: string;
    /** Shows a "/" key hint when the field is empty. */
    hotkey?: boolean;
    className?: string;
  }
>(function SearchPill({ value, onChange, placeholder, label, hotkey, className }, ref) {
  return (
    <label className={cn("relative flex h-9 min-w-0 items-center", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <span className="sr-only">{label}</span>
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-full border-0 bg-surface-2/80 pl-8 pr-9 text-sm text-foreground ring-1 ring-border/60 outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/55"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-1.5 grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-surface-3 hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      ) : hotkey ? (
        <kbd className="pointer-events-none absolute right-3 hidden rounded bg-surface-3 px-1.5 font-mono text-[10px] text-muted-foreground ring-1 ring-border sm:inline">
          /
        </kbd>
      ) : null}
    </label>
  );
});

/** One chip: a small pill that can be on or off. */
export const Chip = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean; icon?: ReactNode }
>(function Chip({ on, icon, className, children, type = "button", ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={on}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 disabled:pointer-events-none disabled:opacity-50",
        on
          ? "bg-foreground text-background"
          : "bg-surface-2/80 text-foreground ring-1 ring-border/60 hover:bg-surface-2",
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
});

/** Chips in one line that scroll sideways. */
export function ChipRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 overflow-x-auto [scrollbar-width:none]! [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Loading wall: pin-shaped placeholders at mixed heights. */
export function PinGridSkeleton({
  count = 10,
  columns = "columns-2 sm:columns-3 lg:columns-4 2xl:columns-5",
  className,
}: {
  count?: number;
  /** Column classes; pass container-query classes inside a @container. */
  columns?: string;
  className?: string;
}) {
  return (
    <div className={cn("gap-3", columns, className)}>
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className={cn(PIN_FRAME, "mb-3")}
          style={{ aspectRatio: String([0.8, 1, 0.5625, 1.25, 0.8][index % 5]) }}
        >
          <span className="studio-weave absolute inset-0" aria-hidden />
        </div>
      ))}
    </div>
  );
}

/**
 * A board cover: one large picture beside two small ones, like a Pinterest
 * board. Missing pictures fall back to `fallback` (a logo or an icon).
 */
export function BoardCover({
  images,
  fallback,
  className,
}: {
  images: readonly (string | null | undefined)[];
  fallback?: ReactNode;
  className?: string;
}) {
  const pics = images.filter((s): s is string => !!s).slice(0, 3);
  const cell = "relative overflow-hidden bg-surface-2";
  const img = (src: string) => (
    <img src={src} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
  );
  const empty = (
    <span className="grid size-full place-items-center text-muted-foreground">
      {fallback ?? <ImageIcon className="size-6" />}
    </span>
  );
  return (
    <div
      className={cn(
        "grid aspect-[3/2] w-full grid-cols-3 grid-rows-2 gap-0.5 overflow-hidden rounded-[var(--ds-radius-tile)] bg-surface-2",
        className,
      )}
    >
      <div
        className={cn(cell, pics.length > 1 ? "col-span-2 row-span-2" : "col-span-3 row-span-2")}
      >
        {pics[0] ? img(pics[0]) : empty}
      </div>
      {pics.length > 1 ? (
        <>
          <div className={cell}>{img(pics[1])}</div>
          <div className={cell}>{pics[2] ? img(pics[2]) : null}</div>
        </>
      ) : null}
    </div>
  );
}
