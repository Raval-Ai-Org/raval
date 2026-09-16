"use client";

import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, X } from "@/components/icons";
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
import { Burst, DrawCheck, formatElapsed, TypeGlyph, useElapsed, Weave } from "./studio-ui";

type DockState = "working" | "ready" | "failed" | "draft";

function describe(s: StudioSession): { label: string; state: DockState; progress: number } {
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

/** Minimized Studio work, pinned bottom-right. Generation continues while here. */
export function StudioDock() {
  // Select stable references; derive the list here (a filtered array from the
  // selector would be a new snapshot on every read).
  const sessions = useStudioStore((s) => s.sessions);
  const activeId = useStudioStore((s) => s.activeId);
  // Only this workspace's work: another brand's drafts never dock here.
  const workspaceId = useOptionalWorkspaceId();
  const visible = sessions
    .filter((s) => s.workspaceId === workspaceId && s.id !== activeId)
    .slice(0, 4);

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-40 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2 pb-[env(safe-area-inset-bottom)]"
      aria-label="Minimized Studio work"
    >
      <AnimatePresence initial={false}>
        {visible.map((s) => (
          <DockCard key={s.id} session={s} />
        ))}
      </AnimatePresence>
    </div>
  );
}

export function DockCard({ session: s }: { session: StudioSession }) {
  const reduce = useReducedMotion();
  const d = describe(s);
  const format = STUDIO_FORMATS[s.type];
  const startedAt = s.job ? Date.parse(s.job.created_at) : s.updatedAt;
  const elapsed = useElapsed(startedAt);
  const title =
    s.lastGood?.title ??
    s.job?.title ??
    (s.brief.trim() ? s.brief.slice(0, 60) : `New ${format.noun}`);

  return (
    <motion.div
      layout
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.96, transition: { duration: duration.fast } }}
      transition={{ duration: duration.slow, ease: ease.emphasized }}
      className={cn(
        "group pointer-events-auto relative w-[320px] max-w-full overflow-hidden rounded-2xl bg-surface-4/95 shadow-4 ring-1 backdrop-blur transition-shadow duration-[--motion-duration-slow]",
        `studio-tone-${s.type}`,
        d.state === "ready"
          ? "ring-primary-border shadow-[0_20px_44px_-20px_hsl(var(--primary)/0.6)]"
          : d.state === "failed"
            ? "ring-danger-border"
            : d.state === "working"
              ? "studio-ring ring-border/40"
              : "ring-border/70",
      )}
    >
      {d.state === "working" ? <Weave className="opacity-60" /> : null}
      <div className="relative flex items-center gap-3 p-2.5 pr-2">
        <button
          type="button"
          onClick={() => focusSession(s.id)}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55"
          aria-label={`Restore: ${title}`}
        >
          <span
            className={cn(
              "relative grid size-10 shrink-0 place-items-center rounded-xl transition-colors duration-[--motion-duration-slow]",
              d.state === "ready" &&
                "studio-cta !overflow-visible bg-primary text-primary-foreground",
              d.state === "failed" && "bg-danger-surface text-danger ring-1 ring-danger-border",
              (d.state === "working" || d.state === "draft") && "bg-surface-2 ring-1 ring-border",
            )}
          >
            {d.state === "ready" ? (
              <>
                <DrawCheck className="size-5" delay={0.15} />
                <Burst radius={30} count={10} />
              </>
            ) : d.state === "failed" ? (
              <AlertTriangle className="size-4" />
            ) : (
              <TypeGlyph type={s.type} className="bg-transparent ring-0" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">{title}</span>
            <>
              <motion.span
                key={d.label}
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: duration.base }}
                className={cn(
                  "block truncate text-xs",
                  d.state === "failed" ? "text-danger" : "text-muted-foreground",
                )}
              >
                {d.label}
              </motion.span>
            </>
          </span>
        </button>
        {d.state === "working" ? (
          <span className="shrink-0 pr-1.5 font-mono text-[11px] tabular-nums text-muted-foreground">
            {formatElapsed(elapsed)}
          </span>
        ) : (
          <>
            {d.state === "ready" ? (
              <button
                type="button"
                onClick={() => focusSession(s.id)}
                className="shrink-0 rounded-full bg-primary-surface px-2.5 py-1 text-xs font-medium text-foreground ring-1 ring-primary-border transition-colors hover:bg-primary hover:text-primary-foreground"
              >
                Review
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => discardSession(s.id)}
              aria-label={`Dismiss: ${title}`}
              title={d.state === "ready" ? "Dismiss — it stays in Needs Approval" : "Dismiss"}
              className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </>
        )}
      </div>
      {d.state === "working" ? (
        <span className="absolute inset-x-0 bottom-0 h-0.5 bg-foreground/[0.06]">
          <motion.span
            className="absolute inset-y-0 left-0 bg-primary"
            initial={false}
            animate={{ width: `${Math.round(d.progress * 100)}%` }}
            transition={{ duration: duration.xslow, ease: ease.emphasized }}
          />
        </span>
      ) : null}
    </motion.div>
  );
}
