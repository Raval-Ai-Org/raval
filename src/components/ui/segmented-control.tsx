"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Select a view without claiming the tab/panel relationship of a Tabs widget. */
export function SegmentedControl<T extends string>({
  label,
  value,
  onValueChange,
  options,
  className,
  itemClassName,
}: {
  label: string;
  value: T;
  onValueChange: (value: T) => void;
  options: readonly { value: T; label: ReactNode }[];
  className?: string;
  itemClassName?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-0.5 rounded-full bg-[var(--ds-well-bg)] p-1 text-muted-foreground",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onValueChange(option.value)}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium leading-tight transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            value === option.value &&
              "bg-background text-foreground shadow-sm dark:bg-white/[0.12]",
            itemClassName,
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
