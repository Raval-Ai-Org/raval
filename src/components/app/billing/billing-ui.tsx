"use client";

// Small building blocks shared by the billing screens. Tokens and pills follow
// docs/design-system.md: one lime primary action, quiet outlined pills, soft tiles.

import type { ReactNode } from "react";
import { Check, Lock } from "@/components/icons";
import { dsGhostBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { PLANS, type BillingInterval, type PlanId } from "@/lib/billing/catalog";
import { cn } from "@/lib/utils";

/** Monthly / Yearly switch. */
export function IntervalToggle({
  value,
  onChange,
}: {
  value: BillingInterval;
  onChange: (value: BillingInterval) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Billing period"
      className="inline-flex items-center gap-1 rounded-full bg-[var(--ds-well-bg)] p-1 text-[13px]"
    >
      {(["month", "year"] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full px-4 font-medium transition-colors",
            value === option
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option === "month" ? "Monthly" : "Yearly"}
          {option === "year" && (
            <span className="rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold text-primary">
              2 months free
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** How much of an allowance is left. `total` 0 = nothing included. */
export function UsageBar({
  label,
  left,
  total,
  note,
}: {
  label: string;
  left: number;
  total: number;
  note?: ReactNode;
}) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, left / total)) : left > 0 ? 1 : 0;
  const tone = left <= 0 ? "bg-destructive" : ratio <= 0.2 ? "bg-warning" : "bg-primary";
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">{note}</span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-[var(--ds-well-bg)]"
        role="meter"
        aria-label={`${label} left`}
        aria-valuemin={0}
        aria-valuemax={Math.max(total, left)}
        aria-valuenow={left}
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", tone)}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>
    </div>
  );
}

export function PrimaryButton({
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(dsPrimaryBtn, "h-10 px-5 text-[13.5px]", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(dsGhostBtn, "h-10 px-4 text-[13.5px]", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

/** "🔒 Growth" — the plan a locked feature needs. */
export function PlanLock({ plan, className }: { plan: PlanId; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-semibold text-primary",
        className,
      )}
    >
      <Lock className="h-3 w-3" strokeWidth={2.4} aria-hidden />
      {PLANS[plan].label}
    </span>
  );
}

/** A quiet success message. */
export function DoneNote({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-[var(--ds-radius-tile)] bg-primary/10 p-4 text-[13.5px]">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
        <Check className="h-4 w-4" strokeWidth={2.6} />
      </span>
      <div>
        <p className="font-semibold">{title}</p>
        {children && <div className="mt-0.5 text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}
