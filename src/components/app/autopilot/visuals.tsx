"use client";
// Shared pictures of the Autopilot surface: where every piece is, the days
// ahead, and the log as a timeline.
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
import type { AutopilotView } from "@/lib/autopilot/contracts";
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

/**
 * The next seven days, starting today, with the pieces planned on each. Today
 * also keeps what already went out, so the day reads as one plan.
 */
export function weekDays(
  view: Pick<AutopilotView, "proposed" | "approvals" | "upcoming"> &
    Partial<Pick<AutopilotView, "finished">>,
) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const posted = (view.finished ?? []).filter(
    (a) => a.status === "published" || a.status === "measured",
  );
  const all = [...view.proposed, ...view.approvals, ...view.upcoming, ...posted];
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

/**
 * Where every piece is right now: plan → write → approve → schedule → post.
 * One line, a count and a bar per stage; the stage that waits for a person is
 * the only one that can be pressed.
 */
export function Pipeline({ view, onApprove }: { view: AutopilotView; onApprove: () => void }) {
  const counts = stageCounts(view);
  return (
    <ol className="grid grid-cols-5 gap-1.5 sm:gap-2" aria-label="Where your posts are">
      {STAGES.map((stage, i) => {
        const count = counts[i];
        const live = stage.id === "write" && count > 0;
        const needsYou = stage.id === "approve" && count > 0;
        const body = (
          <>
            <span
              className={cn(
                "relative block h-1 overflow-hidden rounded-full",
                needsYou ? "bg-warning" : count ? "bg-primary" : "bg-[var(--ds-well-bg-hover)]",
              )}
            >
              {live && (
                <span className="absolute inset-0 animate-pulse bg-background/50 motion-reduce:hidden" />
              )}
            </span>
            <span
              className={cn(
                "mt-2.5 block text-[22px] font-semibold leading-none tabular-nums",
                !count && "text-muted-foreground/50",
              )}
            >
              {count}
            </span>
            <span
              className={cn(
                "mt-1 block truncate text-[11.5px]",
                needsYou ? "font-semibold text-warning" : "text-muted-foreground",
              )}
            >
              {stage.label}
            </span>
          </>
        );
        return (
          <li key={stage.id} className="min-w-0">
            {needsYou ? (
              <button
                type="button"
                onClick={onApprove}
                aria-label={`${count} to approve`}
                className="block w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-4 focus-visible:ring-offset-background"
              >
                {body}
              </button>
            ) : (
              body
            )}
          </li>
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

function eventIcon(kind: string) {
  if (kind.includes("failed") || kind.includes("missed")) return AlertTriangle;
  if (kind.startsWith("plan")) return CalendarClock;
  if (kind.startsWith("task")) return Eye;
  if (kind === "article_sent") return CheckCircle2;
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
