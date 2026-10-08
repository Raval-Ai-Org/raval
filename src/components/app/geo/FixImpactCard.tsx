"use client";

// FixImpactCard — what changed since the first fix went live: the site score,
// how often AI answers name the brand, and where in the answer. Every number
// comes from getFixImpact (rows that already exist); this card starts nothing.
// With no live fix yet it renders nothing.

import { useEffect, useState } from "react";
import { BarChart, CheckCircle, Spinner } from "@/components/icons";
import { getFixImpact } from "@/lib/geo-fixes.functions";
import type { FixImpact } from "@/lib/geo/fix-impact";
import { cn } from "@/lib/utils";
import { Tile } from "../surface/SurfaceLayout";

const pct = (rate: number) => `${Math.round(rate * 100)}%`;
const dateOf = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function Metric({
  label,
  before,
  after,
  change,
  better,
  hint,
}: {
  label: string;
  before: string;
  after: string;
  /** Signed change, already worded ("+18", "+40 pts", "2 places up"). */
  change: string;
  better: boolean | null;
  hint?: string;
}) {
  return (
    <div className="ds-well min-w-0 flex-1 basis-[170px] rounded-2xl p-3.5">
      <p className="text-[11.5px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1.5 flex items-baseline gap-1.5">
        <span className="text-[13px] text-muted-foreground line-through decoration-muted-foreground/40">
          {before}
        </span>
        <span aria-hidden className="text-muted-foreground/60">
          →
        </span>
        <span className="text-[22px] font-semibold leading-none tabular-nums">{after}</span>
      </p>
      <p
        className={cn(
          "mt-1.5 text-[12px] font-medium",
          better === null ? "text-muted-foreground" : better ? "text-success" : "text-destructive",
        )}
      >
        {change}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Waiting({ label, text }: { label: string; text: string }) {
  return (
    <div className="ds-well min-w-0 flex-1 basis-[170px] rounded-2xl p-3.5">
      <p className="text-[11.5px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-foreground/85">
        <Spinner className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
        {text}
      </p>
    </div>
  );
}

/** Presentational: the card for one impact reading. */
export function FixImpactView({
  impact,
  onOpenPrompts,
}: {
  impact: FixImpact;
  onOpenPrompts?: () => void;
}) {
  if (!impact.firstFixAt) return null;
  const { score, mentions, position, fixes } = impact;
  const scoreDelta = score ? score.after - score.before : 0;
  const mentionDelta = mentions ? Math.round((mentions.after - mentions.before) * 100) : 0;
  const placeDelta = position ? Math.round((position.before - position.after) * 10) / 10 : 0;

  return (
    <Tile className="ds-enter">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
          <BarChart className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-semibold">Since your fixes went live</h3>
          <p className="text-[12px] text-muted-foreground">
            First fix {dateOf(impact.firstFixAt)} · {fixes.live} live
            {fixes.verified ? ` · ${fixes.verified} confirmed on your site` : ""}
            {fixes.checking ? ` · ${fixes.checking} being checked` : ""}
            {fixes.notFixed ? ` · ${fixes.notFixed} still failing` : ""}
          </p>
        </div>
        {fixes.verified > 0 && (
          <span className="ds-pop inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-1 text-[11.5px] font-semibold text-success">
            <CheckCircle className="h-3.5 w-3.5" /> {fixes.verified} fixed
          </span>
        )}
      </div>

      <div className="mt-3.5 flex flex-wrap gap-2.5">
        {score ? (
          <Metric
            label="AI visibility score"
            before={String(score.before)}
            after={String(score.after)}
            change={
              scoreDelta === 0
                ? "No change yet"
                : `${scoreDelta > 0 ? "+" : ""}${scoreDelta} points`
            }
            better={scoreDelta === 0 ? null : scoreDelta > 0}
            hint={`Scan of ${dateOf(score.beforeAt)} vs ${dateOf(score.afterAt)}`}
          />
        ) : (
          <Waiting
            label="AI visibility score"
            text={impact.waiting.scan ? "Shows after your next scan" : "Not comparable yet"}
          />
        )}
        {mentions ? (
          <Metric
            label="AI answers that name you"
            before={pct(mentions.before)}
            after={pct(mentions.after)}
            change={
              mentionDelta === 0
                ? "No change yet"
                : `${mentionDelta > 0 ? "+" : ""}${mentionDelta} points`
            }
            better={mentionDelta === 0 ? null : mentionDelta > 0}
            hint={`${mentions.checksBefore} answers before, ${mentions.checksAfter} after`}
          />
        ) : (
          <Waiting label="AI answers that name you" text="Needs a few more weekly checks" />
        )}
        {position && (
          <Metric
            label="Your place in the answer"
            before={`#${position.before}`}
            after={`#${position.after}`}
            change={
              placeDelta === 0
                ? "No change yet"
                : `${Math.abs(placeDelta)} place${Math.abs(placeDelta) === 1 ? "" : "s"} ${placeDelta > 0 ? "up" : "down"}`
            }
            better={placeDelta === 0 ? null : placeDelta > 0}
          />
        )}
      </div>

      <p className="mt-3 text-[11.5px] text-muted-foreground">
        A before and after in time. Other changes to your site count too.
        {onOpenPrompts && (
          <>
            {" "}
            <button
              type="button"
              onClick={onOpenPrompts}
              className="font-medium text-foreground underline-offset-2 hover:underline"
            >
              See tracked questions
            </button>
          </>
        )}
      </p>
    </Tile>
  );
}

export function FixImpactCard({
  workspaceId,
  scanId,
  onOpenPrompts,
}: {
  workspaceId: string;
  scanId: string;
  onOpenPrompts?: () => void;
}) {
  const [impact, setImpact] = useState<FixImpact | null>(null);
  useEffect(() => {
    let cancelled = false;
    setImpact(null);
    getFixImpact({ data: { workspaceId, scanId } })
      .then((value) => !cancelled && setImpact(value))
      // An extra, not the page: stay quiet if it can't load.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [workspaceId, scanId]);
  if (!impact) return null;
  return <FixImpactView impact={impact} onOpenPrompts={onOpenPrompts} />;
}
