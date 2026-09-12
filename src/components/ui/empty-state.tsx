"use client";

/**
 * EmptyState — the one way this app says "there is nothing here yet".
 *
 * Twenty-six components used to draw their own, and most of them stopped at a
 * sentence fragment in a dashed box ("Nothing yet.", "No audit yet") or, in the
 * asset library's case, a dashed square containing a folder icon and no words
 * at all. An empty state is a real screen a user lands on, so it gets the same
 * three parts every time: what this area holds, why it is empty, and the one
 * action that fills it.
 *
 * Use `ErrorState` when the area is empty because something *failed* — an
 * error rendered as "you have no assets" is worse than no message, because the
 * user stops looking for the problem.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AlertTriangle, RefreshCw, type LucideIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";

type Size = "sm" | "md";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  size = "md",
  className,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  /** One sentence. If there is nothing worth saying, leave it out. */
  description?: ReactNode;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  /** "sm" for inside a panel or sidebar, "md" for a full surface. */
  size?: Size;
  className?: string;
}) {
  const compact = size === "sm";
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-16",
        className,
      )}
    >
      {Icon ? (
        <span
          aria-hidden
          className={cn(
            "grid shrink-0 place-items-center rounded-2xl bg-surface-2 text-muted-foreground ring-1 ring-border",
            compact ? "size-9" : "size-12",
          )}
        >
          <Icon className={compact ? "size-4" : "size-5"} />
        </span>
      ) : null}

      <div className={cn("max-w-prose", compact ? "space-y-1" : "space-y-1.5")}>
        <p className={cn("font-medium text-foreground", compact ? "text-sm" : "text-base")}>
          {title}
        </p>
        {description ? (
          <p
            className={cn(
              "text-balance text-muted-foreground",
              compact ? "text-xs leading-relaxed" : "text-sm leading-relaxed",
            )}
          >
            {description}
          </p>
        ) : null}
      </div>

      {action || secondaryAction ? (
        <div
          className={cn(
            "flex flex-wrap items-center justify-center gap-2",
            compact ? "mt-1" : "mt-2",
          )}
        >
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}

/**
 * ErrorState — something went wrong, said plainly, with a way forward.
 *
 * `detail` is for the machine-readable part (a message, a status). It is shown
 * because "Something went wrong. Please try again." with the cause discarded
 * gives the user nothing to act on and nothing to report.
 */
export function ErrorState({
  title = "That didn't load",
  description,
  detail,
  onRetry,
  retryLabel = "Try again",
  action,
  size = "md",
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  detail?: string | null;
  onRetry?: () => void;
  retryLabel?: string;
  action?: ReactNode;
  size?: Size;
  className?: string;
}) {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  return (
    <EmptyState
      size={size}
      className={className}
      icon={AlertTriangle}
      title={offline ? "You're offline" : title}
      description={
        <>
          {offline
            ? "Reconnect and this will load again."
            : (description ?? "The request didn't come back. This is usually temporary.")}
          {detail && !offline ? (
            <span className="mt-1.5 block break-words font-mono text-xs text-muted-foreground/80">
              {detail}
            </span>
          ) : null}
        </>
      }
      action={
        onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="size-4" />
            {retryLabel}
          </Button>
        ) : (
          action
        )
      }
      secondaryAction={onRetry ? action : undefined}
    />
  );
}
