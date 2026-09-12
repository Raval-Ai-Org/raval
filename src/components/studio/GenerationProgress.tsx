"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check, Minus, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { duration, ease } from "@/lib/motion";
import { STUDIO_FORMATS } from "@/lib/studio/formats";
import type { StudioSession } from "@/lib/studio/session-store";
import { PreviewSkeleton } from "./previews/PreviewSkeleton";

function elapsedLabel(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/**
 * Staged progress driven by the job's real stage. Completed stages are
 * checked, the current one breathes, upcoming ones wait — and beside it the
 * result takes shape as a skeleton of the actual format and size.
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
  const startedAt = job ? Date.parse(job.created_at) : session.updatedAt;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const rendering = job?.stage === "render";

  return (
    <div className="grid h-full min-h-0 gap-6 p-5 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)] md:p-8">
      <div className="flex flex-col">
        <p className="ui-eyebrow">Creating your {format.noun}</p>
        <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
          {stages[stageIndex]?.label ?? "Getting started"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
          {rendering && session.type === "video"
            ? "Video renders take a few minutes. You can keep working — it will land in Needs Approval."
            : `${format.estimate}. Elapsed ${elapsedLabel(now - startedAt)}.`}
        </p>

        <ol className="mt-6 space-y-1" aria-label="Progress">
          {stages.map((stage, i) => {
            const state = i < stageIndex ? "done" : i === stageIndex ? "current" : "todo";
            return (
              <li
                key={stage.id}
                className="flex items-center gap-3 py-1.5"
                aria-current={state === "current" ? "step" : undefined}
              >
                <span
                  className={cn(
                    "relative grid size-5 shrink-0 place-items-center rounded-full",
                    state === "done" && "bg-primary text-primary-foreground",
                    state === "current" && "bg-primary-surface ring-1 ring-primary-border",
                    state === "todo" && "bg-surface-2 ring-1 ring-border",
                  )}
                >
                  {state === "done" ? <Check className="size-3" strokeWidth={3} /> : null}
                  {state === "current" ? (
                    <motion.span
                      className="size-2 rounded-full bg-primary"
                      animate={reduce ? undefined : { scale: [1, 1.35, 1], opacity: [1, 0.6, 1] }}
                      transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                    />
                  ) : null}
                </span>
                <motion.span
                  initial={false}
                  animate={{ opacity: state === "todo" ? 0.55 : 1 }}
                  transition={{ duration: duration.medium, ease: ease.standard }}
                  className={cn(
                    "text-sm",
                    state === "current" ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  {stage.label}
                </motion.span>
              </li>
            );
          })}
        </ol>

        {session.brief ? (
          <div className="mt-8 rounded-xl bg-surface-2 p-3.5 ring-1 ring-border">
            <p className="ui-eyebrow">Your brief</p>
            <p className="mt-1.5 line-clamp-4 text-sm leading-relaxed text-foreground">
              {session.brief}
            </p>
          </div>
        ) : null}

        <div className="mt-auto flex flex-wrap gap-2 pt-6">
          <Button variant="outline" size="sm" onClick={onMinimize}>
            <Minus />
            Keep working
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={cancelling}>
            <X />
            {cancelling ? "Stopping…" : "Cancel"}
          </Button>
        </div>
      </div>

      <div className="flex min-h-[280px] items-center justify-center rounded-2xl bg-surface-2 p-4 ring-1 ring-border md:p-8">
        <PreviewSkeleton session={session} stageIndex={stageIndex} />
      </div>
    </div>
  );
}
