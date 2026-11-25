"use client";
// Small pieces the Inbox tabs share.
import type { ReactNode } from "react";
import { PlatformAppIcon } from "@/components/brand/PlatformAppIcon";
import { cn } from "@/lib/utils";
import type { EngagePlatform } from "@/lib/engage/contracts";

export const engageKeys = {
  home: (ws: string) => ["engage", ws, "home"] as const,
  posts: (ws: string) => ["engage", ws, "posts"] as const,
};

export function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins || 1} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString("en", { day: "numeric", month: "short" });
}

/** A small rounded label. */
export function Chip({
  children,
  tone = "default",
  className,
}: {
  children: ReactNode;
  tone?: "default" | "primary" | "success" | "warning" | "destructive";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 truncate rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        tone === "default" && "bg-foreground/[0.06] text-foreground/75",
        tone === "primary" && "bg-primary/15 text-primary-ink",
        tone === "success" && "bg-success/12 text-success",
        tone === "warning" && "bg-warning/12 text-warning",
        tone === "destructive" && "bg-destructive/10 text-destructive",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A pill-shaped choice in a row of choices. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  disabled,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string; hint?: string }[];
  disabled?: boolean;
}) {
  return (
    <div
      className="inline-flex flex-wrap gap-0.5 rounded-full bg-[var(--ds-well-bg)] p-1"
      role="radiogroup"
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          title={o.hint}
          disabled={disabled}
          onClick={() => onChange(o.id)}
          className={cn(
            "h-8 rounded-full px-3.5 text-[13px] font-semibold transition-colors",
            o.id === value
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Instagram / Facebook toggles shown by their app icons. */
export function PlatformToggles({
  value,
  onChange,
  disabled,
}: {
  value: EngagePlatform[];
  onChange: (v: EngagePlatform[]) => void;
  disabled?: boolean;
}) {
  const all: EngagePlatform[] = ["instagram", "facebook"];
  return (
    <div className="flex gap-2">
      {all.map((p) => {
        const on = value.includes(p);
        return (
          <button
            key={p}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            aria-label={p === "instagram" ? "Instagram" : "Facebook"}
            onClick={() => onChange(on ? value.filter((v) => v !== p) : [...value, p])}
            className={cn(
              "grid size-11 place-items-center rounded-2xl border transition-all",
              on
                ? "border-foreground/30 bg-card shadow-sm"
                : "border-transparent bg-[var(--ds-well-bg)] opacity-45 grayscale hover:opacity-80",
            )}
          >
            <PlatformAppIcon platform={p} size={28} />
          </button>
        );
      })}
    </div>
  );
}
