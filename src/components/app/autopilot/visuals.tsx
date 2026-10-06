"use client";
// The pictures on the Autopilot home screen: where every piece is, the next
// seven days, the AI visibility score, and the log as a timeline.
import { useMemo } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Bot,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  History,
  Lightbulb,
  ListChecks,
  Pencil,
  TrendingUp,
} from "@/components/icons";
import { Tile } from "@/components/app/surface/SurfaceLayout";
import type { AutopilotView } from "@/lib/autopilot/contracts";
import { statusTone } from "@/lib/autopilot/state";
import { timeAgo } from "./autopilot-ui";

export const rise = (i: number) => ({
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.32, delay: Math.min(i, 6) * 0.05, ease: [0.16, 1, 0.3, 1] as const },
});

export const STAGES = [
  { id: "plan", label: "Planned", icon: CalendarClock, statuses: ["proposed", "planned"] },
  { id: "write", label: "Writing", icon: Pencil, statuses: ["generating"] },
  { id: "approve", label: "To approve", icon: ListChecks, statuses: ["needs_approval"] },
  { id: "schedule", label: "Scheduled", icon: Clock, statuses: ["approved", "scheduled"] },
  { id: "post", label: "Posted", icon: CheckCircle2, statuses: ["published", "measured", "done"] },
] as const;

/** How many pieces sit at each stage, in STAGES order. */
export function stageCounts(view: AutopilotView): number[] {
  const all = [...view.proposed, ...view.approvals, ...view.upcoming, ...view.finished];
  return STAGES.map(
    (stage) => all.filter((a) => (stage.statuses as readonly string[]).includes(a.status)).length,
  );
}

/** The next seven days, starting today, with the pieces planned on each. */
export function weekDays(view: Pick<AutopilotView, "proposed" | "approvals" | "upcoming">) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const all = [...view.proposed, ...view.approvals, ...view.upcoming];
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const next = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i + 1);
    return {
      day,
      actions: all.filter((a) => {
        const t = a.plannedFor ? Date.parse(a.plannedFor) : NaN;
        return t >= day.getTime() && t < next.getTime();
      }),
    };
  });
}

/** Where every piece is right now: plan → write → approve → schedule → post. */
export function Pipeline({ view, onApprove }: { view: AutopilotView; onApprove: () => void }) {
  const counts = stageCounts(view);
  return (
    <ol className="grid grid-cols-5 gap-1.5 sm:gap-2" aria-label="Where your posts are">
      {STAGES.map((stage, i) => {
        const count = counts[i];
        const live = stage.id === "write" && count > 0;
        const needsYou = stage.id === "approve" && count > 0;
        const Icon = stage.icon;
        const body = (
          <>
            <span
              className={cn(
                "relative grid h-9 w-9 place-items-center rounded-full",
                needsYou
                  ? "bg-warning/15 text-warning"
                  : count
                    ? "bg-primary/12 text-primary"
                    : "bg-[var(--ds-well-bg)] text-muted-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {live && (
                <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-70 motion-reduce:hidden" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
                </span>
              )}
            </span>
            <span className="mt-2 text-[20px] font-semibold leading-none tabular-nums">
              {count}
            </span>
            <span className="mt-1 max-w-full truncate text-[11.5px] text-muted-foreground">
              {stage.label}
            </span>
          </>
        );
        return (
          <motion.li key={stage.id} {...rise(i)} className="min-w-0">
            {needsYou ? (
              <button
                type="button"
                onClick={onApprove}
                aria-label={`${count} to approve`}
                className="ds-tile ds-tile-hover flex w-full flex-col items-center px-1 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {body}
              </button>
            ) : (
              <div className="ds-tile flex flex-col items-center px-1 py-3">{body}</div>
            )}
          </motion.li>
        );
      })}
    </ol>
  );
}

export const TONE_DOT = {
  neutral: "bg-muted-foreground/40",
  active: "bg-primary",
  attention: "bg-warning",
  good: "bg-success",
  bad: "bg-destructive",
} as const;

/** The next seven days, one dot per piece. */
export function WeekStrip({ view }: { view: AutopilotView }) {
  const { proposed, approvals, upcoming } = view;
  const days = useMemo(
    () => weekDays({ proposed, approvals, upcoming }),
    [proposed, approvals, upcoming],
  );

  return (
    <Tile className="px-2 py-3 sm:px-3 sm:py-4">
      <ol className="grid grid-cols-7">
        {days.map(({ day, actions }, i) => (
          <li
            key={day.toISOString()}
            className="flex flex-col items-center gap-1.5"
            title={actions.map((a) => a.title).join(" · ") || undefined}
          >
            <span className="text-[11px] font-medium text-muted-foreground">
              {day.toLocaleDateString(undefined, { weekday: "short" })}
            </span>
            <span
              className={cn(
                "grid h-8 w-8 place-items-center rounded-full text-[13px] font-semibold tabular-nums",
                i === 0 ? "bg-primary text-primary-foreground" : "text-foreground",
              )}
            >
              {day.getDate()}
            </span>
            <span className="flex h-2 items-center gap-1" aria-label={`${actions.length} planned`}>
              {actions.slice(0, 4).map((a) => (
                <span
                  key={a.id}
                  className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[statusTone(a.status)])}
                />
              ))}
            </span>
          </li>
        ))}
      </ol>
    </Tile>
  );
}

function eventIcon(kind: string) {
  if (kind.includes("failed") || kind.includes("missed")) return AlertTriangle;
  if (kind.startsWith("plan")) return CalendarClock;
  if (kind.startsWith("task")) return Eye;
  if (kind.startsWith("opportunit")) return Lightbulb;
  if (kind.startsWith("program")) return Bot;
  if (kind === "piece_ready") return Pencil;
  if (kind === "piece_scheduled") return Clock;
  if (kind === "piece_published") return CheckCircle2;
  if (kind === "piece_measured") return TrendingUp;
  if (kind.includes("approved")) return Check;
  return History;
}

/** The real log: what happened, who did it, when. */
export function Timeline({ events }: { events: AutopilotView["events"] }) {
  return (
    <ol className="relative">
      <span aria-hidden className="absolute bottom-4 left-[15px] top-4 w-px bg-border/70" />
      {events.map((e, i) => {
        const Icon = eventIcon(e.kind);
        const bad = e.kind.includes("failed") || e.kind.includes("missed");
        return (
          <motion.li key={e.id} {...rise(i)} className="relative flex items-start gap-3 py-2.5">
            <span
              className={cn(
                "relative z-[1] grid h-8 w-8 shrink-0 place-items-center rounded-full ring-4 ring-background",
                bad
                  ? "bg-destructive/15 text-destructive"
                  : e.actor === "user"
                    ? "bg-primary/15 text-primary"
                    : "bg-secondary text-muted-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <p className="text-[13.5px] leading-snug">{e.summary}</p>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                {e.actor === "user" ? "Your team" : "Mellox"} · {timeAgo(e.createdAt)}
              </p>
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}

export function ScoreRing({ score }: { score: number | null }) {
  const value = Math.max(0, Math.min(100, score ?? 0));
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative grid h-14 w-14 shrink-0 place-items-center">
      <svg viewBox="0 0 48 48" className="h-14 w-14 -rotate-90" aria-hidden>
        <circle cx="24" cy="24" r={r} fill="none" strokeWidth="4" className="stroke-border/70" />
        <motion.circle
          cx="24"
          cy="24"
          r={r}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          className={
            value >= 80 ? "stroke-success" : value >= 60 ? "stroke-primary" : "stroke-warning"
          }
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c - (c * value) / 100 }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <span className="absolute text-[14px] font-semibold tabular-nums">{score ?? "–"}</span>
    </span>
  );
}
