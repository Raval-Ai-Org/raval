"use client";
// Small pieces the Inbox shares.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

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
