"use client";

// Live card for work the chat started in Studio. It follows the Studio session
// (same browser) or, after a reload elsewhere, the job itself — so the chat
// shows the same progress as the Studio rail. Nothing opens by itself: Review
// and "See in Studio" are the user's choice.
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, ArrowRight, RefreshCw, X } from "@/components/icons";
import { emitAppEvent } from "@/lib/app-events";
import { cn } from "@/lib/utils";
import { STUDIO_FORMATS, type StudioType } from "@/lib/studio/formats";
import { isActiveJob } from "@/lib/studio/jobs";
import {
  cancelSession,
  focusSession,
  generate,
  openJob,
  useStudioStore,
} from "@/lib/studio/session-store";
import {
  Burst,
  DrawCheck,
  TypeGlyph,
  formatElapsed,
  useElapsed,
} from "@/components/studio/studio-ui";

export type StudioTaskPayload = {
  sessionId?: string | null;
  jobId?: string | null;
  type: StudioType;
  brief: string;
  workspaceId: string;
};

type View = "starting" | "working" | "ready" | "failed" | "cancelled" | "unknown";

export function StudioTaskCard({
  task,
  demo,
}: {
  task: StudioTaskPayload;
  /** Chat lab only: show a state with sample data instead of reading the store. */
  demo?: { view: "working" | "ready" | "failed"; stage?: number };
}) {
  const reduce = useReducedMotion();
  const session = useStudioStore((s) =>
    task.sessionId ? (s.sessions.find((x) => x.id === task.sessionId) ?? null) : null,
  );
  const storeJob = useStudioStore((s) => {
    const id = session?.job?.id ?? task.jobId;
    return id ? (s.jobs.find((j) => j.id === id) ?? null) : null;
  });
  const job = session?.job ?? storeJob;
  const [busy, setBusy] = useState(false);

  const format = STUDIO_FORMATS[task.type] ?? STUDIO_FORMATS.social;
  const active = !!session?.pendingKey || (job ? isActiveJob(job) : false);
  const liveView: View = active
    ? job
      ? "working"
      : "starting"
    : job?.status === "succeeded" || session?.lastGood
      ? "ready"
      : job?.status === "failed" || session?.error
        ? "failed"
        : job?.status === "cancelled"
          ? "cancelled"
          : session
            ? "starting"
            : "unknown";
  const view: View = demo?.view ?? liveView;

  const stageIndex = demo
    ? (demo.stage ?? 1)
    : job
      ? Math.max(
          0,
          format.stages.findIndex((s) => s.id === job.stage),
        )
      : 0;
  const stageLabel =
    view === "starting"
      ? "Starting"
      : view === "working"
        ? (format.stages[stageIndex]?.label ?? "Working on it")
        : view === "ready"
          ? "Ready to review"
          : view === "failed"
            ? (job?.error?.message ?? session?.error ?? "Couldn't finish")
            : view === "cancelled"
              ? "Stopped"
              : "Sent to Studio";

  const startedAt = job ? Date.parse(job.created_at) : (session?.createdAt ?? Date.now());
  const elapsed = useElapsed(startedAt);
  const title = session?.lastGood?.title ?? job?.title ?? task.brief;
  const jobId = session?.lastGood?.id ?? job?.id ?? task.jobId ?? null;

  const review = () => {
    if (session) return focusSession(session.id);
    if (jobId) void openJob(jobId, task.workspaceId);
    else emitAppEvent("open:studio");
  };
  const retry = async () => {
    if (!session) return review();
    setBusy(true);
    try {
      await generate(session.id, { kind: "generate" });
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    if (!session) return;
    setBusy(true);
    try {
      await cancelSession(session.id);
    } finally {
      setBusy(false);
    }
  };

  const working = view === "working" || view === "starting";

  return (
    <motion.div
      layout
      initial={reduce ? false : { opacity: 0, y: 8, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        `studio-tone-${task.type} mx-task relative w-full max-w-[30rem] overflow-hidden rounded-2xl border bg-card`,
        view === "ready"
          ? "border-primary-border"
          : view === "failed"
            ? "border-danger-border"
            : "border-border",
      )}
      data-state={view}
    >
      {working ? <span className="studio-weave absolute inset-0 opacity-50" aria-hidden /> : null}
      <div className="relative flex items-center gap-3 p-3">
        <span className="relative">
          <AnimatePresence mode="wait" initial={false}>
            {view === "ready" ? (
              <motion.span
                key="ready"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="relative grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"
              >
                <DrawCheck className="size-5" delay={0.1} />
                <Burst radius={28} count={10} />
              </motion.span>
            ) : view === "failed" ? (
              <motion.span
                key="failed"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="grid size-10 place-items-center rounded-xl bg-danger-surface text-danger"
              >
                <AlertTriangle className="size-4" />
              </motion.span>
            ) : (
              <motion.span key="type" initial={false} animate={{ opacity: 1 }}>
                <TypeGlyph type={task.type} size="lg" className={working ? "studio-ring" : ""} />
              </motion.span>
            )}
          </AnimatePresence>
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <span className="font-medium text-foreground/80">{format.label}</span>
            <span aria-hidden>·</span>
            <span>Studio</span>
            {working ? (
              <span className="ml-auto font-mono tabular-nums">{formatElapsed(elapsed)}</span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-[14px] font-medium text-foreground" title={title}>
            {title}
          </p>
          <div className="relative mt-0.5 h-[18px] overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={stageLabel}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
                className={cn(
                  "truncate text-[12.5px] leading-[18px]",
                  view === "failed" ? "text-danger" : "text-muted-foreground",
                  working && "mx-shimmer",
                )}
              >
                {stageLabel}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {working && session ? (
            <button
              type="button"
              onClick={() => void stop()}
              disabled={busy}
              className="mx-icon-btn"
              aria-label="Stop creating"
              title="Stop"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
          {view === "ready" ? (
            <button type="button" onClick={review} className="mx-pill-btn mx-pill-btn--primary">
              Review
              <ArrowRight className="size-3.5" />
            </button>
          ) : view === "failed" ? (
            <button
              type="button"
              onClick={() => void retry()}
              disabled={busy}
              className="mx-pill-btn"
            >
              <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
              Try again
            </button>
          ) : view === "unknown" || view === "cancelled" ? (
            <button type="button" onClick={review} className="mx-pill-btn">
              Open
            </button>
          ) : null}
        </div>
      </div>

      {working ? (
        <div className="relative flex gap-1 px-3 pb-3" aria-hidden>
          {format.stages.map((s, i) => (
            <span
              key={s.id}
              className="relative h-1 flex-1 overflow-hidden rounded-full bg-foreground/[0.08]"
            >
              {view === "working" && i < stageIndex ? (
                <motion.span
                  className="absolute inset-0 rounded-full bg-primary"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  style={{ originX: 0 }}
                  transition={{ duration: 0.4 }}
                />
              ) : (view === "working" && i === stageIndex) || (view === "starting" && i === 0) ? (
                <motion.span
                  key={s.id}
                  className="studio-progress-fill absolute inset-y-0 left-0 rounded-full"
                  initial={{ width: "6%" }}
                  animate={{ width: "85%" }}
                  transition={{ duration: 14, ease: [0.1, 0.6, 0.3, 1] }}
                />
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      {view !== "failed" ? (
        <button
          type="button"
          onClick={() => emitAppEvent("open:studio")}
          className="relative flex w-full items-center justify-between border-t border-border/70 px-3 py-2 text-[12px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          <span>{view === "ready" ? "Waiting for your approval in Studio" : format.estimate}</span>
          <span className="inline-flex items-center gap-1 font-medium">
            See in Studio
            <ArrowRight className="size-3" />
          </span>
        </button>
      ) : null}
    </motion.div>
  );
}
