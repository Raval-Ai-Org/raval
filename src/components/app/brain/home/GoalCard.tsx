"use client";

// GoalCard — the team's goal on Brain home (ADR-0035). Presentational: every
// number comes from stored rows (posts that went out, their views). What
// Mellox can't read is said plainly, never estimated.
import { motion } from "framer-motion";
import { ChevronRight, Target } from "@/components/icons";
import { dsGhostBtn } from "@/components/app/surface/buttons";
import type { BrainOverview } from "@/lib/brain/brain";
import { formatCount } from "@/lib/goals/decide";
import { duration, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function GoalCard({
  goal,
  onEdit,
}: {
  goal: NonNullable<BrainOverview["goal"]>;
  onEdit?: () => void;
}) {
  const { progress } = goal;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: duration.slow, ease: ease.emphasized, delay: 0.35 }}
      className="ds-tile mt-3 p-4 sm:p-5"
      role="region"
      aria-label="Goal"
    >
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-primary/12 text-primary">
          <Target className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-tight tracking-tight">Goal</h3>
          <p className="mt-1 line-clamp-2 text-[12.5px] leading-5 text-muted-foreground">
            {goal.line}
          </p>
        </div>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className={cn(dsGhostBtn, "h-9 shrink-0 px-4 text-[13px]")}
          >
            Change <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-[11.5px] text-muted-foreground">
          <span>
            Week {Math.min(progress.weeksElapsed + 1, progress.weeksElapsed + progress.weeksLeft)}
          </span>
          <span>
            {progress.weeksLeft} week{progress.weeksLeft === 1 ? "" : "s"} left
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--ds-well-bg)]">
          <motion.div
            className="h-full rounded-full bg-primary/40"
            initial={{ width: 0 }}
            animate={{ width: `${Math.round(progress.timeRatio * 100)}%` }}
            transition={{ duration: duration.xslow, ease: ease.emphasized, delay: 0.45 }}
          />
        </div>
      </div>

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {progress.rows.map((row) => (
          <li key={row.id} className="ds-well rounded-[var(--ds-radius-well)] px-3.5 py-3">
            <p className="text-[12px] text-muted-foreground">{row.label}</p>
            {row.state === "measured" ? (
              <>
                <p className="mt-0.5 text-[18px] font-semibold tabular-nums leading-tight">
                  {formatCount(row.value)}
                  {row.target !== null && (
                    <span className="text-[12.5px] font-normal text-muted-foreground">
                      {" "}
                      / {formatCount(row.target)}
                    </span>
                  )}
                </p>
                {row.ratio !== null && (
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-background/60">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.round(row.ratio * 100)}%` }}
                    />
                  </div>
                )}
                <p className="mt-1.5 text-[11.5px] text-muted-foreground">{row.detail}</p>
              </>
            ) : (
              <>
                <p className="mt-0.5 text-[13px] font-medium">Not measured yet</p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                  {row.reason} {row.fix}
                </p>
              </>
            )}
          </li>
        ))}
      </ul>
    </motion.div>
  );
}
