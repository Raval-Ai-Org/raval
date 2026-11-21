"use client";

// Shared pieces of the admin home, Customers, Activity and Errors pages: the
// two data hooks (pulse and balances), plan colours, gauges, the plan donut,
// credit bars and count-up numbers. Pictures first, few words.

import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { AdminBalances, AdminPulse } from "@/lib/admin/types";
import { UNITS_PER_CREDIT } from "@/lib/billing/catalog";
import { cn } from "@/lib/utils";
import { adminApi } from "./api";

export const pulseKey = ["admin", "pulse"] as const;
export const balancesKey = ["admin", "balances"] as const;

export function usePulse() {
  return useQuery({
    queryKey: pulseKey,
    queryFn: () => adminApi<AdminPulse>("/api/admin/pulse"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/** Read live balances once on open; "Fetch" asks again. */
export function useBalances() {
  return useQuery({
    queryKey: balancesKey,
    queryFn: () => adminApi<AdminBalances>("/api/admin/balances"),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

// ── Colours ────────────────────────────────────────────────────────────────

export const PLAN_COLORS: Record<string, string> = {
  starter: "#9cf03f",
  growth: "#1fd6c4",
  agency: "#7c6cf2",
  scale: "#f5a524",
  free: "#b8bec9",
};
export const planColor = (id: string) => PLAN_COLORS[id] ?? "#94a3b8";

export const SERIES = {
  activeUsers: { label: "Active people", color: "#1fd6c4" },
  signups: { label: "Sign-ups", color: "#7c6cf2" },
  workspaces: { label: "New workspaces", color: "#f5a524" },
  pieces: { label: "Pieces made", color: "#3fbf5a" },
  errors: { label: "Errors", color: "#e5484d" },
} as const;
export type SeriesKey = keyof typeof SERIES;

// ── Formatting ─────────────────────────────────────────────────────────────

export function credits(units: number): string {
  const value = Math.max(0, units) / UNITS_PER_CREDIT;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  return value >= 100 ? Math.round(value).toLocaleString() : String(Math.round(value * 10) / 10);
}

export function minutes(value: number): string {
  if (value <= 0) return "0m";
  if (value < 60) return `${value}m`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function usd(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value >= 1000 ? 0 : digits,
    maximumFractionDigits: value >= 1000 ? 0 : digits,
  });
}

export function cents(amount: number, currency: string): string {
  try {
    return (amount / 100).toLocaleString("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: amount >= 100_000 ? 0 : 2,
    });
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export function personName(row: { name: string | null; email: string | null }): string {
  return row.name?.trim() || row.email || "Unnamed person";
}

export function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// ── Animated number ────────────────────────────────────────────────────────

/** Counts up to `value` once when it first appears (respects reduced motion). */
export function CountUp({
  value,
  format = (n) => Math.round(n).toLocaleString(),
}: {
  value: number;
  format?: (value: number) => string;
}) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const tick = (time: number) => {
      const t = Math.min(1, (time - start) / 700);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(origin + (value - origin) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <span className="tabular-nums">{format(shown)}</span>;
}

// ── Cards ──────────────────────────────────────────────────────────────────

/** A raised card with a soft top light, the unit of the admin home. */
export function Card({
  children,
  className,
  title,
  icon: Icon,
  action,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  action?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "ds-enter relative min-w-0 overflow-hidden rounded-[22px] border border-[var(--ds-tile-border)] bg-[var(--ds-tile-bg)] p-4 shadow-[0_1px_0_hsl(0_0%_100%/0.6)_inset,0_18px_40px_-28px_hsl(220_30%_20%/0.35)] sm:p-5",
        className,
      )}
    >
      {(title || action) && (
        <header className="mb-3 flex min-w-0 items-center justify-between gap-3">
          {title && (
            <h3 className="flex min-w-0 items-center gap-2 text-[13.5px] font-semibold">
              {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
              <span className="truncate">{title}</span>
            </h3>
          )}
          {action}
        </header>
      )}
      {children}
    </div>
  );
}

/** A big number with an icon bubble and a one-line hint. */
export function Kpi({
  label,
  value,
  hint,
  icon: Icon,
  color,
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: ComponentType<{ className?: string }>;
  color: string;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "ds-enter group relative min-w-0 overflow-hidden rounded-[20px] border border-[var(--ds-tile-border)] bg-[var(--ds-tile-bg)] p-4 text-left shadow-[0_14px_30px_-24px_hsl(220_30%_20%/0.4)] transition-transform duration-300",
        onClick && "hover:-translate-y-0.5 hover:shadow-[0_22px_40px_-26px_hsl(220_30%_20%/0.5)]",
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -right-6 -top-6 size-24 rounded-full opacity-20 blur-2xl"
        style={{ background: color }}
      />
      <span
        className="grid size-9 place-items-center rounded-xl text-white shadow-[0_8px_16px_-8px_currentColor]"
        style={{ background: color, color }}
      >
        <Icon className="size-4 text-white" />
      </span>
      <div className="mt-3 text-[26px] font-semibold leading-none tracking-tight">{value}</div>
      <div className="mt-1.5 truncate text-[12.5px] font-medium text-muted-foreground">{label}</div>
      {hint && <div className="mt-1 truncate text-[11.5px] text-muted-foreground/80">{hint}</div>}
    </Tag>
  );
}

// ── Gauges and bars ────────────────────────────────────────────────────────

/** A round gauge: `value` of `max`, coloured by how full it is. */
export function Ring({
  value,
  max,
  size = 76,
  stroke = 9,
  color,
  children,
}: {
  value: number;
  max: number;
  size?: number;
  stroke?: number;
  color?: string;
  children?: ReactNode;
}) {
  const share = max > 0 ? Math.max(0, Math.min(1, value / max)) : value > 0 ? 1 : 0;
  const radius = (size - stroke) / 2;
  const length = 2 * Math.PI * radius;
  const tone = color ?? (share >= 0.5 ? "#3fbf5a" : share >= 0.2 ? "#f5a524" : "#e5484d");
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-foreground/[0.07]"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - share)}
          style={{ transition: "stroke-dashoffset 900ms cubic-bezier(0.16,1,0.3,1)" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

/** How much of the plan's monthly credits are left. */
export function CreditBar({
  left,
  allowance,
  compact,
}: {
  left: number;
  allowance: number;
  compact?: boolean;
}) {
  const share = allowance > 0 ? Math.min(1, left / allowance) : left > 0 ? 1 : 0;
  const tone =
    allowance === 0 ? "#b8bec9" : share >= 0.5 ? "#3fbf5a" : share >= 0.2 ? "#f5a524" : "#e5484d";
  return (
    <div className={cn("min-w-0", compact ? "w-28" : "w-full")}>
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="font-semibold tabular-nums">{credits(left)}</span>
        {allowance > 0 && (
          <span className="text-muted-foreground tabular-nums">/ {credits(allowance)}</span>
        )}
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-foreground/[0.07]">
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.round(share * 100)}%`,
            background: tone,
            transition: "width 800ms cubic-bezier(0.16,1,0.3,1)",
          }}
        />
      </div>
    </div>
  );
}

/** A horizontal bar row: label, bar, value. */
export function BarRow({
  label,
  value,
  max,
  color,
  display,
  onClick,
}: {
  label: ReactNode;
  value: number;
  max: number;
  color: string;
  display?: ReactNode;
  onClick?: () => void;
}) {
  const share = max > 0 ? value / max : 0;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "grid w-full grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 rounded-lg px-1 py-1 text-left text-[12.5px]",
        onClick && "hover:bg-foreground/[0.04]",
      )}
    >
      <span className="truncate">{label}</span>
      <span className="h-2.5 overflow-hidden rounded-full bg-foreground/[0.06]">
        <span
          className="block h-full rounded-full"
          style={{
            width: `${Math.max(share > 0 ? 3 : 0, Math.round(share * 100))}%`,
            background: color,
            transition: "width 800ms cubic-bezier(0.16,1,0.3,1)",
          }}
        />
      </span>
      <span className="min-w-10 text-right font-semibold tabular-nums">{display ?? value}</span>
    </Tag>
  );
}

// ── Plan donut ─────────────────────────────────────────────────────────────

export function PlanDonut({
  plans,
  onPick,
  size = 170,
}: {
  plans: AdminPulse["plans"];
  onPick?: (planId: string) => void;
  size?: number;
}) {
  const total = plans.reduce((sum, plan) => sum + plan.accounts, 0);
  const paying = plans.filter((p) => p.planId !== "free").reduce((s, p) => s + p.accounts, 0);
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={plans}
              dataKey="accounts"
              nameKey="label"
              innerRadius={size * 0.32}
              outerRadius={size * 0.48}
              paddingAngle={plans.length > 1 ? 2 : 0}
              stroke="none"
              cornerRadius={6}
              onClick={(entry: { planId?: string }) => entry.planId && onPick?.(entry.planId)}
              className={onPick ? "cursor-pointer" : undefined}
            >
              {plans.map((plan) => (
                <Cell key={plan.planId} fill={planColor(plan.planId)} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number, name: string) => [`${value} people`, name]}
              contentStyle={{ borderRadius: 12, fontSize: 12 }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="text-[24px] font-semibold leading-none tabular-nums">{paying}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">paying</div>
          </div>
        </div>
      </div>
      <ul className="grid w-full min-w-0 gap-1.5">
        {plans.map((plan) => (
          <li key={plan.planId}>
            <button
              type="button"
              disabled={!onPick}
              onClick={() => onPick?.(plan.planId)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-foreground/[0.04] disabled:hover:bg-transparent"
            >
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: planColor(plan.planId) }}
              />
              <span className="min-w-0 flex-1 truncate">{plan.label}</span>
              <span className="font-semibold tabular-nums">{plan.accounts}</span>
              <span className="w-10 text-right text-[11.5px] text-muted-foreground tabular-nums">
                {total ? Math.round((plan.accounts / total) * 100) : 0}%
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── People ─────────────────────────────────────────────────────────────────

const AVATAR_TONES = ["#1fd6c4", "#7c6cf2", "#f5a524", "#3fbf5a", "#e86fb1", "#4f8ef7"];

export function Avatar({ name, id, size = 32 }: { name: string; id: string; size?: number }) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const initials =
    name
      .replace(/@.*/, "")
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?";
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: AVATAR_TONES[hash % AVATAR_TONES.length],
      }}
    >
      {initials}
    </span>
  );
}

export function PlanPill({ planId, label }: { planId: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-foreground/[0.05] px-2.5 py-0.5 text-[11.5px] font-medium">
      <span className="size-2 rounded-full" style={{ background: planColor(planId) }} />
      {label}
    </span>
  );
}

/** Pill tabs used as filters on the pulse pages. */
export function Pills<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (value: T) => void;
  items: Array<{ id: T; label: ReactNode; count?: number; color?: string }>;
}) {
  return (
    <div className="flex min-w-0 max-w-full gap-1.5 overflow-x-auto pb-1">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
            value === item.id
              ? "border-foreground bg-foreground text-background"
              : "border-[var(--ds-tile-border)] bg-[var(--ds-tile-bg)] hover:bg-foreground/[0.04]",
          )}
        >
          {item.color && (
            <span className="size-2 rounded-full" style={{ background: item.color }} />
          )}
          {item.label}
          {item.count !== undefined && (
            <span
              className={cn(
                "tabular-nums",
                value === item.id ? "opacity-70" : "text-muted-foreground",
              )}
            >
              {item.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
