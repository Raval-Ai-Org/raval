"use client";
// BrainPulse — the Coach pill in the top bar.
//
// Closed, it is four small marks: one glows when its brain has something new.
// Open, it is only the updates, newest first, each tagged with its brain. The
// arrow opens Brain. It never starts a briefing, a scan or anything paid.
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Maximize2 } from "lucide-react";
import { ChevronDown } from "@/components/icons";
import { dsFocus, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { useAppEvent } from "@/hooks/use-app-event";
import { BRAINS, type BrainId, type BrainOverview, type BrainSection } from "@/lib/brain/brain";
import { cn } from "@/lib/utils";
import { UpdateRow } from "./BrainHome";
import { BrainMark } from "./BrainMark";
import { useBrainOverview, useBrainSeen } from "./use-brain";

const MAX_ROWS = 6;

export type BrainPulseViewProps = {
  overview: BrainOverview | undefined;
  news: Record<BrainId | "strategy", number>;
  seenAt: number | null;
  loading?: boolean;
  open: boolean;
  onToggle: () => void;
  onOpenBrain: (section: BrainSection, tab?: string) => void;
};

/** The pill and its pop, fed by props (so /brain-lab can show it with sample data). */
export function BrainPulseView({
  overview,
  news,
  seenAt,
  loading,
  open,
  onToggle,
  onOpenBrain,
}: BrainPulseViewProps) {
  const total = Object.values(news).reduce((a, b) => a + b, 0);
  const updates = overview?.updates.slice(0, MAX_ROWS) ?? [];
  const next = overview?.needs[0];
  const isFresh = (at: string) => seenAt == null || Date.parse(at) > seenAt;

  return (
    <div className={cn("relative w-auto", open && "z-50")}>
      <div className="flex items-center gap-0.5 rounded-full border border-border/70 bg-card/95 p-1 shadow-[0_8px_24px_-14px_rgba(0,0,0,0.55)] backdrop-blur-xl">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls="brain-pulse-updates"
          aria-label={total ? `Coach: ${total} new` : "Coach: updates"}
          className={cn(
            "flex h-7 items-center gap-2 rounded-full pl-2 pr-1.5 transition-colors hover:bg-secondary/70",
            dsFocus,
          )}
        >
          <span className="flex items-center gap-1.5">
            {BRAINS.map((brain, i) => (
              <BrainMark
                key={brain}
                brain={brain}
                size={13}
                delay={i * 0.06}
                active={news[brain] > 0}
                muted={!!overview && !overview.brains[brain].ready}
              />
            ))}
          </span>
          <span className="text-[12px] font-semibold tracking-tight">Coach</span>
          <AnimatePresence initial={false}>
            {total > 0 && (
              <motion.span
                key="count"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 28 }}
                className="rounded-full bg-primary px-1.5 text-[10.5px] font-semibold leading-[17px] text-primary-foreground"
              >
                {total > 9 ? "9+" : total}
              </motion.span>
            )}
          </AnimatePresence>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </button>
        <button
          type="button"
          onClick={() => onOpenBrain("home")}
          aria-label="Open Brain"
          title="Open Brain"
          className={cn(
            "grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground",
            dsFocus,
          )}
        >
          <Maximize2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            id="brain-pulse-updates"
            role="dialog"
            aria-label="What's new"
            data-mellox-app
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            style={{ transformOrigin: "top right" }}
            className="ds-glow absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-[24px] bg-background/95 shadow-[var(--ds-window-shadow)] backdrop-blur-xl"
          >
            <div className="max-h-[60vh] overflow-y-auto p-2 scrollbar-thin">
              {loading && !overview ? (
                <div className="space-y-2 p-2">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="h-10 animate-pulse rounded-[14px] bg-[var(--ds-well-bg)]"
                    />
                  ))}
                </div>
              ) : updates.length ? (
                <ul className="space-y-0.5">
                  {updates.map((update, i) => (
                    <UpdateRow
                      key={update.id}
                      update={update}
                      index={i}
                      fresh={isFresh(update.at)}
                      onOpen={() => onOpenBrain(update.brain)}
                    />
                  ))}
                </ul>
              ) : (
                <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">
                  Nothing new yet.
                </p>
              )}
            </div>
            {next && (
              <div className="border-t border-border/50 p-2">
                <button
                  type="button"
                  onClick={() => onOpenBrain(next.brain)}
                  className={cn(dsPrimaryBtn, "h-9 w-full px-4 text-[13px]")}
                >
                  {next.label}
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The live pill for one workspace. */
export function BrainPulse({
  workspaceId,
  onOpenBrain,
}: {
  workspaceId: string;
  onOpenBrain: (section: BrainSection, tab?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const overview = useBrainOverview(workspaceId);
  const { news, seenAt, markSeen } = useBrainSeen(workspaceId, overview.data);

  // Older buttons and chat actions still say "open the coach": it opens Today.
  useAppEvent("open:marketing-coach", () => onOpenBrain("home", "today"));

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
      // Closing the list is having read it.
      markSeen();
    };
  }, [open, markSeen]);

  return (
    <div ref={ref}>
      <BrainPulseView
        overview={overview.data}
        news={news}
        seenAt={seenAt}
        loading={overview.isLoading}
        open={open}
        onToggle={() => setOpen((v) => !v)}
        onOpenBrain={(section, tab) => {
          setOpen(false);
          onOpenBrain(section, tab);
        }}
      />
    </div>
  );
}
