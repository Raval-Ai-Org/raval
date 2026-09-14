"use client";

// Shared visual pieces for the AI Visibility panel: tones, score ring,
// sparkline, chips and formatting helpers. Everything reads design tokens
// (primary = Mellox lime, success/warning/destructive) — no one-off colours.

import { useEffect, type ComponentType } from "react";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import {
  AlertTriangle,
  Bot,
  CheckCircle,
  FileCode2,
  Gauge,
  Info,
  ListTree,
  Search,
  ShieldCheck,
  XCircle,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import type { FixSafety, GeoCategoryId, Priority, RuleStatus } from "@/lib/geo/types";

export type IconType = ComponentType<{ className?: string; strokeWidth?: number }>;
export type Tone = "success" | "warning" | "destructive" | "muted" | "primary";

export const TONE: Record<Tone, { text: string; chip: string; bar: string; stroke: string }> = {
  success: {
    text: "text-success",
    chip: "bg-success/10 text-success ring-success/25",
    bar: "bg-success",
    stroke: "hsl(var(--success))",
  },
  warning: {
    text: "text-warning",
    chip: "bg-warning/10 text-warning ring-warning/25",
    bar: "bg-warning",
    stroke: "hsl(var(--warning))",
  },
  destructive: {
    text: "text-destructive",
    chip: "bg-destructive/10 text-destructive ring-destructive/25",
    bar: "bg-destructive",
    stroke: "hsl(var(--destructive))",
  },
  muted: {
    text: "text-muted-foreground",
    chip: "bg-muted text-muted-foreground ring-border/60",
    bar: "bg-muted-foreground/40",
    stroke: "hsl(var(--muted-foreground))",
  },
  primary: {
    text: "text-primary",
    chip: "bg-primary/12 text-primary ring-primary/25",
    bar: "bg-primary",
    stroke: "hsl(var(--primary))",
  },
};

export const EASE = [0.22, 1, 0.36, 1] as const;

export const scoreTone = (score: number): Tone =>
  score >= 80 ? "success" : score >= 55 ? "warning" : "destructive";

export function scoreVerdict(score: number) {
  if (score >= 80)
    return { label: "Strong", line: "AI engines can confidently read and cite you." };
  if (score >= 55)
    return { label: "Workable", line: "A few fixes will lift how often you're cited." };
  return { label: "Needs work", line: "Below the bar for AI engines to cite you today." };
}

export const CATEGORY_ICON: Record<GeoCategoryId, IconType> = {
  ai_access: Bot,
  technical: Search,
  structured_data: FileCode2,
  content: ListTree,
  authority: ShieldCheck,
  performance: Gauge,
};

export const PRIORITY_META: Record<Priority, { label: string; tone: Tone }> = {
  critical: { label: "Critical", tone: "destructive" },
  high: { label: "High", tone: "destructive" },
  medium: { label: "Medium", tone: "warning" },
  low: { label: "Low", tone: "muted" },
};

export const SAFETY_META: Record<FixSafety, { label: string; hint: string }> = {
  auto_safe: { label: "Safe to apply", hint: "A standard, reversible markup change." },
  assisted: {
    label: "Review the draft",
    hint: "Adapt the suggestion to your content before publishing.",
  },
  manual_review: {
    label: "Needs verification",
    hint: "Involves facts, identity, legal or sourcing — check with the right person first.",
  },
};

export const btnFocus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background";
export const primaryBtn = cn(
  "inline-flex items-center justify-center gap-1.5 rounded-full bg-primary font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50",
  btnFocus,
);
export const ghostBtn = cn(
  "inline-flex items-center justify-center gap-1.5 rounded-full border border-border/70 bg-card font-medium text-foreground/85 transition-colors hover:border-foreground/20 hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50",
  btnFocus,
);

/* ───────────────────────── Formatting ───────────────────────── */

export function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(
      /^www\./,
      "",
    );
  } catch {
    return url.trim().toLowerCase();
  }
}

export const displayUrl = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

export function pathOf(url: string | null | undefined): string {
  if (!url) return "Site-wide";
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || "/";
  } catch {
    return url;
  }
}

export function relativeTime(iso: string | number | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const ts = typeof iso === "number" ? iso : Date.parse(iso);
  if (!Number.isFinite(ts)) return "—";
  const m = Math.round((now - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : new Date(ts).toLocaleDateString();
}

/* ───────────────────────── Pieces ───────────────────────── */

function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const mv = useMotionValue(0);
  const display = useTransform(mv, (v) => Math.round(v).toString());
  useEffect(() => {
    const controls = animate(mv, value, { duration: 1.1, ease: EASE });
    return controls.stop;
  }, [value, mv]);
  return <motion.span className={className}>{display}</motion.span>;
}

export function ScoreRing({
  value,
  size = 112,
  label = "AI visibility score",
}: {
  value: number;
  size?: number;
  label?: string;
}) {
  const stroke = size > 80 ? 9 : 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label} ${value} out of 100`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="hsl(var(--border))"
          strokeOpacity={0.6}
          strokeWidth={stroke}
          fill="none"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={TONE[scoreTone(value)].stroke}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c - (value / 100) * c }}
          transition={{ duration: 1.2, ease: EASE }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center" aria-hidden>
        <div className="flex items-baseline gap-0.5">
          <AnimatedNumber
            value={value}
            className={cn(
              "font-semibold tabular-nums tracking-tight text-foreground",
              size > 80 ? "text-[30px]" : "text-[17px]",
            )}
          />
          {size > 80 && <span className="text-[11px] font-medium text-muted-foreground">/100</span>}
        </div>
      </div>
    </div>
  );
}

export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 132;
  const h = 34;
  const pad = 4;
  const min = Math.min(...values);
  const span = Math.max(1, Math.max(...values) - min);
  const pts = values.map((v, i) => [
    pad + (i * (w - pad * 2)) / (values.length - 1),
    h - pad - ((v - min) / span) * (h - pad * 2),
  ]);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="text-primary"
      role="img"
      aria-label={`Score history: ${values.join(", ")}`}
    >
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lx} cy={ly} r={3} fill="currentColor" />
    </svg>
  );
}

export function PanelHeading({
  icon: Icon,
  title,
  hint,
  className,
  action,
}: {
  icon: IconType;
  title: string;
  hint?: string;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={cn("mb-2.5 flex min-w-0 items-center gap-2", className)}>
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary/12 text-primary">
        <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
      </span>
      <h3 className="truncate text-[14px] font-semibold text-foreground">{title}</h3>
      {hint && (
        <span className="hidden truncate text-[12px] text-muted-foreground sm:inline">{hint}</span>
      )}
      {action && <div className="ml-auto shrink-0">{action}</div>}
    </div>
  );
}

export function Chip({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1",
        TONE[tone].chip,
        className,
      )}
    >
      {children}
    </span>
  );
}

export function PriorityChip({ priority }: { priority: Priority }) {
  const meta = PRIORITY_META[priority];
  return (
    <Chip tone={meta.tone} className="uppercase tracking-wide">
      {meta.label}
    </Chip>
  );
}

export function StatusGlyph({ status, className }: { status: RuleStatus; className?: string }) {
  const cls = cn("h-4 w-4 shrink-0", className);
  if (status === "pass")
    return <CheckCircle className={cn(cls, "text-success")} strokeWidth={2.2} />;
  if (status === "warn")
    return <AlertTriangle className={cn(cls, "text-warning")} strokeWidth={2.2} />;
  if (status === "fail")
    return <XCircle className={cn(cls, "text-destructive")} strokeWidth={2.2} />;
  return <Info className={cn(cls, "text-muted-foreground/70")} strokeWidth={2} />;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex rounded-full border border-border/70 bg-card p-0.5 text-[12px]",
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "whitespace-nowrap rounded-full px-3 py-1 font-medium transition-colors",
            btnFocus,
            value === o.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function MiniBar({ value, tone }: { value: number; tone?: Tone }) {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-border/50">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        transition={{ duration: 0.7, ease: EASE }}
        className={cn("h-full rounded-full", TONE[tone ?? scoreTone(value)].bar)}
      />
    </div>
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
