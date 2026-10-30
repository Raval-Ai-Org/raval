"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, Check, PanelRightOpen } from "@/components/icons";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { emitAppEvent } from "@/lib/app-events";
import { duration, ease } from "@/lib/motion";
import { STUDIO_FORMATS } from "@/lib/studio/formats";
import { isActiveJob, type StudioJob } from "@/lib/studio/jobs";
import { noteStudioFinished, getStudioRailState, useStudioRail } from "@/lib/studio/rail-state";
import { getStudioState, openJob, useStudioStore } from "@/lib/studio/session-store";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { WorkingRing } from "./studio-ui";

export type StudioButtonState = "idle" | "working" | "ready" | "failed";

/**
 * The top-bar Studio button. While the panel is closed it carries what Studio
 * is doing: a turning ring and a count while pieces are made, a check once one
 * is ready. Presentational: `/studio-lab` renders every state.
 */
export function StudioButtonView({
  state,
  working,
  unseen,
  onClick,
}: {
  state: StudioButtonState;
  working: number;
  unseen: number;
  onClick: () => void;
}) {
  const reduce = useReducedMotion();
  const label =
    state === "working"
      ? `Studio: creating ${working} ${working === 1 ? "piece" : "pieces"}`
      : state === "ready"
        ? `Studio: ${unseen} ready to review`
        : state === "failed"
          ? "Studio: something couldn't finish"
          : "Open Studio";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-tour="studio"
      data-state={state}
      className={cn(
        "group relative inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[12px] font-semibold tracking-tight transition-[background-color,border-color,box-shadow,color] duration-[--motion-duration-base] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 sm:h-9",
        "border-primary-border bg-primary-surface text-[hsl(var(--brand-green))] shadow-[0_0_0_1px_hsl(var(--brand-green)/0.15)_inset,0_4px_14px_-6px_hsl(var(--brand-green)/0.55)] hover:text-foreground hover:shadow-[0_0_0_1px_hsl(var(--brand-green)/0.35)_inset,0_6px_18px_-6px_hsl(var(--brand-green)/0.75)]",
        state === "ready" &&
          "border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
      )}
    >
      {state === "working" ? (
        // A light that travels along the edge: the one hint that work is running.
        <span aria-hidden className="studio-ring studio-ring-slow absolute inset-0 rounded-full" />
      ) : null}
      {state === "ready" && !reduce ? (
        <motion.span
          aria-hidden
          key={unseen}
          className="absolute inset-0 rounded-full ring-2 ring-primary"
          initial={{ opacity: 0.7, scale: 1 }}
          animate={{ opacity: 0, scale: 1.35 }}
          transition={{ duration: 1.1, ease: ease.decelerate, repeat: 2, repeatDelay: 0.4 }}
        />
      ) : null}

      <span className="relative grid size-3.5 place-items-center">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={state}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
            transition={{ duration: duration.base, ease: ease.emphasized }}
            className="grid place-items-center"
          >
            {state === "working" ? (
              <WorkingRing className="size-3.5" />
            ) : state === "ready" ? (
              <Check className="size-3.5" strokeWidth={3} aria-hidden />
            ) : (
              <PanelRightOpen className="size-3.5" aria-hidden />
            )}
          </motion.span>
        </AnimatePresence>
      </span>
      <span className="relative hidden sm:inline">Studio</span>

      {state === "working" ? (
        <span className="relative hidden min-w-[18px] rounded-full bg-[hsl(var(--brand-green)/0.18)] px-1.5 text-center text-[10.5px] font-bold leading-[18px] tabular-nums sm:inline-block">
          {working}
        </span>
      ) : state === "ready" ? (
        <span className="relative hidden rounded-full bg-primary-foreground/15 px-1.5 text-[10.5px] font-bold leading-[18px] sm:inline-block">
          {unseen > 1 ? `${unseen} ready` : "Ready"}
        </span>
      ) : null}

      {state === "failed" ? (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-danger text-white ring-2 ring-background"
        >
          <AlertTriangle className="size-2.5" strokeWidth={2.75} />
        </span>
      ) : null}
      {/* Phones show only the icon, so the count rides on it. */}
      {state === "working" || state === "ready" ? (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-foreground px-1 text-center text-[9.5px] font-bold leading-4 text-background ring-2 ring-background sm:hidden"
        >
          {state === "working" ? working : unseen}
        </span>
      ) : null}
    </button>
  );
}

/** Active and failed Studio work for this workspace. */
function useStudioWork(workspaceId: string | null) {
  const jobs = useStudioStore((s) => s.jobs);
  const pending = useStudioStore((s) =>
    s.sessions.some((x) => x.workspaceId === workspaceId && x.pendingKey && !x.job),
  );
  const own = workspaceId ? jobs.filter((j) => j.workspace_id === workspaceId) : jobs;
  const active = own.filter(isActiveJob).length;
  return { working: active || (pending ? 1 : 0) };
}

/** The wired top-bar button: toggles the panel, shows Studio's state while it is closed. */
export function StudioButton() {
  const workspaceId = useOptionalWorkspaceId();
  const rail = useStudioRail();
  const { working } = useStudioWork(workspaceId);
  const failed = useFailedSinceClosed(workspaceId, rail.open);
  // Open, the panel itself shows everything, so the button stays plain.
  const state: StudioButtonState = rail.open
    ? "idle"
    : working
      ? "working"
      : rail.unseen
        ? "ready"
        : failed
          ? "failed"
          : "idle";
  return (
    <StudioButtonView
      state={state}
      working={working}
      unseen={rail.unseen}
      onClick={() => emitAppEvent("toggle:studio")}
    />
  );
}

/** Whether a piece failed while the panel was closed (cleared on open). */
function useFailedSinceClosed(workspaceId: string | null, open: boolean): boolean {
  const jobs = useStudioStore((s) => s.jobs);
  const since = useRef(Date.now());
  useEffect(() => {
    if (open) since.current = Date.now();
  }, [open]);
  if (open) return false;
  return jobs.some(
    (j) =>
      j.status === "failed" &&
      !j.parent_job_id &&
      (!workspaceId || j.workspace_id === workspaceId) &&
      Date.parse(j.updated_at) > since.current,
  );
}

function nounFor(job: StudioJob): string {
  return STUDIO_FORMATS[job.type]?.noun ?? "piece";
}

/**
 * Tells the person when a piece finishes. Mounted once in the shell.
 * Only work seen running in this tab counts, so a page load never replays old
 * results; a piece open in the composer is left to the composer.
 */
export function StudioActivityWatcher() {
  const workspaceId = useOptionalWorkspaceId();
  const jobs = useStudioStore((s) => s.jobs);
  const running = useRef<Set<string> | null>(null);

  useEffect(() => {
    const before = running.current;
    running.current = new Set(jobs.filter(isActiveJob).map((j) => j.id));
    if (!before) return;
    for (const job of jobs) {
      if (!before.has(job.id) || isActiveJob(job) || job.status === "cancelled") continue;
      if (workspaceId && job.workspace_id !== workspaceId) continue;
      const studio = getStudioState();
      const inComposer = studio.sessions.some(
        (s) => s.id === studio.activeId && (s.job?.id === job.id || s.lastGood?.id === job.id),
      );
      if (inComposer) continue;
      const open = () => void openJob(job.id, job.workspace_id);
      if (job.status === "succeeded") {
        noteStudioFinished();
        // The panel shows it arriving in Review; a notice is only needed when it's closed.
        if (getStudioRailState().open) continue;
        toast.success(`Your ${nounFor(job)} is ready`, {
          id: `studio-done:${job.id}`,
          description: job.title || undefined,
          action: { label: "Review", onClick: open },
        });
      } else if (job.status === "failed" && !getStudioRailState().open) {
        toast.error(`Couldn't finish your ${nounFor(job)}`, {
          id: `studio-failed:${job.id}`,
          description: "Open it to try again.",
          action: { label: "Open", onClick: open },
        });
      }
    }
  }, [jobs, workspaceId]);

  return null;
}
