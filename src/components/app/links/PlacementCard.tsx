"use client";
// One website you could buy a placement on.
//
// The hero content is the sentence explaining the site, not the statistics —
// someone with no SEO background should be able to choose from these cards.
// The numbers sit underneath as quiet supporting detail, and a figure we do not
// have is left out rather than shown as a confident zero.
import { motion, useReducedMotion } from "framer-motion";

import { Check, Globe } from "@/components/icons";
import { cn } from "@/lib/utils";
import { EASE, Money } from "./links-ui";
import type { OpportunityView } from "@/server/fns/links";

const VERDICT: Record<string, { label: string; className: string }> = {
  good: { label: "Good fit", className: "bg-success-surface text-success" },
  workable: { label: "Workable", className: "bg-secondary text-muted-foreground" },
  poor: { label: "Weak fit", className: "bg-warning-surface text-warning" },
};

function Figure({ label, value }: { label: string; value: number | string | null }) {
  if (value === null) return null;
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[13px] font-medium tabular-nums text-foreground">
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
      <span className="text-[12px] text-muted-foreground">{label}</span>
    </div>
  );
}

export function PlacementCard({
  placement,
  selected,
  disabled,
  onToggle,
  index = 0,
}: {
  placement: OpportunityView;
  selected: boolean;
  disabled?: boolean;
  onToggle: () => void;
  index?: number;
}) {
  const reduced = useReducedMotion();
  const verdict = placement.topic ? (VERDICT[placement.topic.verdict] ?? VERDICT.workable) : null;
  const locked = disabled && !selected;

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE, delay: Math.min(index * 0.04, 0.3) }}
    >
      {/* The whole card is the control: a large, obvious hit area beats a
          small button hiding in the corner. */}
      <button
        type="button"
        onClick={onToggle}
        disabled={locked}
        aria-pressed={selected}
        className={cn(
          "group relative w-full rounded-2xl border bg-card p-5 text-left transition-all sm:p-6",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          selected
            ? "border-primary/60 shadow-2 ring-1 ring-primary/30"
            : "border-border shadow-1 hover:border-border-strong hover:shadow-2",
          locked && "cursor-not-allowed opacity-45 hover:border-border hover:shadow-1",
        )}
      >
        <div className="flex items-start gap-4">
          <span
            className={cn(
              "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors",
              selected
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground",
            )}
          >
            {selected ? (
              <Check className="h-4 w-4" strokeWidth={3} aria-hidden />
            ) : (
              <Globe className="h-4 w-4" aria-hidden />
            )}
          </span>

          <div className="min-w-0 flex-1">
            {/* On a phone the price drops below the title, so the domain keeps
                the full width and never breaks mid-word. */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <h3 className="truncate text-[15.5px] font-semibold tracking-tight text-foreground">
                  {placement.domain}
                </h3>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {verdict && (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11.5px] font-medium",
                        verdict.className,
                      )}
                    >
                      {verdict.label}
                    </span>
                  )}
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[11.5px] text-muted-foreground">
                    {placement.qualityLabel}
                  </span>
                  {placement.category && (
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[11.5px] text-muted-foreground">
                      {placement.category}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-baseline gap-1.5 sm:block sm:text-right">
                <Money
                  usd={placement.usd}
                  className="text-[19px] font-semibold tracking-tight text-foreground"
                />
                <p className="text-[11.5px] text-muted-foreground">one placement</p>
              </div>
            </div>

            {placement.topic && (
              <div className="mt-3.5 space-y-1.5">
                <p className="text-[14px] leading-relaxed text-foreground">
                  {placement.topic.summary}
                </p>
                <p className="text-[14px] leading-relaxed text-muted-foreground">
                  {placement.topic.fit}
                </p>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-border/70 pt-3">
              <Figure label="authority" value={placement.authority} />
              <Figure label="linking sites" value={placement.referringDomains} />
              <Figure label="ranking keywords" value={placement.rankingKeywords} />
            </div>

            {/* Saying what the judgement was based on is the point of making it. */}
            {placement.topic && (
              <p className="mt-2.5 text-[11.5px] text-muted-foreground">
                {placement.topic.basis === "page"
                  ? "Mellox read a page on this site to work this out."
                  : "Mellox couldn't read a page here, so this is from the domain alone."}
              </p>
            )}
          </div>
        </div>
      </button>
    </motion.div>
  );
}
