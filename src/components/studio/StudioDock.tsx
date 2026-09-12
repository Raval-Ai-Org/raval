"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, X } from "@/components/icons";
import { cn } from "@/lib/utils";
import { duration, ease } from "@/lib/motion";
import { STUDIO_FORMATS } from "@/lib/studio/formats";
import { isActiveJob } from "@/lib/studio/jobs";
import {
  discardSession,
  focusSession,
  useStudioStore,
  type StudioSession,
} from "@/lib/studio/session-store";
import { TypeGlyph } from "./studio-ui";

function describe(s: StudioSession): {
  label: string;
  state: "working" | "ready" | "failed" | "draft";
  progress: number;
} {
  const format = STUDIO_FORMATS[s.type];
  const active = !!s.pendingKey || (s.job && isActiveJob(s.job));
  if (active) {
    const i = Math.max(
      0,
      format.stages.findIndex((st) => st.id === s.job?.stage),
    );
    return {
      label: format.stages[i]?.label ?? "Starting",
      state: "working",
      progress: (i + 0.5) / format.stages.length,
    };
  }
  if (s.job?.status === "failed" && !s.lastGood)
    return { label: "Couldn't finish — open to retry", state: "failed", progress: 1 };
  if (s.lastGood) return { label: "Ready for review", state: "ready", progress: 1 };
  return { label: "Brief in progress", state: "draft", progress: 0 };
}

function Ring({ progress, state }: { progress: number; state: string }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 24 24" className="absolute -inset-1 size-10 -rotate-90" aria-hidden>
      <circle cx="12" cy="12" r={r} fill="none" stroke="hsl(var(--border))" strokeWidth="1.5" />
      {state !== "draft" ? (
        <motion.circle
          cx="12"
          cy="12"
          r={r}
          fill="none"
          stroke={state === "failed" ? "hsl(var(--danger))" : "hsl(var(--primary))"}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - progress) }}
          transition={{ duration: duration.slow, ease: ease.emphasized }}
        />
      ) : null}
    </svg>
  );
}

/** Minimized Studio work, pinned bottom-right. Generation continues while here. */
export function StudioDock() {
  // Select stable references; derive the list here (a filtered array from the
  // selector would be a new snapshot on every read).
  const sessions = useStudioStore((s) => s.sessions);
  const activeId = useStudioStore((s) => s.activeId);
  const visible = sessions
    .filter((s) => s.window === "minimized" || s.id !== activeId)
    .filter((s) => s.id !== activeId)
    .slice(0, 4);
  if (!visible.length) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-40 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2 pb-[env(safe-area-inset-bottom)]"
      aria-label="Minimized Studio work"
    >
      <AnimatePresence initial={false}>
        {visible.map((s) => {
          const d = describe(s);
          const title =
            s.lastGood?.title ??
            s.job?.title ??
            (s.brief.trim() ? s.brief.slice(0, 60) : `New ${STUDIO_FORMATS[s.type].noun}`);
          return (
            <motion.div
              key={s.id}
              layout
              initial={{ opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96, transition: { duration: duration.fast } }}
              transition={{ duration: duration.medium, ease: ease.emphasized }}
              className="pointer-events-auto flex w-[300px] max-w-full items-center gap-3 rounded-xl border border-border bg-surface-4 p-2 pr-1.5 shadow-3"
            >
              <button
                type="button"
                onClick={() => focusSession(s.id)}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55"
                aria-label={`Restore: ${title}`}
              >
                <span className="relative grid size-8 shrink-0 place-items-center">
                  <Ring progress={d.progress} state={d.state} />
                  {d.state === "ready" ? (
                    <span className="grid size-6 place-items-center rounded-full bg-primary text-primary-foreground">
                      <Check className="size-3.5" strokeWidth={3} />
                    </span>
                  ) : d.state === "failed" ? (
                    <AlertTriangle className="size-4 text-danger" />
                  ) : (
                    <TypeGlyph type={s.type} size="sm" className="bg-transparent ring-0" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {title}
                  </span>
                  <span
                    className={cn(
                      "block truncate text-xs",
                      d.state === "failed" ? "text-danger" : "text-muted-foreground",
                    )}
                  >
                    {d.label}
                  </span>
                </span>
              </button>
              {d.state !== "working" ? (
                <button
                  type="button"
                  onClick={() => discardSession(s.id)}
                  aria-label={`Dismiss: ${title}`}
                  title={d.state === "ready" ? "Dismiss — it stays in Needs Approval" : "Dismiss"}
                  className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
