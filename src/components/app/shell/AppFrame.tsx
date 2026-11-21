"use client";

// Mellox 2.0's frame (ADR-0044). The app fills the screen on plain white.
// Inside the workspace the sidebar and top bar sit on that white and every
// screen happens on `AppCanvas`, Holo's rounded panel with a soft Mox wash.
// Pages without a sidebar (onboarding, projects) keep a faint aurora instead.
// `data-mellox-app` turns on the in-app styling; the landing page never has it.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function AppFrame({
  children,
  className,
  windowClassName,
  plain = false,
}: {
  children: ReactNode;
  className?: string;
  windowClassName?: string;
  /** No aurora: the workspace draws its own canvas. */
  plain?: boolean;
}) {
  return (
    <div
      data-mellox-app
      className={cn(
        "relative flex h-[100dvh] min-h-0 w-full min-w-0 bg-[var(--ds-frame-bg)]",
        className,
      )}
    >
      <div
        className={cn(
          "ds-frame relative flex min-h-0 min-w-0 flex-1 overflow-hidden",
          windowClassName,
        )}
      >
        {!plain && <div aria-hidden className="ds-aurora pointer-events-none absolute inset-0" />}
        <div className="relative flex min-h-0 min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

/** Holo's canvas: the rounded, softly tinted panel every screen sits on. */
export function AppCanvas({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-workspace-canvas
      className={cn(
        "ds-canvas relative flex min-h-0 min-w-0 flex-1 overflow-hidden lg:rounded-tl-[var(--ds-canvas-radius)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
