"use client";

import type { ComponentType, ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Info } from "@/components/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type ConnectionTone = "connected" | "attention" | "off";

const TONE: Record<ConnectionTone, { pill: string; dot: string }> = {
  connected: { pill: "bg-success/12 text-success", dot: "bg-success" },
  attention: { pill: "bg-warning/12 text-warning", dot: "bg-warning" },
  off: { pill: "bg-[var(--ds-well-bg)] text-muted-foreground", dot: "bg-muted-foreground/50" },
};

const EASE = [0.16, 1, 0.3, 1] as const;

/** The status of a connection: a dot and one or two words. */
export function ConnectionStatus({ tone, text }: { tone: ConnectionTone; text: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium",
        TONE[tone].pill,
      )}
    >
      <span className="relative grid size-1.5 place-items-center">
        {tone === "connected" && (
          <span className="absolute inline-flex size-full rounded-full bg-success opacity-60 motion-safe:animate-ping" />
        )}
        <span className={cn("relative size-1.5 rounded-full", TONE[tone].dot)} />
      </span>
      {text}
    </span>
  );
}

/** A small fact about a connection (which account, which site, when). */
export function ConnectionFact({
  icon: Icon,
  tone = "default",
  children,
  title,
}: {
  icon?: ComponentType<{ className?: string }>;
  tone?: "default" | "success" | "warning" | "destructive";
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full bg-[var(--ds-well-bg)] px-2.5 py-1 text-[12px]",
        tone === "default" && "text-foreground/80",
        tone === "success" && "text-success",
        tone === "warning" && "text-warning",
        tone === "destructive" && "text-destructive",
      )}
    >
      {Icon && <Icon className="size-3.5 shrink-0 opacity-70" />}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/** The square a brand mark sits in, the same on every connection. */
export function ConnectionLogo({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-[14px] bg-white text-[#1b1f23] ring-1 ring-black/[0.06]",
        "transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/conn:scale-[1.04]",
        "dark:bg-white/[0.07] dark:text-white dark:ring-white/[0.08]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** What a connection card looks like while its status loads. */
export function ConnectionSkeleton({ label }: { label: string }) {
  return (
    <div className="ds-tile flex items-center gap-4 p-4 sm:p-5" aria-label={label} aria-busy="true">
      <Skeleton className="size-11 rounded-[14px]" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-32 rounded-full" />
        <Skeleton className="h-3 w-52 max-w-full rounded-full" />
      </div>
      <Skeleton className="hidden h-9 w-24 rounded-full sm:block" />
    </div>
  );
}

/**
 * The one card every connection in Settings uses: mark, name, status, one
 * short line, a row of facts, the actions, then optional settings underneath
 * (they slide open when given).
 */
export function ConnectionCard({
  label,
  logo,
  name,
  description,
  status,
  facts,
  actions,
  note,
  error,
  children,
}: {
  label: string;
  logo: ReactNode;
  name: string;
  /** One short line. It is cut off rather than wrapped. */
  description: ReactNode;
  /** `null` while the status is loading. */
  status: { tone: ConnectionTone; text: string } | null;
  /** `ConnectionFact` chips: who connected it, which site, when it last ran. */
  facts?: ReactNode;
  actions?: ReactNode;
  /** Something a person should know before it works (not an error). */
  note?: ReactNode;
  error?: string | null;
  children?: ReactNode;
}) {
  const open = Boolean(children);
  return (
    <div
      role="group"
      aria-label={label}
      className="ds-tile ds-enter group/conn overflow-hidden transition-colors duration-300 hover:border-[var(--ds-tile-border-hover)]"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4 sm:p-5">
        <ConnectionLogo>{logo}</ConnectionLogo>
        <div className="min-w-0 flex-1 basis-48">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold leading-5 text-foreground">{name}</h3>
            {status ? (
              <ConnectionStatus tone={status.tone} text={status.text} />
            ) : (
              <Skeleton className="h-5 w-20 rounded-full" />
            )}
          </div>
          <p className="mt-0.5 truncate text-[13px] leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
        {actions && (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            {actions}
          </div>
        )}
      </div>
      {facts && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-4 sm:px-5 sm:pb-5 sm:pl-[84px]">{facts}</div>
      )}
      {note && (
        <p className="flex items-start gap-2 border-t border-[var(--ds-tile-border)] px-4 py-3 text-[12px] leading-5 text-muted-foreground sm:px-5">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0">{note}</span>
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 border-t border-[var(--ds-tile-border)] px-4 py-3 text-[12px] leading-5 text-destructive sm:px-5"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">{error}</span>
        </p>
      )}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.32, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="border-t border-[var(--ds-tile-border)] px-4 py-5 sm:px-5">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
