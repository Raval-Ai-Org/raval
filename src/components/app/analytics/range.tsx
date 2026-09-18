"use client";

// Analytics date range: presets (7 / 28 / 90 days) or a custom span of up to
// 90 days, always compared with the previous period of the same length.
// The choice is a per-viewer convenience kept in localStorage.
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { CalendarRange, ChevronDown } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  addDays,
  MAX_CUSTOM_DAYS,
  PRESET_LABELS,
  RANGE_PRESETS,
  RangeInputSchema,
  resolveRange,
  todayIn,
  type RangeInput,
} from "@/lib/analytics/ranges";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "analytics:range";

type RangeState = {
  range: RangeInput;
  setRange: (r: RangeInput) => void;
  /** Stable string for React Query keys. */
  key: string;
  /** Length in days of the chosen window (for legacy "days" consumers). */
  days: number;
  label: string;
};

const Ctx = createContext<RangeState | null>(null);

export function AnalyticsRangeProvider({ children }: { children: React.ReactNode }) {
  const [range, setRangeState] = useState<RangeInput>({ preset: "28d" });
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? RangeInputSchema.safeParse(JSON.parse(raw)) : null;
      if (parsed?.success) setRangeState(parsed.data);
    } catch {
      /* storage unavailable — keep the default */
    }
  }, []);
  const value = useMemo<RangeState>(() => {
    const resolved = resolveRange(range, todayIn(undefined));
    return {
      range,
      key: "preset" in range ? range.preset : `${range.from}_${range.to}`,
      days: resolved.current.days,
      label: resolved.label,
      setRange: (r) => {
        setRangeState(r);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(r));
        } catch {
          /* ignore */
        }
      },
    };
  }, [range]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAnalyticsRange(): RangeState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAnalyticsRange must be used inside AnalyticsRangeProvider");
  return v;
}

export function RangeBar({ className }: { className?: string }) {
  const { range, setRange } = useAnalyticsRange();
  const [open, setOpen] = useState(false);
  const today = todayIn(undefined);
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(addDays(today, -1));
  const custom = { from, to };
  const valid = RangeInputSchema.safeParse(custom);
  const isCustom = !("preset" in range);

  return (
    <div
      role="group"
      aria-label="Date range"
      className={cn(
        "inline-flex items-center rounded-full border border-border bg-card/80 p-0.5 text-[11.5px]",
        className,
      )}
    >
      {RANGE_PRESETS.map((p) => {
        const active = "preset" in range && range.preset === p;
        return (
          <button
            key={p}
            type="button"
            aria-pressed={active}
            title={PRESET_LABELS[p]}
            onClick={() => setRange({ preset: p })}
            className={cn(
              "rounded-full px-2.5 py-1 font-medium tabular-nums transition",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {p.replace("d", " days")}
          </button>
        );
      })}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-pressed={isCustom}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium transition",
              isCustom
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <CalendarRange className="h-3 w-3" aria-hidden />
            {isCustom ? `${range.from.slice(5)} – ${range.to.slice(5)}` : "Custom"}
            <ChevronDown className="h-3 w-3 opacity-60" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 space-y-3 p-3 text-[12px]">
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-muted-foreground">From</span>
              <input
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1"
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground">To</span>
              <input
                type="date"
                value={to}
                min={from}
                max={today}
                onChange={(e) => setTo(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1"
              />
            </label>
          </div>
          {!valid.success && (
            <p className="text-destructive">
              {valid.error.issues[0]?.message ?? `Choose up to ${MAX_CUSTOM_DAYS} days.`}
            </p>
          )}
          <button
            type="button"
            disabled={!valid.success}
            onClick={() => {
              if (!valid.success) return;
              setRange(valid.data);
              setOpen(false);
            }}
            className="w-full rounded-full bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-50"
          >
            Apply
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
