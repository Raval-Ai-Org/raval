"use client";

// Small building blocks shared by the billing screens: the monthly/annual
// switch, a usage bar, plan cards and pack cards. Tokens and pills follow
// docs/design-system.md.

import type { ReactNode } from "react";
import { Check, Lock, Sparkles } from "@/components/icons";
import { dsGhostBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { PLANS, type BillingInterval, type PlanId } from "@/lib/billing/catalog";
import { formatNumber, formatUsd, planPrice } from "@/lib/billing/present";
import { cn } from "@/lib/utils";

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
            "inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 font-medium transition-colors",
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

/** Remaining balance of one allowance. `total` is this month's allowance (0 = none). */
export function UsageBar({
  label,
  left,
  total,
  leftText,
  hint,
}: {
  label: string;
  left: number;
  total: number;
  leftText: string;
  hint?: ReactNode;
}) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, left / total)) : left > 0 ? 1 : 0;
  const tone = left <= 0 ? "bg-destructive" : ratio <= 0.2 ? "bg-warning" : "bg-primary";
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
        <span className="text-[15px] font-semibold tabular-nums">{leftText}</span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-[var(--ds-well-bg)]"
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
      {hint && <p className="text-[12px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function PlanCard({
  plan,
  interval,
  current,
  highlighted,
  action,
  compact,
}: {
  plan: PlanId;
  interval: BillingInterval;
  current?: boolean;
  highlighted?: boolean;
  action?: ReactNode;
  compact?: boolean;
}) {
  const def = PLANS[plan];
  const price = planPrice(plan, interval);
  return (
    <article
      className={cn(
        "ds-tile relative flex flex-col p-5",
        highlighted && "ring-2 ring-primary/60",
        current && !highlighted && "ring-1 ring-foreground/15",
      )}
    >
      {(def.badge || current) && (
        <span
          className={cn(
            "absolute -top-2.5 left-5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
            current ? "bg-foreground text-background" : "bg-primary text-primary-foreground",
          )}
        >
          {current ? "Your plan" : def.badge}
        </span>
      )}
      <h4 className="text-[15px] font-semibold">{def.label}</h4>
      <p className="mt-2 flex items-baseline gap-1">
        <span className="text-[28px] font-semibold tracking-tight tabular-nums">
          {formatUsd(Math.round(price.perMonth))}
        </span>
        <span className="text-[13px] text-muted-foreground">
          {plan === "free" ? "" : "/ month"}
        </span>
      </p>
      <p className="min-h-[18px] text-[12px] text-muted-foreground">
        {plan === "free"
          ? "Free forever"
          : interval === "year"
            ? `${formatUsd(price.billed)} a year · save ${formatUsd(price.savings)}`
            : "Billed monthly"}
      </p>
      {!compact && <p className="mt-3 text-[13px] text-foreground/80">{def.tagline}</p>}
      <ul className="mt-4 flex-1 space-y-2 text-[13px]">
        {def.highlights.slice(0, compact ? 4 : 6).map((line) => (
          <li key={line} className="flex gap-2">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2.4} />
            <span>{line}</span>
          </li>
        ))}
      </ul>
      {action && <div className="mt-5">{action}</div>}
    </article>
  );
}

export function PackCard({
  title,
  subtitle,
  price,
  bonus,
  action,
}: {
  title: string;
  subtitle: string;
  price: number;
  bonus?: string;
  action?: ReactNode;
}) {
  return (
    <div className="ds-tile flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[15px] font-semibold tabular-nums">{title}</p>
          <p className="text-[12px] text-muted-foreground">{subtitle}</p>
        </div>
        <p className="text-[15px] font-semibold tabular-nums">{formatUsd(price)}</p>
      </div>
      {bonus && (
        <span className="inline-flex w-fit items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-semibold text-primary">
          <Sparkles className="h-3 w-3" /> {bonus}
        </span>
      )}
      {action}
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

export function LockHint({ plan }: { plan: PlanId }) {
  return (
    <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
      <Lock className="h-3 w-3" /> {PLANS[plan].label}
    </span>
  );
}

export function SentNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-[var(--ds-radius-well)] bg-primary/10 p-3 text-[13px]">
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={2.4} />
      <div>{children}</div>
    </div>
  );
}

export { formatNumber };
