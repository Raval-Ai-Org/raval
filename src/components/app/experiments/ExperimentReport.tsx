"use client";

// The client-facing experiment report. Used on the public share page and as
// the preview inside the app, so it only takes the report data (no fetching).
import type { DailyPoint, ExperimentReport } from "@/lib/experiments/contracts";
import { CHANGE_TYPE_LABELS, METRIC_LABELS } from "@/lib/experiments/contracts";

const VERDICT: Record<string, { label: string; tone: string }> = {
  win: { label: "The change helped", tone: "text-emerald-600 dark:text-emerald-400" },
  loss: { label: "The change hurt", tone: "text-red-600 dark:text-red-400" },
  inconclusive: { label: "No clear difference", tone: "text-muted-foreground" },
};

export function formatLift(lift: number | null): string {
  if (lift === null || !Number.isFinite(lift)) return "—";
  const v = Math.round(lift * 1000) / 10;
  return `${v > 0 ? "+" : ""}${v}%`;
}

export function formatMoney(value: number | null, currency: string | null): string | null {
  if (value === null || !currency) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${Math.round(value)} ${currency}`;
  }
}

/** Test pages vs what they'd have done without the change, from the live date on. */
export function ResultChart({ daily, height = 160 }: { daily: DailyPoint[]; height?: number }) {
  const points = daily.slice(-90);
  if (points.length < 2) return null;
  const w = 600;
  const h = height;
  const pad = 6;
  const max = Math.max(1, ...points.flatMap((p) => [p.treatment, p.expected]));
  const x = (i: number) => pad + (i / (points.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const line = (key: "treatment" | "expected") =>
    points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  const liveIndex = points.findIndex((p) => p.period === "post");
  return (
    <figure className="space-y-2">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full h-auto"
        role="img"
        aria-label="Test pages compared with what they would have done without the change"
      >
        {liveIndex > 0 && (
          <line
            x1={x(liveIndex)}
            x2={x(liveIndex)}
            y1={0}
            y2={h}
            stroke="currentColor"
            strokeOpacity={0.2}
            strokeDasharray="4 4"
          />
        )}
        <path
          d={line("expected")}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.35}
          strokeWidth={2}
        />
        <path
          d={line("treatment")}
          fill="none"
          stroke="var(--ds-accent, #9ACD32)"
          strokeWidth={2.5}
        />
      </svg>
      <figcaption className="flex flex-wrap gap-4 text-[11.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-[var(--ds-accent,#9ACD32)]" /> Test pages
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-current opacity-35" /> Expected without the change
        </span>
        {liveIndex > 0 && <span>Dashed line: change went live</span>}
      </figcaption>
    </figure>
  );
}

export function ExperimentReportView({ report }: { report: ExperimentReport }) {
  const verdict = report.verdict ? VERDICT[report.verdict] : null;
  const money = formatMoney(report.monthlyValue, report.currency);
  const extra =
    report.extraPerMonth !== null
      ? `${report.extraPerMonth > 0 ? "+" : ""}${Math.round(report.extraPerMonth).toLocaleString()} ${report.unit} a month`
      : null;
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        {report.branding.logoUrl ? (
          <img
            src={report.branding.logoUrl}
            alt=""
            className="h-8 w-auto max-w-[140px] object-contain"
          />
        ) : null}
        <span className="text-[12px] text-muted-foreground">
          Prepared by {report.branding.name}
        </span>
      </div>

      <div>
        <p className="text-[12px] text-muted-foreground">{report.siteHost}</p>
        <h3 className="text-[18px] font-semibold tracking-tight">{report.name}</h3>
        <p className="mt-1 text-[14px] text-muted-foreground">{report.hypothesis}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Stat label="Result" value={verdict?.label ?? "—"} tone={verdict?.tone} />
        <Stat
          label={`Change in ${METRIC_LABELS[report.primaryMetric].toLowerCase()}`}
          value={formatLift(report.lift)}
          hint={
            report.ci95
              ? `Likely between ${formatLift(report.ci95[0])} and ${formatLift(report.ci95[1])}`
              : undefined
          }
        />
        <Stat
          label="Estimated value"
          value={money ? `${money} a month` : (extra ?? "—")}
          hint={money ? (extra ?? undefined) : undefined}
        />
      </div>

      <ResultChart daily={report.daily} />

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
        <dt className="text-muted-foreground">What changed</dt>
        <dd>{CHANGE_TYPE_LABELS[report.changeType]}</dd>
        <dt className="text-muted-foreground">Pages</dt>
        <dd>
          {report.pages.treatment} changed, {report.pages.control} left as they were
        </dd>
        <dt className="text-muted-foreground">Measured for</dt>
        <dd>{report.daysMeasured} days</dd>
        {report.liveConfirmedAt && (
          <>
            <dt className="text-muted-foreground">Live since</dt>
            <dd>{new Date(report.liveConfirmedAt).toLocaleDateString()}</dd>
          </>
        )}
      </dl>

      {report.examples.length > 0 && (
        <div className="space-y-2">
          <p className="text-[12px] font-medium">Examples</p>
          {report.examples.map((e) => (
            <div
              key={e.path}
              className="rounded-xl border border-border/60 p-3 text-[13px] space-y-1"
            >
              <p className="text-[11px] text-muted-foreground">{e.path}</p>
              {e.before && <p className="text-muted-foreground line-through">{e.before}</p>}
              <p>{e.after}</p>
            </div>
          ))}
        </div>
      )}

      {report.valueNote && <p className="text-[12px] text-muted-foreground">{report.valueNote}</p>}
      <p className="text-[11px] text-muted-foreground">
        Half of similar pages were changed and compared with the other half over the same days, so
        seasonality and site-wide changes affect both sides equally.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-[16px] font-semibold ${tone ?? ""}`}>{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}
