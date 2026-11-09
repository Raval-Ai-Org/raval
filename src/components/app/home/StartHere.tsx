"use client";

// "Start here" (Holo's checklist): the four things Mox needs to know, from
// free reads only. The same list is a card on Home and a window that opens
// after onboarding or from `open:start-here`.

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AppModalShell } from "@/components/app/AppModalShell";
import { CardArrow, GradProgress } from "@/components/app/surface/MoxParts";
import { Mox } from "@/components/brand/mox/Mox";
import { Check, Sparkles } from "@/components/icons";
import { addAppEventListener, emitAppEvent, removeAppEventListener } from "@/lib/app-events";
import type { startHere, StartHereId, StartHereStep } from "@/lib/home/start-here";
import { cn } from "@/lib/utils";
import { Illustration, type IlloKind } from "./illustrations";
import { useStartHere } from "./use-start-here";

const ILLO: Record<StartHereId, IlloKind> = {
  brand: "website",
  products: "poster",
  look: "carousel",
  goal: "rocket",
};

/** Where each step is done. Every one is a person's click. */
export function openStartHereStep(id: StartHereId) {
  if (id === "brand") emitAppEvent("open:brain", { section: "brand" });
  else if (id === "products") emitAppEvent("open:brain", { section: "brand", tab: "products" });
  else if (id === "look") emitAppEvent("open:inspo", { section: "board" });
  else emitAppEvent("open:brain", { section: "brand", tab: "goal" });
}

export function StartHereList({
  steps,
  onPick,
  className,
}: {
  steps: StartHereStep[];
  onPick: (id: StartHereId) => void;
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-col gap-1", className)}>
      {steps.map((s, i) => (
        <li key={s.id} className="ds-rise" style={{ ["--i" as string]: i + 2 }}>
          <button
            type="button"
            onClick={() => onPick(s.id)}
            className={cn(
              "group flex h-12 w-full items-center gap-2.5 rounded-2xl border px-1.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              // Holo: a finished step is a soft green row with a tick, not crossed out.
              s.done
                ? "border-[color-mix(in_srgb,var(--mox-green)_35%,transparent)] bg-[color-mix(in_srgb,var(--mox-lime)_16%,transparent)]"
                : "border-transparent hover:bg-[var(--ds-well-bg)]",
            )}
          >
            <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl bg-[var(--ds-well-bg)] transition-transform duration-300 group-hover:-rotate-3 group-hover:scale-105">
              <Illustration kind={ILLO[s.id]} className="size-10" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold leading-tight text-foreground">
                {s.label}
              </span>
              <span className="block text-[11px] leading-tight text-muted-foreground">
                {s.hint}
              </span>
            </span>
            {s.done ? (
              <span className="mr-1.5 grid size-6 shrink-0 place-items-center rounded-full text-[var(--mox-green-deep)] dark:text-[var(--mox-lime)]">
                <Check className="size-4" strokeWidth={3} aria-label="Done" />
              </span>
            ) : (
              <CardArrow />
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

export type StartHereView = ReturnType<typeof startHere> & { ready: boolean };

export function StartHereCard({ start }: { start: StartHereView }) {
  return (
    <div className="ds-card ds-card-hover flex h-full flex-col p-[18px]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[16px] font-bold tracking-tight">Start here</h3>
        <span className="rounded-full bg-[var(--ds-well-bg)] px-2 py-0.5 text-[11px] font-bold tabular-nums">
          {start.done}/{start.total}
        </span>
      </div>
      <GradProgress
        value={start.ready ? start.done / start.total : 0}
        label="Set up"
        className="mb-2"
      />
      <StartHereList steps={start.steps} onPick={openStartHereStep} />
    </div>
  );
}

/** Mounted once in the shell. Opens on the event, and once after onboarding. */
export function StartHereModal({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const start = useStartHere(workspaceId);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    addAppEventListener("open:start-here", onOpen);
    // Onboarding's press-and-hold hands over with this flag.
    try {
      if (sessionStorage.getItem("mox:entered") === workspaceId) {
        sessionStorage.removeItem("mox:entered");
        window.setTimeout(onOpen, 900);
      }
    } catch {
      /* ignore */
    }
    return () => removeAppEventListener("open:start-here", onOpen);
  }, [workspaceId]);
  const pick = (id: StartHereId) => {
    setOpen(false);
    window.setTimeout(() => openStartHereStep(id), 120);
  };
  return (
    <AppModalShell
      open={open}
      onOpenChange={setOpen}
      size="sm"
      Icon={Sparkles}
      title="Start here"
      description={`Step ${Math.min(start.done + 1, start.total)} of ${start.total}`}
      srDescription="A few things that help Mox make posts that sound like you."
      bodyClassName="p-4"
    >
      <div className="flex items-center gap-3 pb-3">
        <Mox pose="wave" size={72} float />
        <p className="text-[14px] font-semibold leading-snug">
          Teach me your brand. <span className="ds-grad-text">Every step makes posts better.</span>
        </p>
      </div>
      <GradProgress value={start.done / start.total} label="Set up" className="mb-3" />
      <StartHereList steps={start.steps} onPick={pick} />
      <AnimatePresence>
        {start.next && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 flex items-center justify-end gap-2"
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-9 rounded-full px-4 text-[13px] font-semibold text-muted-foreground hover:bg-[var(--ds-well-bg)] hover:text-foreground"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={() => start.next && pick(start.next.id)}
              className="ds-grad-pill h-9 rounded-full px-5 text-[13px] font-bold"
            >
              Continue
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </AppModalShell>
  );
}
