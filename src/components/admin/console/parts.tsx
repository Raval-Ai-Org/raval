"use client";

// Shared building blocks for the admin screens: a search field, a pager, a
// status chip and a labelled field. Styling follows docs/design-system.md.

import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Search } from "@/components/icons";
import { dsGhostBtn } from "@/components/app/surface/buttons";
import { cn } from "@/lib/utils";
import { fmtNumber, pageCount } from "./format";

export const fieldClass =
  "h-9 w-full rounded-full bg-[var(--ds-well-bg)] px-3.5 text-[13px] outline-none ring-primary/40 placeholder:text-muted-foreground focus-visible:ring-2";

export const textareaClass =
  "min-h-[76px] w-full resize-y rounded-2xl bg-[var(--ds-well-bg)] px-3.5 py-2.5 text-[13px] outline-none ring-primary/40 placeholder:text-muted-foreground focus-visible:ring-2";

/** A search box that waits for the typing to pause before it tells the page. */
export function SearchField({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  label: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return;
    const timer = setTimeout(() => onChange(text), 350);
    return () => clearTimeout(timer);
  }, [text, value, onChange]);
  return (
    <label className="relative block min-w-[220px] max-w-sm flex-1">
      <span className="sr-only">{label}</span>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={placeholder}
        className={cn(fieldClass, "pl-9")}
        autoComplete="off"
        spellCheck={false}
      />
    </label>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (next: number) => void;
}) {
  const pages = pageCount(total, pageSize);
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[12.5px] text-muted-foreground">
      <span aria-live="polite">
        {total === 0
          ? "No results"
          : `${fmtNumber(first)}–${fmtNumber(last)} of ${fmtNumber(total)}`}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={cn(dsGhostBtn, "h-8 w-8")}
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="tabular-nums">
          {page} / {pages}
        </span>
        <button
          type="button"
          className={cn(dsGhostBtn, "h-8 w-8")}
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

const CHIP_TONES = {
  neutral: "bg-foreground/[0.06] text-foreground/75",
  primary: "bg-primary/12 text-primary",
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
  danger: "bg-destructive/12 text-destructive",
} as const;

export function Chip({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof CHIP_TONES;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-medium",
        CHIP_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[12.5px] font-medium text-foreground/80">{label}</span>
      {children}
      {hint && <span className="block text-[12px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** Label and value, for the facts on a detail page. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-[13.5px]">{children}</dd>
    </div>
  );
}

/** A scrollable table frame so wide tables never push the page sideways. */
export function TableFrame({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="ds-tile overflow-x-auto p-0">
      <table
        className="w-full min-w-[640px] border-collapse text-left text-[13px]"
        aria-label={label}
      >
        {children}
      </table>
    </div>
  );
}

export const th =
  "px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground";
export const td = "px-4 py-3 align-middle";
export const rowClass = "border-t border-border/50 transition-colors hover:bg-foreground/[0.03]";
