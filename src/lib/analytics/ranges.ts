// ranges.ts — date ranges and previous-period comparison windows. Pure; all
// dates are calendar days ("YYYY-MM-DD") in the data source's own time zone
// (GA4: the property's zone; Search Console: America/Los_Angeles).
import { z } from "zod";

export const RANGE_PRESETS = ["7d", "28d", "90d"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const PRESET_DAYS: Record<RangePreset, number> = { "7d": 7, "28d": 28, "90d": 90 };
export const PRESET_LABELS: Record<RangePreset, string> = {
  "7d": "Last 7 days",
  "28d": "Last 28 days",
  "90d": "Last 90 days",
};

/** How much history the first sync loads: 90 days shown + a full previous 90. */
export const BACKFILL_DAYS = 180;
/** Longest custom range: its previous period must still fit the backfill. */
export const MAX_CUSTOM_DAYS = 90;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const RangeInputSchema = z.union([
  z.object({ preset: z.enum(RANGE_PRESETS) }).strict(),
  z
    .object({ from: z.string().regex(ISO_DATE), to: z.string().regex(ISO_DATE) })
    .strict()
    .refine((r) => isValidDate(r.from) && isValidDate(r.to), "Invalid date")
    .refine((r) => r.from <= r.to, "Start must be on or before end")
    .refine((r) => daysInclusive(r.from, r.to) <= MAX_CUSTOM_DAYS, "Choose 90 days or fewer"),
]);

export type RangeInput = z.infer<typeof RangeInputSchema>;

export type DateWindow = { from: string; to: string; days: number };

export type ResolvedRange = {
  current: DateWindow;
  previous: DateWindow;
  /** Stable cache key, e.g. "28d:2026-09-17" or "2026-08-01_2026-08-31". */
  key: string;
  preset: RangePreset | null;
  label: string;
};

export function isValidDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Inclusive day count between two dates (same day = 1). */
export function daysInclusive(from: string, to: string): number {
  return (
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
  );
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Today's calendar date in a time zone (falls back to UTC for an unknown zone). */
export function todayIn(timeZone: string | null | undefined, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

function windowEnding(to: string, days: number): DateWindow {
  return { from: addDays(to, -(days - 1)), to, days };
}

/** The window of the same length immediately before `current`. */
export function previousWindow(current: DateWindow): DateWindow {
  return windowEnding(addDays(current.from, -1), current.days);
}

/**
 * Resolve a preset or custom range against "today" in the source's zone.
 * Presets end yesterday — today is still being collected by every source.
 */
export function resolveRange(input: RangeInput, today: string): ResolvedRange {
  if ("preset" in input) {
    const days = PRESET_DAYS[input.preset];
    const current = windowEnding(addDays(today, -1), days);
    return {
      current,
      previous: previousWindow(current),
      key: `${input.preset}:${current.to}`,
      preset: input.preset,
      label: PRESET_LABELS[input.preset],
    };
  }
  const to = input.to > today ? today : input.to;
  const from = input.from > to ? to : input.from;
  const current = { from, to, days: daysInclusive(from, to) };
  return {
    current,
    previous: previousWindow(current),
    key: `${from}_${to}`,
    preset: null,
    label: `${from} – ${to}`,
  };
}

/**
 * Shift a preset window back so it ends on the last day the source has data
 * (Search Console lags ~2–3 days; GA4 ~1). Comparing a window with two missing
 * days against a full previous window would report a fake drop. Custom ranges
 * are left as chosen — the UI shows "data through …" instead.
 */
export function alignToData(range: ResolvedRange, lastDataDate: string | null): ResolvedRange {
  if (!range.preset || !lastDataDate || lastDataDate >= range.current.to) return range;
  const current = windowEnding(lastDataDate, range.current.days);
  return {
    ...range,
    current,
    previous: previousWindow(current),
    key: `${range.preset}:${current.to}`,
  };
}

/**
 * Whether the stored history covers a window: the earliest stored date is on
 * or before its start. Without it a previous-period comparison is refused
 * ("not enough history") rather than computed against missing days.
 */
export function covers(firstDataDate: string | null, window: DateWindow): boolean {
  return !!firstDataDate && firstDataDate <= window.from;
}

/** Short human label for a window, e.g. "Aug 21 – Sep 17". */
export function formatWindow(window: DateWindow): string {
  const fmt = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  return window.from === window.to ? fmt(window.from) : `${fmt(window.from)} – ${fmt(window.to)}`;
}
