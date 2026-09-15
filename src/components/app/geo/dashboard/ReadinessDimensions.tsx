"use client";

// ReadinessDimensions — GEO readiness broken into nine dimensions, each with
// the checks behind it (passed / failing / not applicable), points lost, the
// evidence summary and whether Mellox can fix it. Computed from the scan's
// server-produced rule summaries (src/lib/geo/dimensions.ts).

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Wand } from "@/components/icons";
import { scoreDimensions, type DimensionScore, type FixMode } from "@/lib/geo/dimensions";
import type { StoredScanReport } from "@/lib/geo/contracts";
import { cn } from "@/lib/utils";
import { Chip, EASE, MiniBar, StatusGlyph, scoreTone, TONE } from "../geo-ui";

const FIX_LABEL: Record<FixMode, { label: string; tone: "primary" | "success" | "muted" }> = {
  deterministic: { label: "Mellox can fix", tone: "primary" },
  agent: { label: "GEO Engineer can fix", tone: "primary" },
  manual: { label: "Manual", tone: "muted" },
};

/** Radial "spider" chart of the dimensions (SVG, no library). */
function DimensionRadar({ dims }: { dims: DimensionScore[] }) {
  const size = 220;
  const c = size / 2;
  const r = c - 34;
  const pts = dims.map((d, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / dims.length;
    const v = (d.score ?? 0) / 100;
    return {
      a,
      x: c + Math.cos(a) * r * v,
      y: c + Math.sin(a) * r * v,
      lx: c + Math.cos(a) * (r + 18),
      ly: c + Math.sin(a) * (r + 18),
      d,
    };
  });
  return (
    <svg
      // Side margin so outward-anchored labels are never clipped.
      viewBox={`-56 -6 ${size + 112} ${size + 12}`}
      className="h-auto w-full max-w-[300px] overflow-visible"
      role="img"
      aria-label={`Dimension scores: ${dims.map((d) => `${d.name} ${d.score ?? "n/a"}`).join(", ")}`}
    >
      {[0.25, 0.5, 0.75, 1].map((k) => (
        <polygon
          key={k}
          points={dims
            .map((_, i) => {
              const a = -Math.PI / 2 + (i * 2 * Math.PI) / dims.length;
              return `${c + Math.cos(a) * r * k},${c + Math.sin(a) * r * k}`;
            })
            .join(" ")}
          fill="none"
          stroke="hsl(var(--border))"
          strokeOpacity={0.7}
        />
      ))}
      <motion.polygon
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: EASE }}
        style={{ transformOrigin: `${c}px ${c}px` }}
        points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="hsl(var(--primary) / 0.22)"
        stroke="hsl(var(--primary))"
        strokeWidth={1.75}
      />
      {pts.map((p) => (
        <text
          key={p.d.id}
          x={p.lx}
          y={p.ly}
          textAnchor={Math.cos(p.a) > 0.25 ? "start" : Math.cos(p.a) < -0.25 ? "end" : "middle"}
          dominantBaseline="middle"
          className="fill-muted-foreground"
          style={{ fontSize: 10 }}
        >
          {p.d.name.split(" ")[0]}
        </text>
      ))}
    </svg>
  );
}

function DimensionCard({
  d,
  open,
  onToggle,
}: {
  d: DimensionScore;
  open: boolean;
  onToggle: () => void;
}) {
  const tone = d.score === null ? "muted" : scoreTone(d.score);
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={cn(
        "min-w-0 rounded-xl border px-3 py-2.5 text-left shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-card hover:shadow-lg",
        open
          ? "border-primary/50 bg-card"
          : "border-border/60 bg-background/50 hover:border-primary/40",
      )}
    >
      <div className="truncate text-[11.5px] font-medium text-muted-foreground">{d.name}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={cn("text-[19px] font-semibold tabular-nums", TONE[tone].text)}>
          {d.score ?? "—"}
        </span>
        {d.score !== null && <span className="text-[10.5px] text-muted-foreground/70">/100</span>}
      </div>
      <div className="mt-1.5">
        {d.score !== null ? (
          <MiniBar value={d.score} />
        ) : (
          <div className="h-1 rounded-full bg-border/40" />
        )}
      </div>
      <div className="mt-1.5 text-[10.5px] text-muted-foreground">
        {d.failed + d.warned > 0 ? `${d.failed + d.warned} to fix` : "All passing"}
        {d.fixable > 0 && ` · ${d.fixable} fixable`}
      </div>
      <span className="sr-only">{open ? "Hide checks" : "Show checks"}</span>
    </button>
  );
}

function DimensionDetail({
  d,
  onOpenRule,
}: {
  d: DimensionScore;
  onOpenRule: (ruleId: string) => void;
}) {
  const [showPassed, setShowPassed] = useState(false);
  const failing = d.checks.filter((c) => c.status === "fail" || c.status === "warn");
  const passing = d.checks.filter((c) => c.status === "pass");
  const na = d.checks.filter((c) => c.status === "na");
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.25, ease: EASE }}
      className="overflow-hidden"
    >
      <div className="mt-3 rounded-xl border border-border/60 bg-gradient-to-b from-background/80 to-muted/20 shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.05),0_8px_24px_-16px_rgb(0_0_0/0.5)] transition-colors duration-200 hover:border-border p-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-[13.5px] font-semibold">{d.question}</div>
          <div className="text-[11.5px] text-muted-foreground">
            {Math.round(d.weight * 100)}% of readiness · {passing.length} passing · {failing.length}{" "}
            to fix · {na.length} not applicable
          </div>
        </div>
        {failing.length ? (
          <ul className="mt-2 divide-y divide-border/40">
            {failing.map((c) => (
              <li key={c.ruleId} className="flex items-start gap-2.5 py-2">
                <StatusGlyph status={c.status} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium">
                    {c.title}
                    {c.applicable > 1 && (
                      <span className="text-[11.5px] font-normal text-muted-foreground">
                        {c.failed + c.warned} of {c.applicable} pages
                      </span>
                    )}
                    {c.fixMode && (
                      <Chip tone={FIX_LABEL[c.fixMode].tone}>
                        {c.fixMode !== "manual" && <Wand className="h-3 w-3" />}
                        {FIX_LABEL[c.fixMode].label}
                      </Chip>
                    )}
                  </div>
                  <div className="mt-0.5 break-words text-[12.5px] text-muted-foreground">
                    {c.detail}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {c.pointsLost > 0 && (
                    <span className="text-[12px] font-semibold tabular-nums text-destructive">
                      −{c.pointsLost}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onOpenRule(c.ruleId)}
                    className="text-[11.5px] font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Evidence & fix
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[12.5px] text-foreground/85">
            Every applicable check in this dimension passes.
          </p>
        )}
        {passing.length > 0 && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowPassed((v) => !v)}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground"
            >
              {showPassed ? "Hide" : "Show"} {passing.length} passing checks
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform", showPassed && "rotate-180")}
              />
            </button>
            {showPassed && (
              <ul className="mt-1.5 grid gap-1 sm:grid-cols-2">
                {passing.map((c) => (
                  <li
                    key={c.ruleId}
                    className="flex min-w-0 items-center gap-2 text-[12px] text-foreground/80"
                  >
                    <StatusGlyph status="pass" className="h-3.5 w-3.5" />
                    <span className="truncate" title={c.detail}>
                      {c.title}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function ReadinessDimensions({
  report,
  fixModeByRule,
  onOpenRule,
}: {
  report: StoredScanReport;
  fixModeByRule: Map<string, FixMode>;
  onOpenRule: (ruleId: string) => void;
}) {
  const breakdown = useMemo(
    () => scoreDimensions(report, (id) => fixModeByRule.get(id) ?? null),
    [report, fixModeByRule],
  );
  const [open, setOpen] = useState<string | null>(null);
  const openDim = breakdown.dimensions.find((d) => d.id === open) ?? null;
  return (
    <div className="rounded-2xl border border-border/70 bg-gradient-to-b from-card/90 to-card/40 shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.05),0_8px_24px_-16px_rgb(0_0_0/0.5)] transition-colors duration-200 hover:border-border p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1 basis-[260px]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            GEO readiness by dimension
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className={cn(
                "text-[26px] font-semibold tabular-nums",
                TONE[breakdown.overall === null ? "muted" : scoreTone(breakdown.overall)].text,
              )}
            >
              {breakdown.overall ?? "—"}
            </span>
            <span className="text-[12px] text-muted-foreground">
              overall readiness · weighted over{" "}
              {breakdown.dimensions.filter((d) => d.score !== null).length} dimensions with data
            </span>
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Scores show how well the site meets these checks. They don't guarantee rankings, traffic
            or AI citations.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 min-[560px]:grid-cols-3">
            {breakdown.dimensions.map((d) => (
              <DimensionCard
                key={d.id}
                d={d}
                open={open === d.id}
                onToggle={() => setOpen(open === d.id ? null : d.id)}
              />
            ))}
          </div>
        </div>
        <div className="mx-auto w-full max-w-[300px] shrink-0 sm:w-[260px]">
          <DimensionRadar dims={breakdown.dimensions} />
        </div>
      </div>
      <AnimatePresence initial={false}>
        {openDim && <DimensionDetail key={openDim.id} d={openDim} onOpenRule={onOpenRule} />}
      </AnimatePresence>
    </div>
  );
}
