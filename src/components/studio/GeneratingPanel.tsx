"use client";

// Holo's "Generating…" card: floats at the canvas's top right while pieces
// are being made, one row per piece, each turning green when it is ready.
// Generate closes Studio, so this list is where a person follows the work:
// each row names the piece and the step it is on, and any row opens it.
// Only work seen running in this tab is listed, so a page load never shows
// old pieces. The card goes when closed and comes back with the next piece.
// While a screen is open on the canvas the card folds into a small pill in
// the corner (`compact`), so the work stays in view without covering the
// screen; a press unfolds the list.
// Presentational halves: GeneratingPanelView and GeneratingPill.

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, Check, ChevronRight, Sparkles, X } from "@/components/icons";
import {
  addAppEventListener,
  emitAppEvent,
  removeAppEventListener,
  type AppEvent,
} from "@/lib/app-events";
import { useNavigate } from "@/lib/navigation";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { STUDIO_FORMATS } from "@/lib/studio/formats";
import { isActiveJob, type StudioJob } from "@/lib/studio/jobs";
import { focusSession, openJob, useStudioStore } from "@/lib/studio/session-store";
import { cn } from "@/lib/utils";
import { TypeGlyph } from "./studio-ui";

export type GeneratingRow = {
  id: string;
  /** A Studio piece's format; other work (a strategy, a plan) has none. */
  type?: StudioJob["type"];
  /** For other work: what the row says when it is done ("Strategy ready"). */
  doneLabel?: string;
  state: "working" | "done" | "failed";
  /** What the piece is about (the job's title or brief). */
  title?: string;
  /** The step it is on while working ("Writing captions"). */
  step?: string;
};

export function GeneratingPanelView({
  rows,
  onOpen,
  onClose,
  className,
}: {
  rows: GeneratingRow[];
  onOpen: (id: string) => void;
  onClose: () => void;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const working = rows.filter((r) => r.state === "working").length;
  return (
    <motion.section
      aria-label="Generating"
      initial={reduce ? { opacity: 0 } : { opacity: 0, x: 24, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, x: 24 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      className={cn(
        "w-[300px] max-w-full rounded-[22px] border border-[var(--ds-card-border)] bg-[var(--ds-glass-bg)] p-2 shadow-[var(--ds-pop-shadow)] backdrop-blur-xl",
        className,
      )}
    >
      <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
        <p className="flex items-center gap-2 text-[13px] font-bold">
          {working ? (
            <span aria-hidden className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--mox-green)] opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-[var(--mox-green)]" />
            </span>
          ) : (
            <Check className="size-3.5 text-[var(--mox-green)]" strokeWidth={3} />
          )}
          {working
            ? rows.every((r) => r.type)
              ? `Making ${working} ${working === 1 ? "piece" : "pieces"}`
              : `Working on ${working}`
            : "All done"}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid size-7 place-items-center rounded-full text-muted-foreground transition hover:bg-[var(--ds-well-bg)] hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
      {/* A long list scrolls inside the card instead of running off screen. */}
      <ul className="flex max-h-[min(55vh,420px)] flex-col gap-1 overflow-y-auto overscroll-contain">
        <AnimatePresence initial={false}>
          {rows.map((r) => {
            const label = (r.type && STUDIO_FORMATS[r.type]?.label) || "Piece";
            return (
              <motion.li
                key={r.id}
                layout={!reduce}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
              >
                <button
                  type="button"
                  onClick={() => onOpen(r.id)}
                  aria-label={`${r.title ?? label}: ${r.state === "working" ? (r.step ?? "in progress") : r.state === "done" ? "ready, open it" : "failed, open it"}`}
                  className={cn(
                    "group relative flex min-h-[52px] w-full items-center gap-2.5 overflow-hidden rounded-[14px] px-2 py-1.5 text-left text-[12.5px] font-semibold transition-colors",
                    r.state === "done"
                      ? "bg-[var(--mox-green)]/12 text-[var(--mox-green-deep)] hover:bg-[var(--mox-green)]/20 dark:text-[var(--mox-lime)]"
                      : r.state === "failed"
                        ? "bg-destructive/10 text-destructive hover:bg-destructive/15"
                        : "bg-[var(--ds-well-bg)] text-foreground/80 hover:bg-[var(--ds-well-bg-hover)]",
                  )}
                >
                  {r.state === "working" ? (
                    <span
                      aria-hidden
                      className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden"
                    >
                      <motion.span
                        className="absolute inset-y-0 w-1/3 rounded-full [background:var(--mox-gradient)]"
                        animate={reduce ? undefined : { x: ["-100%", "320%"] }}
                        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                      />
                    </span>
                  ) : null}
                  {r.type ? (
                    <TypeGlyph
                      type={r.type}
                      size="sm"
                      className="size-7 shrink-0 [&_svg]:size-3.5"
                    />
                  ) : (
                    <span className="ds-grad-pill grid size-7 shrink-0 place-items-center rounded-[10px] text-[var(--mox-ink)]">
                      <Sparkles className="size-3.5" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{r.title || label}</span>
                    <span className="block truncate text-[11px] font-medium opacity-70">
                      {r.state === "working"
                        ? (r.step ?? "In progress") + "…"
                        : r.state === "done"
                          ? (r.doneLabel ?? `${label} ready`)
                          : r.type
                            ? `${label} failed`
                            : "Didn't finish"}
                    </span>
                  </span>
                  {r.state === "working" ? (
                    <span
                      aria-hidden
                      className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-foreground/15 border-t-[var(--mox-green)]"
                    />
                  ) : r.state === "done" ? (
                    <>
                      <Check className="size-3.5 shrink-0 group-hover:hidden" strokeWidth={3} />
                      <ChevronRight className="hidden size-3.5 shrink-0 group-hover:block" />
                    </>
                  ) : (
                    <AlertTriangle className="size-3.5 shrink-0" />
                  )}
                </button>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </motion.section>
  );
}

/** The folded card: one pill that says how much is being made. */
export function GeneratingPill({
  rows,
  onOpen,
  className,
}: {
  rows: GeneratingRow[];
  onOpen: () => void;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const working = rows.filter((r) => r.state === "working").length;
  const failed = rows.filter((r) => r.state === "failed").length;
  const ready = rows.length - working - failed;
  const first = rows.find((r) => r.state === "working");
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      aria-label={
        working
          ? `Making ${working} ${working === 1 ? "piece" : "pieces"}. Show the list`
          : "Finished. Show the list"
      }
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      className={cn(
        "group relative inline-flex h-11 max-w-[280px] items-center gap-2.5 overflow-hidden rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-glass-bg)] pl-3.5 pr-4 text-left text-[12.5px] font-semibold shadow-[var(--ds-pop-shadow)] backdrop-blur-xl transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        className,
      )}
    >
      {working ? (
        <span aria-hidden className="relative flex size-2 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--mox-green)] opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-[var(--mox-green)]" />
        </span>
      ) : failed && !ready ? (
        <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
      ) : (
        <Check className="size-3.5 shrink-0 text-[var(--mox-green)]" strokeWidth={3} />
      )}
      <span className="min-w-0">
        <span className="block truncate">
          {working
            ? `Making ${working} ${working === 1 ? "piece" : "pieces"}`
            : ready
              ? `${ready} ready`
              : "Didn't finish"}
        </span>
        {first?.step ? (
          <span className="block truncate text-[11px] font-medium text-muted-foreground">
            {first.step}…
          </span>
        ) : null}
      </span>
      <ChevronRight className="size-3.5 shrink-0 -rotate-90 text-muted-foreground transition-transform group-hover:-translate-y-0.5" />
      {working ? (
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden">
          <motion.span
            className="absolute inset-y-0 w-1/3 rounded-full [background:var(--mox-gradient)]"
            animate={reduce ? undefined : { x: ["-100%", "320%"] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          />
        </span>
      ) : null}
    </motion.button>
  );
}

/** The wired card, mounted once on the workspace column. */
export function GeneratingPanel({
  className,
  compact = false,
}: {
  className?: string;
  /** A screen is open on the canvas: fold into the corner pill. */
  compact?: boolean;
}) {
  const workspaceId = useOptionalWorkspaceId();
  const jobs = useStudioStore((s) => s.jobs);
  const sessions = useStudioStore((s) => s.sessions);
  // Ids seen running in this tab, newest first.
  const seen = useRef<string[]>([]);
  const [, bump] = useState(0);
  const [closed, setClosed] = useState(false);
  // Folded, the list opens on a press and folds again once a row is opened.
  const [unfolded, setUnfolded] = useState(false);
  useEffect(() => {
    if (!compact) setUnfolded(false);
  }, [compact]);
  const navigate = useNavigate();
  // Other background work, newest first (see the `work:update` event).
  const [tasks, setTasks] = useState<(GeneratingRow & { href?: string; ugcProjectId?: string })[]>(
    [],
  );
  useEffect(() => {
    const on = (e: AppEvent<"work:update">) => {
      const { id, title, state, step, doneLabel, href, ugcProjectId } = e.detail;
      const row = { id: `task:${id}`, title, state, step, doneLabel, href, ugcProjectId };
      setTasks((list) => [row, ...list.filter((r) => r.id !== row.id)].slice(0, 4));
      setClosed(false);
    };
    addAppEventListener("work:update", on);
    return () => removeAppEventListener("work:update", on);
  }, []);

  useEffect(() => {
    let added = false;
    for (const j of jobs) {
      if (j.parent_job_id || (workspaceId && j.workspace_id !== workspaceId)) continue;
      if (isActiveJob(j) && !seen.current.includes(j.id)) {
        seen.current = [j.id, ...seen.current].slice(0, 5);
        added = true;
      }
    }
    if (added) {
      setClosed(false);
      bump((n) => n + 1);
    }
  }, [jobs, workspaceId]);

  const rows: GeneratingRow[] = seen.current.flatMap((id) => {
    const j = jobs.find((x) => x.id === id);
    if (!j || j.status === "cancelled") return [];
    const state = isActiveJob(j) ? "working" : j.status === "succeeded" ? "done" : "failed";
    const step = STUDIO_FORMATS[j.type]?.stages.find((s) => s.id === j.stage)?.label;
    // A long video stops at its storyboard: the row says so, and opens it.
    const board = j.output?.storyboard?.status === "preview";
    return [
      {
        id,
        type: j.type,
        state,
        title: j.title || undefined,
        step: board && state === "working" ? "Planning the storyboard" : step,
        ...(board ? { doneLabel: "Storyboard ready" } : {}),
      } as GeneratingRow,
    ];
  });
  // A piece whose start request hasn't answered yet has no job to follow;
  // list it too, so pressing Generate always shows something here.
  const startingSessions = sessions.filter(
    (s) =>
      s.pendingKey &&
      !(s.job && isActiveJob(s.job)) &&
      s.window === "minimized" &&
      (!workspaceId || s.workspaceId === workspaceId),
  );
  // A new piece always brings the card back, even after it was closed.
  const startingKey = startingSessions.map((s) => s.pendingKey).join(",");
  useEffect(() => {
    if (startingKey) setClosed(false);
  }, [startingKey]);
  const starting: GeneratingRow[] = startingSessions.map((s) => ({
    id: `session:${s.id}`,
    type: s.type,
    state: "working",
    title: s.brief.trim().slice(0, 80) || undefined,
    step: "Starting",
  }));
  const all = [...tasks, ...starting, ...rows];

  return (
    <AnimatePresence>
      {!closed && all.length > 0 && compact && !unfolded ? (
        <GeneratingPill
          key="generating-pill"
          rows={all}
          className={className}
          onOpen={() => setUnfolded(true)}
        />
      ) : !closed && all.length > 0 ? (
        <GeneratingPanelView
          key="generating"
          rows={all}
          className={className}
          onOpen={(id) => {
            setUnfolded(false);
            if (id.startsWith("session:")) return focusSession(id.slice("session:".length));
            const task = tasks.find((t) => t.id === id);
            if (!task) return void openJob(id, workspaceId);
            if (task.ugcProjectId)
              return emitAppEvent("open:ugc-studio", { projectId: task.ugcProjectId });
            if (task.href) navigate({ to: task.href });
          }}
          onClose={() => {
            // Folded into the corner, the cross only folds it again while
            // something is still being made.
            if (compact && all.some((r) => r.state === "working")) return setUnfolded(false);
            setClosed(true);
            setTasks((list) => list.filter((t) => t.state === "working"));
            seen.current = seen.current.filter((id) => {
              const j = jobs.find((x) => x.id === id);
              return j ? isActiveJob(j) : false;
            });
          }}
        />
      ) : null}
    </AnimatePresence>
  );
}
