"use client";

import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type ConnectionTone = "connected" | "attention" | "off";

const TONE: Record<ConnectionTone, string> = {
  connected: "bg-success/12 text-success",
  attention: "bg-warning/12 text-warning",
  off: "bg-[var(--ds-well-bg)] text-muted-foreground",
};

/**
 * The one card every app connection in Settings uses: mark, name, status,
 * a line of what it does, the actions, then optional settings underneath.
 */
export function ConnectionCard({
  label,
  logo,
  name,
  description,
  status,
  detail,
  actions,
  note,
  error,
  children,
}: {
  label: string;
  logo: ReactNode;
  name: string;
  description: ReactNode;
  /** `null` while the status is loading. */
  status: { tone: ConnectionTone; text: string } | null;
  /** A quiet second line: who connected it, when it last ran. */
  detail?: ReactNode;
  actions?: ReactNode;
  /** Something a person should know before it works (not an error). */
  note?: ReactNode;
  error?: string | null;
  children?: ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className="ds-tile overflow-hidden">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3 p-4 sm:p-5">
        <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[var(--ds-well-bg)]">
          {logo}
        </div>
        <div className="min-w-0 flex-1 basis-72">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-foreground">{name}</h3>
            {status ? (
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                  TONE[status.tone],
                )}
              >
                {status.text}
              </span>
            ) : (
              <Skeleton className="h-5 w-20 rounded-full" />
            )}
          </div>
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{description}</p>
          {detail && <p className="mt-1 text-[12px] text-muted-foreground">{detail}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {note && (
        <p className="border-t border-[var(--ds-tile-border)] px-4 py-3 text-[12px] leading-5 text-muted-foreground sm:px-5">
          {note}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="border-t border-[var(--ds-tile-border)] px-4 py-3 text-[12px] leading-5 text-destructive sm:px-5"
        >
          {error}
        </p>
      )}
      {children && (
        <div className="border-t border-[var(--ds-tile-border)] px-4 py-5 sm:px-5">{children}</div>
      )}
    </div>
  );
}
