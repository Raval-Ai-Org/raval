"use client";

// Mellox 2.0's frame (ADR-0044), Holo style: the app is a white window with
// round corners floating on Mox's gradient, with a faint lime / cyan aurora
// inside. On a phone the window fills the screen. `data-mellox-app` turns on
// the in-app styling (pills, white canvas); the landing page never has it.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function AppFrame({
  children,
  className,
  windowClassName,
}: {
  children: ReactNode;
  className?: string;
  windowClassName?: string;
}) {
  return (
    <div
      data-mellox-app
      className={cn(
        "ds-backdrop relative flex h-[100dvh] min-h-0 w-full min-w-0 lg:p-[var(--ds-frame-inset)]",
        className,
      )}
    >
      <div
        className={cn(
          "ds-frame relative flex min-h-0 min-w-0 flex-1 overflow-hidden max-lg:rounded-none",
          windowClassName,
        )}
      >
        <div aria-hidden className="ds-aurora pointer-events-none absolute inset-0" />
        <div className="relative flex min-h-0 min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
