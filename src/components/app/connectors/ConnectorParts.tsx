"use client";

// The pieces Social accounts and Connectors share, so the two pages look and
// move the same: a hero with the connected marks, a group of square logo
// tiles, and the opened view with its back button. All presentational.
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { ChevronLeft } from "@/components/icons";
import { cn } from "@/lib/utils";
import { ConnectionStatus } from "./ConnectionCard";

export const EASE = [0.16, 1, 0.3, 1] as const;

export type TileTone = "on" | "attention" | "off";

/** The top of the page: what is connected, at a glance. */
export function ConnectHero({
  title,
  marks,
  count,
  attention,
}: {
  title: string;
  /** Logos of what is connected (drawn at 44px), newest first. */
  marks: { id: string; node: ReactNode }[];
  count: number;
  attention: number;
}) {
  const shown = marks.slice(0, 6);
  const more = marks.length - shown.length;
  const on = count > 0;
  return (
    <div className="ds-tile relative overflow-hidden p-5 sm:p-6">
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -top-24 left-1/2 size-64 -translate-x-1/2 rounded-full bg-primary/20 blur-3xl transition-opacity duration-700",
          on ? "opacity-100" : "opacity-0",
        )}
      />
      <div className="relative flex min-h-11 items-center">
        {shown.length ? (
          <div className="flex items-center -space-x-2">
            {shown.map((m, i) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, x: -8, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                transition={{ duration: 0.4, delay: 0.06 * i, ease: EASE }}
                className="rounded-[30%] ring-4 ring-[var(--ds-tile-bg)]"
                style={{ zIndex: shown.length - i }}
              >
                {m.node}
              </motion.div>
            ))}
            {more > 0 && (
              <span className="relative grid size-11 place-items-center rounded-[30%] bg-[var(--ds-well-bg)] text-[13px] font-semibold text-muted-foreground ring-4 ring-[var(--ds-tile-bg)]">
                +{more}
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center -space-x-2" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="size-11 rounded-[30%] border border-dashed border-[var(--ds-tile-border)] bg-[var(--ds-well-bg)] ring-4 ring-[var(--ds-tile-bg)]"
              />
            ))}
          </div>
        )}
      </div>
      <div className="relative mt-5 flex flex-wrap items-center gap-2">
        <p className="text-[15px] font-semibold text-foreground">{title}</p>
        <ConnectionStatus
          tone={attention ? "attention" : on ? "connected" : "off"}
          text={attention ? `${attention} to reconnect` : on ? `${count} connected` : "None yet"}
        />
      </div>
    </div>
  );
}

/** A heading and a grid of logo tiles. Same columns on both pages. */
export function TileGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="contents">
      {label && (
        <h3 className="mb-3 mt-7 px-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </h3>
      )}
      <ul className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 sm:gap-3">{children}</ul>
    </section>
  );
}

/** One square tile: the real logo, the name, and a dot when it's connected. */
export function LogoTile({
  index,
  logo,
  name,
  tone,
  badge,
  onOpen,
}: {
  index: number;
  logo: ReactNode;
  name: string;
  tone: TileTone;
  /** A count in the corner, such as the number of accounts. */
  badge?: string;
  onOpen: () => void;
}) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: EASE, delay: Math.min(index, 12) * 0.03 }}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${name}${tone === "on" ? ", connected" : tone === "attention" ? ", reconnect needed" : ""}`}
        className={cn(
          "group relative flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-[24px] border p-2",
          "border-[var(--ds-tile-border)] bg-[var(--ds-tile-bg)] transition-[transform,box-shadow,border-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
          "hover:-translate-y-0.5 hover:border-[var(--ds-tile-border-hover)] hover:shadow-[0_14px_34px_-16px_rgb(0_0_0/0.35)] active:scale-[0.98]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          tone === "on" && "border-primary/30",
          tone === "attention" && "border-warning/40",
        )}
      >
        {tone !== "off" && (
          <span className="absolute right-2.5 top-2.5 grid size-2.5 place-items-center" aria-hidden>
            {tone === "on" && (
              <span className="absolute inline-flex size-full rounded-full bg-success opacity-50 motion-safe:animate-ping" />
            )}
            <span
              className={cn(
                "relative size-2.5 rounded-full",
                tone === "on" ? "bg-success" : "bg-warning",
              )}
            />
          </span>
        )}
        <span className="transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.07]">
          {logo}
        </span>
        <span className="w-full truncate text-center text-[12.5px] font-medium leading-tight text-foreground">
          {name}
        </span>
        {badge && (
          <span className="absolute left-2.5 top-2 min-w-5 rounded-full bg-[var(--ds-well-bg)] px-1.5 text-center text-[11px] font-semibold leading-5 text-muted-foreground">
            {badge}
          </span>
        )}
      </button>
    </motion.li>
  );
}

/** The opened view: back to the grid, then the content. */
export function OpenedView({
  backLabel,
  onBack,
  children,
}: {
  backLabel: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="-ml-2 inline-flex h-9 items-center gap-1 rounded-full px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-[var(--ds-well-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {backLabel}
      </button>
      {children}
    </div>
  );
}

/** Slides between the grid and an opened item. */
export const slide = (dir: 1 | -1) => ({
  initial: { opacity: 0, x: 20 * dir },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 20 * dir },
  transition: { duration: 0.26, ease: EASE },
});
