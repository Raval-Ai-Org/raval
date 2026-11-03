"use client";

// PerformanceCard — speed, from what the scan measured: Chrome's real-user
// data for the site (phones, 75th percentile) and Lighthouse on a few pages
// sampled one per page template. Presentational; it starts nothing.

import { Gauge } from "@/components/icons";
import { formatVital, summarizeLab, type VitalId } from "@/lib/geo/performance";
import type { FieldMetric, SitePerformance, VitalRating } from "@/lib/geo/types";
import { cn } from "@/lib/utils";
import { Tile } from "../surface/SurfaceLayout";
import { displayUrl, TONE, type Tone } from "./geo-ui";

const RATING: Record<VitalRating, { label: string; tone: Tone }> = {
  good: { label: "Good", tone: "success" },
  needs_improvement: { label: "Needs work", tone: "warning" },
  poor: { label: "Slow", tone: "destructive" },
};

const VITALS: { id: Extract<VitalId, "lcp" | "inp" | "cls">; label: string; hint: string }[] = [
  { id: "lcp", label: "Page load", hint: "Largest Contentful Paint" },
  { id: "inp", label: "Response to taps", hint: "Interaction to Next Paint" },
  { id: "cls", label: "Layout steadiness", hint: "Cumulative Layout Shift" },
];

const scoreTone = (n: number | null | undefined): Tone =>
  n == null ? "muted" : n >= 90 ? "success" : n >= 50 ? "warning" : "destructive";

function Vital({
  label,
  hint,
  id,
  metric,
}: {
  label: string;
  hint: string;
  id: VitalId;
  metric: FieldMetric | null;
}) {
  const rating = metric ? RATING[metric.rating] : null;
  return (
    <div className="ds-well min-w-0 flex-1 basis-[150px] rounded-2xl p-3.5" title={hint}>
      <p className="text-[11.5px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-[22px] font-semibold leading-none tabular-nums">
        {metric ? formatVital(id, metric.p75) : "—"}
      </p>
      <p
        className={cn(
          "mt-1.5 text-[12px] font-medium",
          rating ? TONE[rating.tone].text : "text-muted-foreground",
        )}
      >
        {rating?.label ?? "No data"}
      </p>
    </div>
  );
}

export function PerformanceView({ performance }: { performance: SitePerformance }) {
  const field = performance.field?.origin ?? null;
  const lab = performance.lab;
  const summary = summarizeLab(lab);
  if (!field && !lab.length && !performance.unavailable) return null;

  return (
    <Tile className="ds-enter">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
          <Gauge className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-semibold">How fast your site is</h3>
          <p className="text-[12px] text-muted-foreground">
            {field
              ? `Real visitors on phones${field.periodEnd ? `, 28 days to ${field.periodEnd}` : ""}`
              : (performance.unavailable ?? "No real-user data")}
          </p>
        </div>
        {summary.medianPerformance != null && (
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2.5 py-1 text-[11.5px] font-semibold ring-1",
              TONE[scoreTone(summary.medianPerformance)].chip,
            )}
          >
            Lighthouse {summary.medianPerformance}
          </span>
        )}
      </div>

      {field && (
        <div className="mt-3.5 flex flex-wrap gap-2.5">
          {VITALS.map((v) => (
            <Vital key={v.id} {...v} metric={field[v.id]} />
          ))}
        </div>
      )}

      {lab.length > 0 && (
        <div className="mt-4">
          <p className="px-0.5 text-[12px] font-medium text-muted-foreground">
            Lighthouse on {lab.length} sample page{lab.length === 1 ? "" : "s"} (mobile)
          </p>
          <ul className="mt-1.5 divide-y divide-border/50">
            {lab.map((run) => (
              <li
                key={run.url}
                className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2"
              >
                <span className="min-w-0 flex-1 basis-[180px]">
                  <span className="block truncate text-[13px] font-medium" title={run.url}>
                    {displayUrl(run.url)}
                  </span>
                  <span className="block truncate text-[11.5px] text-muted-foreground">
                    {run.ok
                      ? run.opportunities?.[0]
                        ? `${run.opportunities[0].title} · save ~${(run.opportunities[0].savingsMs / 1000).toFixed(1)} s`
                        : "No big savings found"
                      : run.error}
                  </span>
                </span>
                {run.ok && (
                  // One group, so the three scores wrap together on narrow screens.
                  <span className="ml-auto flex shrink-0">
                    {(
                      [
                        ["Speed", run.scores?.performance],
                        ["Access", run.scores?.accessibility],
                        ["SEO", run.scores?.seo],
                      ] as const
                    ).map(([label, value]) => (
                      <span key={label} className="w-[52px] text-right">
                        <span
                          className={cn(
                            "block text-[14px] font-semibold tabular-nums",
                            TONE[scoreTone(value)].text,
                          )}
                        >
                          {value ?? "—"}
                        </span>
                        <span className="block text-[10.5px] text-muted-foreground">{label}</span>
                      </span>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Tile>
  );
}
