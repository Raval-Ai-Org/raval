"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion, type TargetAndTransition } from "framer-motion";
import {
  Brain,
  Camera,
  Check,
  Compass,
  ListTree,
  Minus,
  Palette,
  PenLine,
  Save,
  Sparkles,
  Type,
  X,
  type LucideIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { duration, ease } from "@/lib/motion";
import { STUDIO_FORMATS, type StageId, type StudioType } from "@/lib/studio/formats";
import type { StudioSession } from "@/lib/studio/session-store";
import { getTemplate } from "@/lib/studio/templates";
import { PreviewSkeleton } from "./previews/PreviewSkeleton";
import { formatElapsed, useElapsed } from "./studio-ui";

/** Typical seconds per format — paces the progress bar, never shown as a promise. */
const TYPICAL_SECONDS: Record<StudioType, number> = {
  social: 20,
  carousel: 30,
  image: 50,
  ad: 60,
  video: 140,
  script: 20,
  article: 45,
};

const STAGE_ICON: Record<StageId, LucideIcon> = {
  context: Brain,
  angle: Compass,
  outline: ListTree,
  writing: PenLine,
  brief: Palette,
  captions: Type,
  render: Camera,
  save: Save,
  polish: Sparkles,
};

/** Each stage's icon acts out what it does while it's the current stage. */
const STAGE_MOTION: Record<StageId, { animate: TargetAndTransition; duration: number }> = {
  context: { animate: { scale: [1, 1.2, 1] }, duration: 1.6 },
  angle: { animate: { rotate: [0, 30, -20, 0] }, duration: 2.2 },
  outline: { animate: { y: [0, -1.5, 0] }, duration: 1.2 },
  writing: { animate: { x: [0, 1.5, -1, 0], rotate: [-8, 6, -8] }, duration: 1.1 },
  brief: { animate: { rotate: [0, -14, 14, 0] }, duration: 2 },
  captions: { animate: { scale: [1, 1.15, 1] }, duration: 1.3 },
  render: { animate: { scale: [1, 0.8, 1] }, duration: 1.4 },
  save: { animate: { y: [0, 2.5, 0] }, duration: 1.2 },
  polish: { animate: { rotate: [0, 180], scale: [1, 1.18, 1] }, duration: 2.4 },
};

const CANVAS_CAPTION: Record<StageId, string> = {
  context: "Reading your brand",
  angle: "Picking the idea",
  outline: "Planning it out",
  writing: "Writing the draft",
  brief: "Planning the look",
  captions: "Matching the captions",
  render: "Creating the image",
  save: "Saving to your Library",
  polish: "Final polish",
};

/**
 * Generation progress: the stages on the left, the result taking shape on
 * the right.
 *
 * This whole view re-renders every second (the timer), so every swap in it
 * is enter-only — an exit animation interrupted by a re-render can strand.
 */
export function GenerationProgress({
  session,
  onCancel,
  onMinimize,
  cancelling,
}: {
  session: StudioSession;
  onCancel: () => void;
  onMinimize: () => void;
  cancelling?: boolean;
}) {
  const format = STUDIO_FORMATS[session.type];
  const reduce = useReducedMotion();
  const job = session.job;
  const stages = format.stages;
  const stageIndex = Math.max(
    0,
    stages.findIndex((s) => s.id === job?.stage),
  );
  const stage = stages[stageIndex];
  const startedAt = job ? Date.parse(job.created_at) : session.updatedAt;
  const elapsed = useElapsed(startedAt);
  const template = getTemplate(session.template);
  const [confirmCancel, setConfirmCancel] = useState(false);
  useEffect(() => {
    if (!confirmCancel) return;
    const t = window.setTimeout(() => setConfirmCancel(false), 5000);
    return () => window.clearTimeout(t);
  }, [confirmCancel]);

  const typical = TYPICAL_SECONDS[session.type];
  const perStage = typical / stages.length;
  const slow = elapsed > typical * 2 && !(session.type === "video" && stage?.id === "render");
  const starting = !job;
  const CaptionIcon = stage ? STAGE_ICON[stage.id] : Sparkles;

  return (
    <div
      className={`studio-tone-${session.type} flex h-full min-h-0 flex-col @3xl/composer:grid @3xl/composer:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]`}
    >
      {/* ── The plan ── */}
      <div className="order-2 flex min-h-0 flex-col px-5 pb-5 pt-5 @3xl/composer:order-none @3xl/composer:overflow-y-auto @3xl/composer:px-8 @3xl/composer:pb-6 @3xl/composer:pt-8">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2.5 text-[1.375rem] font-semibold leading-tight tracking-tight text-foreground">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-50" />
              <span className="relative inline-flex size-2 rounded-full bg-primary" />
            </span>
            Creating your {format.noun}
          </h2>
          <span
            className="font-mono text-xs tabular-nums text-muted-foreground"
            aria-label={`Elapsed ${elapsed} seconds`}
          >
            {formatElapsed(elapsed)}
          </span>
        </div>

        {/* Segmented progress: done stages fill, the current one advances at a typical pace. */}
        <div
          className="mt-5 flex gap-1"
          role="progressbar"
          aria-label="Generation progress"
          aria-valuemin={0}
          aria-valuemax={stages.length}
          aria-valuenow={stageIndex}
          aria-valuetext={stage?.label}
        >
          {stages.map((s, i) => (
            <span
              key={s.id}
              className="relative h-1 flex-1 overflow-hidden rounded-full bg-foreground/[0.08]"
            >
              {i < stageIndex ? (
                <motion.span
                  className="absolute inset-0 origin-left rounded-full bg-primary"
                  initial={reduce ? false : { scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: duration.slow, ease: ease.emphasized }}
                />
              ) : i === stageIndex && !starting ? (
                <motion.span
                  key={s.id}
                  className="studio-progress-fill absolute inset-y-0 left-0 rounded-full"
                  initial={{ width: "4%" }}
                  animate={{ width: "88%" }}
                  transition={{ duration: Math.max(4, perStage * 1.6), ease: [0.1, 0.6, 0.3, 1] }}
                />
              ) : null}
            </span>
          ))}
        </div>

        <ol className="relative mt-6" aria-label="Stages">
          {stages.map((s, i) => {
            const state =
              i < stageIndex ? "done" : i === stageIndex && !starting ? "current" : "todo";
            const last = i === stages.length - 1;
            const Icon = STAGE_ICON[s.id];
            const act = STAGE_MOTION[s.id];
            return (
              <li
                key={s.id}
                className="relative flex items-center gap-3 pb-3.5 last:pb-0"
                aria-current={state === "current" ? "step" : undefined}
              >
                {!last ? (
                  <span aria-hidden className="absolute bottom-0 left-[13px] top-7 w-px bg-border">
                    <motion.span
                      className="absolute inset-x-0 top-0 origin-top bg-primary"
                      initial={false}
                      animate={{ height: state === "done" ? "100%" : "0%" }}
                      transition={{ duration: duration.xslow, ease: ease.emphasized }}
                    />
                  </span>
                ) : null}
                <span
                  className={cn(
                    "relative grid size-[27px] shrink-0 place-items-center rounded-full transition-colors duration-[--motion-duration-slow]",
                    state === "done" && "bg-primary text-primary-foreground",
                    state === "current" &&
                      "studio-ring bg-[hsl(var(--tone)/0.14)] text-[hsl(var(--tone))] ring-1 ring-[hsl(var(--tone)/0.3)]",
                    state === "todo" && "bg-surface-3 text-muted-foreground/50 ring-1 ring-border",
                  )}
                >
                  {state === "done" ? (
                    <motion.span
                      initial={reduce ? false : { scale: 0.4, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ duration: duration.medium, ease: ease.emphasized }}
                    >
                      <Check className="size-3.5" strokeWidth={3} />
                    </motion.span>
                  ) : state === "current" ? (
                    <motion.span
                      key={`act-${s.id}`}
                      className="grid place-items-center"
                      animate={act.animate}
                      transition={{ duration: act.duration, repeat: Infinity, ease: "easeInOut" }}
                    >
                      <Icon className="size-3.5" />
                    </motion.span>
                  ) : (
                    <Icon className="size-3.5" />
                  )}
                </span>
                <span
                  className={cn(
                    "text-sm leading-6 transition-colors duration-[--motion-duration-slow]",
                    state === "current" && "font-medium text-foreground",
                    state === "done" && "text-muted-foreground",
                    state === "todo" && "text-muted-foreground/60",
                  )}
                >
                  {s.label}
                </span>
              </li>
            );
          })}
        </ol>

        <AnimatePresence>
          {slow ? (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="mt-5 text-xs leading-relaxed text-muted-foreground"
            >
              Taking longer than usual. You can keep working — we'll tell you when it's ready.
            </motion.p>
          ) : null}
        </AnimatePresence>

        <div className="mt-auto pt-7">
          {confirmCancel ? (
            <motion.div
              key="confirm"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: duration.base }}
              className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 p-2 pl-3.5"
            >
              <span className="mr-auto text-sm text-foreground">Stop and discard this run?</span>
              <Button variant="ghost" size="sm" onClick={() => setConfirmCancel(false)}>
                Keep going
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onCancel}
                loading={cancelling}
                className="text-danger"
              >
                Stop
              </Button>
            </motion.div>
          ) : (
            <motion.div
              key="actions"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: duration.base }}
              className="flex flex-wrap items-center gap-2"
            >
              <Button variant="outline" size="sm" onClick={onMinimize}>
                <Minus />
                Run in background
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setConfirmCancel(true)}
                loading={cancelling}
              >
                <X />
                Cancel
              </Button>
            </motion.div>
          )}
        </div>
      </div>

      {/* ── The result taking shape ── */}
      <div className="order-1 p-3 @3xl/composer:order-none @3xl/composer:p-4 @3xl/composer:pl-0">
        <div className="studio-canvas studio-ring studio-ring-slow relative flex h-[380px] items-center justify-center overflow-hidden rounded-2xl ring-1 ring-border/70 @3xl/composer:h-full @3xl/composer:min-h-[420px]">
          <div aria-hidden className="studio-aurora" />
          <div className="relative flex max-h-full w-full origin-center scale-[0.7] items-center justify-center overflow-visible px-6 pb-6 pt-12 @3xl/composer:scale-100">
            <PreviewSkeleton
              session={session}
              stageIndex={starting ? 0 : stageIndex}
              template={template}
            />
          </div>
          <motion.p
            key={stage?.id ?? "start"}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: duration.medium, ease: ease.emphasized }}
            className="absolute bottom-3 left-1/2 hidden -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-3/85 px-3 py-1 text-[11px] text-muted-foreground shadow-1 ring-1 ring-border/60 backdrop-blur @3xl/composer:inline-flex"
          >
            <CaptionIcon className="size-3 text-[hsl(var(--tone))]" />
            <span className="font-medium text-foreground">
              {stage
                ? stage.id === "render" && session.type === "video"
                  ? "Creating the video"
                  : CANVAS_CAPTION[stage.id]
                : "Warming up"}
            </span>
            <span aria-hidden>·</span>
            {stageIndex + 1} of {stages.length}
          </motion.p>
        </div>
      </div>
    </div>
  );
}
