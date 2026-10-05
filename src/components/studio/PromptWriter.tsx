"use client";

// "Write it for me" on the Studio description box. Writes a long, detailed,
// timely description for the current format (or expands what the person
// wrote), reveals it into the box, and remembers what it gave so the next
// click brings something new.
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import { RefreshCw, Sparkles, Wand2 } from "@/components/icons";
import { cn } from "@/lib/utils";
import { duration, ease } from "@/lib/motion";
import { readBrandPayload, studioApi, type WrittenPrompt } from "@/lib/studio/client";
import { getTemplate } from "@/lib/studio/templates";
import { updateSession, type StudioSession } from "@/lib/studio/session-store";

const HISTORY_LIMIT = 30;

function historyKey(workspaceId: string) {
  return `studio:written-prompts:${workspaceId}`;
}

function readHistory(workspaceId: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(historyKey(workspaceId)) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function remember(workspaceId: string, items: (string | null)[]) {
  try {
    const next = [...items.filter((x): x is string => !!x), ...readHistory(workspaceId)];
    localStorage.setItem(
      historyKey(workspaceId),
      JSON.stringify([...new Set(next)].slice(0, HISTORY_LIMIT)),
    );
  } catch {
    /* ignore */
  }
}

const STATUS = [
  "Checking what's trending",
  "Reading your brand",
  "Finding a fresh angle",
  "Writing the details",
  "Polishing your prompt",
];

export type PromptWriterState = {
  busy: boolean;
  status: string;
  result: WrittenPrompt | null;
  label: string;
  write: () => void;
};

export function usePromptWriter(session: StudioSession): PromptWriterState {
  const reduce = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const [statusIndex, setStatusIndex] = useState(0);
  const [result, setResult] = useState<WrittenPrompt | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!busy) return;
    setStatusIndex(0);
    const t = window.setInterval(
      () => setStatusIndex((i) => Math.min(i + 1, STATUS.length - 1)),
      1700,
    );
    return () => window.clearInterval(t);
  }, [busy]);

  // A new format starts fresh.
  useEffect(() => setResult(null), [session.type]);

  const template = getTemplate(session.template);
  const brief = session.brief.trim();
  const isOurs = !!result && brief === result.prompt.trim();
  const isStarter = !!template && brief === template.starter.trim();
  const hasOwnIdea = brief.length >= 12 && !isOurs && !isStarter;

  const label = busy
    ? "Writing…"
    : isOurs
      ? "Try another"
      : hasOwnIdea
        ? "Improve it"
        : "Write it for me";

  const write = async () => {
    if (busy) return;
    const previous = {
      brief: session.brief,
      goal: session.goal,
      ideaId: session.ideaId,
      ideaSource: session.ideaSource,
    };
    setBusy(true);
    try {
      const written = await studioApi.writePrompt({
        workspaceId: session.workspaceId,
        type: session.type,
        brand: readBrandPayload(session.workspaceId),
        current: hasOwnIdea ? session.brief : undefined,
        template: session.template,
        goal: session.goal,
        controls: session.controls,
        avoid: [
          ...(result ? [result.title, result.signal ?? ""] : []),
          ...readHistory(session.workspaceId),
        ]
          .filter(Boolean)
          .slice(0, HISTORY_LIMIT),
      });
      if (!alive.current) return;
      remember(session.workspaceId, [written.title, written.signal]);

      // Reveal the prompt into the box, a few characters at a time.
      const full = written.prompt;
      if (!reduce) {
        const steps = 28;
        for (let i = 1; i < steps; i++) {
          updateSession(session.id, {
            brief: full.slice(0, Math.round((full.length * i) / steps)),
          });
          await new Promise((r) => window.setTimeout(r, 26));
          if (!alive.current) return;
        }
      }
      updateSession(session.id, {
        brief: full,
        goal: session.goal ?? written.goal,
        ideaId: undefined,
        ideaSource: undefined,
        error: null,
      });
      setResult(written);
      toast.success("Your prompt is ready", {
        description: written.title,
        action: {
          label: "Undo",
          onClick: () => {
            updateSession(session.id, previous);
            setResult(null);
          },
        },
      });
    } catch (e) {
      toast.error("Couldn't write a prompt", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return {
    busy,
    status: STATUS[statusIndex],
    result: isOurs ? result : null,
    label,
    write: () => void write(),
  };
}

/** The button that sits in the description box's footer. */
export function WriteForMeButton({
  writer,
  className,
}: {
  writer: PromptWriterState;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const Icon = writer.label === "Try another" ? RefreshCw : Wand2;
  return (
    <motion.button
      type="button"
      onClick={writer.write}
      disabled={writer.busy}
      whileTap={reduce ? undefined : { scale: 0.96 }}
      className={cn(
        "group relative inline-flex h-8 items-center gap-1.5 overflow-hidden rounded-full px-3 text-xs font-semibold transition-[box-shadow,background-color] duration-[--motion-duration-base]",
        "bg-primary text-primary-foreground shadow-[0_6px_18px_-8px_hsl(var(--primary)/0.8)] hover:shadow-[0_10px_24px_-8px_hsl(var(--primary)/0.9)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 disabled:cursor-progress",
        className,
      )}
    >
      {!reduce ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/35 to-transparent opacity-0 transition-[left,opacity] duration-700 group-hover:left-[120%] group-hover:opacity-100"
        />
      ) : null}
      <Icon className={cn("relative size-3.5", writer.busy && "animate-spin")} />
      <span className="relative">{writer.label}</span>
    </motion.button>
  );
}

/** Covers the description box while writing. */
export function WritingOverlay({ writer }: { writer: PromptWriterState }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {writer.busy ? (
        <motion.div
          key="writing"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: duration.fast } }}
          className="absolute inset-0 z-10 grid place-items-center overflow-hidden rounded-2xl bg-surface-3/80 backdrop-blur-[2px]"
          role="status"
          aria-live="polite"
        >
          <span aria-hidden className="studio-weave absolute inset-0 opacity-80" />
          <span className="relative flex flex-col items-center gap-3">
            <span className="relative grid size-11 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_10px_30px_-10px_hsl(var(--primary)/0.9)]">
              {!reduce ? (
                <span className="absolute inset-0 animate-ping rounded-full bg-primary/40" />
              ) : null}
              <Sparkles className="relative size-5" />
            </span>
            <AnimatePresence mode="wait">
              <motion.span
                key={writer.status}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: duration.base, ease: ease.emphasized }}
                className="text-sm font-medium text-foreground"
              >
                {writer.status}…
              </motion.span>
            </AnimatePresence>
          </span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** What the written prompt is based on, shown under the box. */
export function WrittenNote({ writer }: { writer: PromptWriterState }) {
  const r = writer.result;
  return (
    <AnimatePresence>
      {r && r.why ? (
        <motion.p
          key={r.title}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: duration.medium, ease: ease.emphasized }}
          className="mt-2 flex items-start gap-2 text-xs text-muted-foreground"
        >
          <span className="mt-px shrink-0 rounded-full bg-primary-surface px-2 py-0.5 text-[10.5px] font-semibold text-foreground ring-1 ring-primary-border">
            {r.basedOn}
          </span>
          <span className="min-w-0 leading-5">{r.why}</span>
        </motion.p>
      ) : null}
    </AnimatePresence>
  );
}
