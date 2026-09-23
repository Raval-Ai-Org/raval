"use client";
// The shared vocabulary for Backlink Growth — surfaces, money, status and the
// journey strip.
//
// Design notes, because they are easy to undo by accident:
//   * Cards are real cards: white `bg-card`, a hairline border and one shadow
//     step. The token file is explicit that surfaces lift with a border and a
//     shadow rather than with alpha, so translucent grey panels are wrong here.
//   * One accent. Moss green marks the primary action and a verified link, and
//     nothing else, so those two things actually read as special.
//   * Money is the unit people see. Credits are the ledger underneath and stay
//     out of the copy.
//   * Numbers are tabular so columns of prices line up.
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

import { Check } from "@/components/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { dsGhostBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";

/** Matches the house easing used across the geo surfaces. */
export const EASE = [0.22, 1, 0.36, 1] as const;

// ── Money ───────────────────────────────────────────────────────────────────

export function formatMoney(usd: number, options: { cents?: boolean } = {}): string {
  const showCents = options.cents ?? !Number.isInteger(usd);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  }).format(usd);
}

export function Money({
  usd,
  className,
  cents,
}: {
  usd: number;
  className?: string;
  cents?: boolean;
}) {
  return <span className={cn("tabular-nums", className)}>{formatMoney(usd, { cents })}</span>;
}

// ── Surfaces ────────────────────────────────────────────────────────────────

export function Card({
  className,
  children,
  as: Tag = "div",
}: {
  className?: string;
  children: React.ReactNode;
  as?: "div" | "section" | "article" | "li";
}) {
  return (
    <Tag
      className={cn(
        "rounded-[20px] border border-border/50 bg-surface-3 dark:border-white/[0.06] dark:bg-white/[0.035]",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function Section({
  id,
  title,
  description,
  action,
  className,
  children,
}: {
  id?: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <section id={id} className={cn("space-y-4", className)}>
      {(title || action) && (
        <header className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            {title && (
              <h2 className="text-[17px] font-semibold tracking-tight text-foreground">{title}</h2>
            )}
            {description && (
              <p className="mt-1 max-w-prose text-[13.5px] leading-relaxed text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

// ── Buttons ─────────────────────────────────────────────────────────────────

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export const btnPrimary = cn(dsPrimaryBtn, "gap-2 px-5 py-2.5 text-[14px]");

export const btnGhost = cn(dsGhostBtn, "gap-2 px-4 py-2 text-[13.5px]");

export const btnQuiet = cn(
  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] text-muted-foreground",
  "transition-colors hover:bg-secondary hover:text-foreground",
  focusRing,
);

// ── Inputs ──────────────────────────────────────────────────────────────────

/** A roomy field, in the spirit of a modern assistant's prompt box. */
export function Field({
  label,
  hint,
  id,
  children,
}: {
  label: string;
  hint?: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-[13.5px] font-medium text-foreground">
        {label}
      </label>
      {hint && <p className="-mt-1 text-[13px] leading-relaxed text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}

export const inputBase = cn(
  "w-full rounded-xl border border-border bg-card px-4 py-3 text-[15px] text-foreground",
  "placeholder:text-muted-foreground/70 transition-shadow",
  "focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent",
);

// ── Status ──────────────────────────────────────────────────────────────────

export const ORDER_LABELS: Record<string, string> = {
  cart: "Not ordered",
  held: "Confirming",
  queued: "Starting",
  awaiting_lock: "Queued",
  preflight: "Checking",
  ordering: "Ordering",
  ordered: "Article ready",
  paying: "Paying",
  paid: "Paid",
  publishing: "Publishing",
  published: "Complete",
  partially_published: "Partly complete",
  blocked_balance: "Paused",
  needs_operator: "On hold",
  failed: "Didn't go through",
  cancelled: "Cancelled",
};

/** One honest sentence per state. Shown with the status, never instead of it. */
export const ORDER_MEANING: Record<string, string> = {
  cart: "Nothing has been charged.",
  held: "Confirming your order.",
  queued: "Your balance is reserved. Starting shortly.",
  awaiting_lock: "Another order is with the publisher. Yours is next.",
  preflight: "Checking everything before we buy.",
  ordering: "Asking the publisher to write and schedule your article.",
  ordered: "The article is written. Checking it before we pay.",
  paying: "Paying for your placements.",
  paid: "Paid. Waiting for the articles to go live.",
  publishing: "Usually live within a day.",
  published: "Every placement was published.",
  partially_published: "Some placements never appeared. We refunded those.",
  blocked_balance: "Waiting on publisher capacity. Your balance is still reserved.",
  needs_operator: "We hit a snag with the publisher. Your balance is reserved while we sort it.",
  failed: "Nothing was charged and your balance was returned.",
  cancelled: "Nothing was charged.",
};

export const PLACEMENT_LABELS: Record<string, string> = {
  pending: "Selected",
  in_basket: "Article ready",
  paid: "Paid",
  awaiting_publication: "Publishing",
  published: "Published",
  live: "Live",
  lost: "Not visible",
  unconfirmed: "Unconfirmed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const VERIFICATION_TEXT: Record<string, string> = {
  pending: "Not checked yet",
  live: "We found your link, and it passes credit",
  nofollow: "We found your link, but it passes no credit",
  missing: "We opened the page and couldn't find your link",
  unreachable: "We couldn't open the page, so we can't say either way",
  blocked: "That address can't be checked from here",
};

type Tone = "live" | "active" | "idle" | "warn" | "bad";

const TONE_CLASS: Record<Tone, string> = {
  live: "bg-success-surface text-success",
  active: "bg-primary-surface text-primary",
  idle: "bg-secondary text-muted-foreground",
  warn: "bg-warning-surface text-warning",
  bad: "bg-destructive/10 text-destructive",
};

/**
 * Order and placement statuses share some words but not their meaning: a
 * *placement* that is "published" is still waiting to be verified, while an
 * *order* that is "published" is finished. They get separate maps so one
 * cannot quietly borrow the other's colour.
 */
const ORDER_TONE: Record<string, Tone> = {
  published: "live",
  partially_published: "warn",
  paid: "active",
  paying: "active",
  publishing: "active",
  ordered: "active",
  ordering: "active",
  preflight: "active",
  held: "active",
  queued: "idle",
  awaiting_lock: "idle",
  cart: "idle",
  cancelled: "idle",
  blocked_balance: "warn",
  needs_operator: "warn",
  failed: "bad",
};

const PLACEMENT_TONE: Record<string, Tone> = {
  live: "live",
  published: "active",
  awaiting_publication: "active",
  paid: "active",
  in_basket: "active",
  pending: "idle",
  cancelled: "idle",
  unconfirmed: "warn",
  lost: "bad",
  failed: "bad",
};

export function StatusPill({
  status,
  label,
  kind = "order",
}: {
  status: string;
  label: string;
  kind?: "order" | "placement";
}) {
  const tone = (kind === "order" ? ORDER_TONE : PLACEMENT_TONE)[status] ?? "idle";
  const pulsing = tone === "active";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium",
        TONE_CLASS[tone],
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        {/* A quiet pulse only while something is genuinely in motion. */}
        {pulsing && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60 motion-reduce:hidden" />
        )}
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
      </span>
      {label}
    </span>
  );
}

export function Meta({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("text-[12.5px] text-muted-foreground", className)}>{children}</span>;
}

// ── Numbers ─────────────────────────────────────────────────────────────────

/** Counts up to a number, or simply shows it when motion is reduced. */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  const frame = useRef<number>(0);
  const from = useRef(0);

  useEffect(() => {
    if (reduced) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / 700);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = Math.round(origin + (value - origin) * eased);
      setShown(next);
      if (progress < 1) frame.current = requestAnimationFrame(step);
      else from.current = value;
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [value, reduced]);

  return <span className={className}>{shown.toLocaleString()}</span>;
}

// ── Motion ──────────────────────────────────────────────────────────────────

/** Fade and rise, staggered. The only entrance this surface uses. */
export function Rise({
  index = 0,
  className,
  children,
}: {
  index?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE, delay: Math.min(index * 0.035, 0.28) }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ── Journey ─────────────────────────────────────────────────────────────────

/**
 * The stages an order really passes through. Each is reached only when the
 * backend says so — there is no timed animation standing in for progress.
 */
export const JOURNEY = [
  { key: "selected", label: "Selected" },
  { key: "written", label: "Article written" },
  { key: "paid", label: "Paid" },
  { key: "publishing", label: "Publishing" },
  { key: "published", label: "Published" },
  { key: "verified", label: "Verified" },
] as const;

export type JourneyKey = (typeof JOURNEY)[number]["key"];

export function journeyReached(orderStatus: string, placements: { status: string }[]): JourneyKey {
  if (placements.some((p) => p.status === "live")) return "verified";
  if (placements.some((p) => p.status === "published")) return "published";
  if (["paid", "publishing", "published", "partially_published"].includes(orderStatus)) {
    return "publishing";
  }
  if (["ordered", "paying"].includes(orderStatus)) return "written";
  return "selected";
}

export function Journey({ reached, failed }: { reached: JourneyKey; failed?: boolean }) {
  const index = JOURNEY.findIndex((stage) => stage.key === reached);

  return (
    <ol className="flex items-start gap-0">
      {JOURNEY.map((stage, i) => {
        const done = i < index;
        const current = i === index;
        return (
          <li key={stage.key} className="flex min-w-0 flex-1 flex-col items-center gap-2">
            <div className="flex w-full items-center">
              <span
                className={cn(
                  "h-0.5 flex-1 rounded-full transition-colors",
                  i === 0 ? "bg-transparent" : done || current ? "bg-primary/40" : "bg-border",
                )}
              />
              <span
                className={cn(
                  "relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                  done && "border-primary bg-primary text-primary-foreground",
                  current && !failed && "border-primary bg-card text-primary",
                  current && failed && "border-destructive bg-card text-destructive",
                  !done && !current && "border-border bg-card",
                )}
              >
                {done ? (
                  <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                ) : (
                  <span
                    className={cn("h-1.5 w-1.5 rounded-full", current ? "bg-current" : "bg-border")}
                  />
                )}
                {current && !failed && (
                  <span className="absolute inset-0 animate-ping rounded-full border-2 border-primary opacity-40 motion-reduce:hidden" />
                )}
              </span>
              <span
                className={cn(
                  "h-0.5 flex-1 rounded-full transition-colors",
                  i === JOURNEY.length - 1
                    ? "bg-transparent"
                    : done
                      ? "bg-primary/40"
                      : "bg-border",
                )}
              />
            </div>
            <span
              className={cn(
                "hidden text-center text-[11.5px] leading-tight sm:block",
                done || current ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {stage.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ── Loading ─────────────────────────────────────────────────────────────────

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-[88px] w-full rounded-2xl" />
      ))}
    </div>
  );
}

export function OverviewSkeleton() {
  return (
    <div className="space-y-8">
      <Skeleton className="h-28 w-full rounded-2xl" />
      <ListSkeleton rows={3} />
    </div>
  );
}
