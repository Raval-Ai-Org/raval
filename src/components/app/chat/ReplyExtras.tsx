"use client";

// What sits under a chat reply besides its words (ADR-0033): the "Memory
// updated" note, the buttons for changes Mellox prepared, and buttons that open
// a place. Nothing here happens until it is clicked. Presentational: ChatPanel
// wires it, and the chat lab renders it with sample data.
import { useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowUpRight,
  Brain,
  Check,
  ChevronDown,
  Clock,
  Spinner,
} from "@/components/icons";
import type {
  ChatActionView,
  ChatPlaceOffer,
  ChatReplyExtras,
  ChatToolActivity,
} from "@/lib/chat/events";
import type { MemoryChange } from "@/lib/memory/contracts";
import { cn } from "@/lib/utils";

export type ReplyExtrasHandlers = {
  /** Undo one memory change. Resolves true when it was undone. */
  undoMemory: (change: MemoryChange) => Promise<boolean>;
  manageMemory: () => void;
  runAction: (action: ChatActionView) => void;
  openPlace: (offer: ChatPlaceOffer) => void;
};

const enter = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.26, ease: [0.22, 1, 0.36, 1] as const },
};

export function ReplyExtras({
  extras,
  handlers,
}: {
  extras: ChatReplyExtras;
  handlers: ReplyExtrasHandlers;
}) {
  return (
    <div className="flex flex-col gap-2.5" data-testid="reply-extras">
      {extras.memory?.length ? (
        <MemoryChip
          changes={extras.memory}
          onUndo={handlers.undoMemory}
          onManage={handlers.manageMemory}
        />
      ) : null}
      {extras.actions?.length ? (
        <div className="flex flex-col gap-2">
          {extras.actions.map((action) => (
            <ActionCard key={action.id} action={action} onRun={() => handlers.runAction(action)} />
          ))}
        </div>
      ) : null}
      {extras.offers?.length ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Open in Mellox">
          {extras.offers.map((offer) => (
            <button
              key={offer.place}
              type="button"
              className="mx-offer group"
              onClick={() => handlers.openPlace(offer)}
            >
              <span className="mx-offer__icon">
                <ArrowUpRight className="size-3.5" />
              </span>
              <span className="truncate">Open {offer.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const VERB: Record<MemoryChange["op"], string> = {
  added: "Saved",
  updated: "Updated",
  removed: "Removed",
};

/** "Memory updated" with what changed, Undo and Manage. Like ChatGPT's note. */
export function MemoryChip({
  changes,
  onUndo,
  onManage,
}: {
  changes: MemoryChange[];
  onUndo: (change: MemoryChange) => Promise<boolean>;
  onManage: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [undone, setUndone] = useState<Record<string, "busy" | "done">>({});

  const undo = async (change: MemoryChange) => {
    setUndone((s) => ({ ...s, [change.id]: "busy" }));
    const ok = await onUndo(change);
    setUndone((s) => {
      const next = { ...s };
      if (ok) next[change.id] = "done";
      else delete next[change.id];
      return next;
    });
  };

  return (
    <motion.div {...enter} className="max-w-full" data-testid="memory-chip">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className="mx-pill-btn"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Brain className="size-3.5 text-primary" />
          Memory updated
          <ChevronDown
            className={cn("size-3.5 opacity-60 transition-transform", open && "rotate-180")}
          />
        </button>
        <button type="button" className="mx-pill-btn" onClick={onManage}>
          Manage
        </button>
      </div>
      {open ? (
        <ul className="ds-well mt-2 divide-y divide-border/50 rounded-2xl px-3 py-1">
          {changes.map((change) => {
            const state = undone[change.id];
            return (
              <li key={`${change.op}-${change.id}`} className="flex items-start gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "break-words text-[13px] leading-relaxed text-foreground",
                      (change.op === "removed" || state === "done") && "line-through opacity-60",
                    )}
                  >
                    {change.text}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                    {state === "done" ? "Undone" : VERB[change.op]}
                    {change.temporary && state !== "done" ? (
                      <>
                        <Clock className="size-3" /> for now
                      </>
                    ) : null}
                  </p>
                </div>
                {change.op !== "updated" && state !== "done" ? (
                  <button
                    type="button"
                    className="mx-pill-btn shrink-0"
                    disabled={state === "busy"}
                    onClick={() => void undo(change)}
                  >
                    {state === "busy" ? <Spinner className="size-3.5 animate-spin" /> : null}
                    Undo
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </motion.div>
  );
}

/** A change Mellox prepared. It happens when the person clicks, never before. */
export function ActionCard({ action, onRun }: { action: ChatActionView; onRun: () => void }) {
  // Removing or posting asks once more, inline. No pop-up.
  const [confirming, setConfirming] = useState(false);
  const offered = action.state === "offered";

  return (
    <motion.div
      {...enter}
      className="ds-tile flex flex-col gap-2.5 p-3.5 sm:flex-row sm:items-center sm:justify-between"
      data-testid="chat-action"
      data-state={action.state}
    >
      <div className="min-w-0">
        <p className="text-[13.5px] font-medium text-foreground">{action.title}</p>
        {action.detail ? (
          <p className="mt-0.5 break-words text-[12.5px] leading-relaxed text-muted-foreground">
            {action.detail}
          </p>
        ) : null}
        {action.note && !offered ? (
          <p
            className={cn(
              "mt-1 flex items-start gap-1.5 break-words text-[12.5px]",
              action.state === "failed" ? "text-danger" : "text-foreground/80",
            )}
          >
            {action.state === "failed" ? (
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            ) : (
              <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
            )}
            {action.note}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {action.state === "running" ? (
          <span className="mx-pill-btn" aria-live="polite">
            <Spinner className="size-3.5 animate-spin" />
            Working
          </span>
        ) : action.state === "done" ? (
          <span className="mx-pill-btn">
            <Check className="size-3.5 text-primary" />
            Done
          </span>
        ) : action.state === "failed" ? (
          <span className="mx-pill-btn">Didn&rsquo;t work</span>
        ) : confirming ? (
          <>
            <button type="button" className="mx-pill-btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="mx-pill-btn mx-pill-btn--primary"
              onClick={() => {
                setConfirming(false);
                onRun();
              }}
            >
              Yes, do it
            </button>
          </>
        ) : (
          <button
            type="button"
            className="mx-pill-btn mx-pill-btn--primary"
            onClick={() => (action.destructive ? setConfirming(true) : onRun())}
          >
            {action.title}
          </button>
        )}
      </div>
    </motion.div>
  );
}

/** "Looking at your posts…" while a reply reads the workspace's data. */
export function ToolActivity({ activity }: { activity: ChatToolActivity }) {
  return (
    <p
      className="flex items-center gap-2 text-[13px] text-muted-foreground"
      role="status"
      data-testid="tool-activity"
    >
      <Spinner className="size-3.5 animate-spin" />
      {activity.label}
    </p>
  );
}
