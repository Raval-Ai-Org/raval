"use client";
// EditChat — change a finished piece by saying what to change. Each message
// is routed to the picture, the words, both, or more versions (edit-chat.ts),
// shows what it costs before it is sent, and comes back as a new version with
// Undo. Every change is an ordinary Studio revision: same prices, same
// approval rules. Presentational apart from the session actions it calls.
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Layers, RotateCcw, Send, Spinner, Wand2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { duration, ease } from "@/lib/motion";
import { AIM_LABEL, editTarget, planEdit, replyFor, type EditAim } from "@/lib/studio/edit-chat";
import { REFINE_PRESETS, isActiveJob, type StudioJob } from "@/lib/studio/jobs";
import { studioPriceLabel } from "@/lib/studio/billing";
import { VARIATION_TYPES, variationCount } from "@/lib/studio/variations";
import { sendEdit, undoEdit, updateSession, type StudioSession } from "@/lib/studio/session-store";

const PICTURE_CHIPS = [
  { label: "Brighter", text: "Make the picture brighter and more inviting." },
  { label: "Simpler background", text: "Simplify the background so the subject stands out." },
  { label: "Different angle", text: "Show the subject from a different camera angle." },
  {
    label: "New picture",
    text: "Create a fresh take on the picture with a different composition.",
  },
];
const WORD_CHIPS = REFINE_PRESETS.filter((p) => ["shorter", "hook", "cta"].includes(p.id));
/** Formats whose earlier version can be put back (restoreStudioVersion). */
const UNDOABLE = new Set(["social", "image", "ad", "video", "script", "article"]);
const AIMS: (EditAim | "auto")[] = ["auto", "picture", "words", "both"];

type TurnState = "working" | "done" | "failed" | "undone";

function jobFor(session: StudioSession, id?: string): StudioJob | null {
  if (!id) return null;
  if (session.job?.id === id) return session.job;
  if (session.lastGood?.id === id) return session.lastGood;
  return null;
}

export function EditChat({
  session,
  wordsTarget,
  designedAd,
  disabled,
  aside,
}: {
  session: StudioSession;
  /** Where a words change goes: all platforms, or the one being viewed. */
  wordsTarget: string;
  designedAd?: boolean;
  /** Manual editing is open: chat waits until it is saved or cancelled. */
  disabled?: boolean;
  aside?: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const [text, setText] = useState("");
  const [override, setOverride] = useState<EditAim | "auto">("auto");
  const listRef = useRef<HTMLOListElement | null>(null);
  const base = session.lastGood;
  const busy = !!session.pendingKey || !!(session.job && isActiveJob(session.job));
  const hasPicture = !!base?.output?.media?.some((m) => m.slot === "main" && m.status === "ready");
  const canVersion = hasPicture && (VARIATION_TYPES as readonly string[]).includes(session.type);
  const turns = useMemo(() => session.edits ?? [], [session.edits]);

  const detected = text.trim()
    ? planEdit(text, { type: session.type, hasPicture, designedAd })
    : null;
  const aim: EditAim | null = override !== "auto" ? override : (detected?.aim ?? null);
  const priceFor = (a: EditAim, count?: number) =>
    base
      ? studioPriceLabel({
          type: session.type,
          controls: {
            ...session.controls,
            ...(a === "versions"
              ? { variationCount: count ?? variationCount(session.controls) }
              : {}),
          },
          parentJobId: base.id,
          refine: {
            instruction: "edit",
            target: a === "words" ? wordsTarget : editTarget(a, session.type),
          },
          captionEditsRemaining: base.captionEditsRemaining,
        })
      : "";

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [turns.length, busy]);

  const latestUndoable = [...turns]
    .reverse()
    .find((t) => !t.undone && t.jobId && t.aim !== "versions");
  const stateOf = (turnIndex: number): TurnState => {
    const turn = turns[turnIndex];
    if (turn.undone) return "undone";
    const job = jobFor(session, turn.jobId);
    if (!turn.jobId) return busy && turnIndex === turns.length - 1 ? "working" : "failed";
    if (job && isActiveJob(job)) return "working";
    if (job?.status === "failed" || job?.status === "cancelled") return "failed";
    return "done";
  };

  const send = (message: string, opts: { aim?: EditAim; preset?: string } = {}) => {
    if (!base || busy || disabled) return;
    sendEdit(session.id, message, {
      aim: opts.aim ?? (override !== "auto" ? override : undefined),
      wordsTarget,
      designedAd,
      preset: opts.preset,
    });
    setText("");
    setOverride("auto");
  };
  const moreVersions = (count: number) => {
    updateSession(session.id, { controls: { ...session.controls, variationCount: count } });
    send(`Make ${count} more versions`, { aim: "versions" });
  };

  return (
    <section data-no-rhythm className="px-5 py-5" aria-label="Edit with chat">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="ui-eyebrow">Edit with chat</h3>
        {aside}
      </div>

      {turns.length ? (
        <ol
          ref={listRef}
          className="mb-3 max-h-72 space-y-2 overflow-y-auto pr-1"
          aria-label="Changes"
          aria-live="polite"
        >
          <AnimatePresence initial={false}>
            {turns.map((turn, index) => {
              const state = stateOf(index);
              const job = jobFor(session, turn.jobId);
              return (
                <motion.li
                  key={turn.id}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: duration.medium, ease: ease.emphasized }}
                  className="space-y-1.5"
                >
                  <p className="ml-auto w-fit max-w-[88%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-[13px] leading-snug text-primary-foreground">
                    {turn.text}
                  </p>
                  <div
                    className={cn(
                      "flex max-w-[92%] items-start gap-2 rounded-2xl rounded-bl-md px-3 py-2 text-[12.5px] leading-snug",
                      state === "failed"
                        ? "bg-danger-surface text-danger"
                        : "bg-surface-2 text-foreground",
                    )}
                  >
                    {state === "working" ? (
                      <Spinner className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary" />
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className="block text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {AIM_LABEL[turn.aim]}
                      </span>
                      {state === "working"
                        ? turn.aim === "versions"
                          ? "Making the new versions…"
                          : turn.aim === "words"
                            ? "Rewriting the words…"
                            : "Changing the picture…"
                        : state === "failed"
                          ? (job?.error?.message ??
                            session.error ??
                            "This change didn't go through. Nothing was charged.")
                          : state === "undone"
                            ? "Undone. The earlier version is back."
                            : replyFor(
                                turn.aim,
                                turn.aim === "versions"
                                  ? variationCount(job?.input?.controls)
                                  : undefined,
                              )}
                    </span>
                    {state === "done" &&
                    latestUndoable?.id === turn.id &&
                    UNDOABLE.has(session.type) &&
                    !busy ? (
                      <button
                        type="button"
                        onClick={() => void undoEdit(session.id, turn.id)}
                        className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium text-foreground ring-1 ring-border hover:bg-surface-3"
                      >
                        <RotateCcw className="size-3" />
                        Undo
                      </button>
                    ) : null}
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      ) : (
        <p className="mb-3 text-[12.5px] leading-snug text-muted-foreground">
          Say what to change, like “make the background darker” or “shorter caption”. Each change is
          a new version you can undo.
        </p>
      )}

      <form
        data-no-rhythm
        className="rounded-xl bg-surface-2 p-1 ring-1 ring-border transition-shadow focus-within:ring-2 focus-within:ring-primary"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim().length >= 2) send(text);
        }}
      >
        <div className="flex items-center gap-1 pl-2">
          <Wand2 className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy || disabled || !base}
            placeholder={busy ? "Working on your last change…" : "Describe a change…"}
            aria-label="Describe a change"
            className="h-9 min-w-0 flex-1 !border-0 !bg-transparent px-1.5 text-sm !shadow-none outline-none placeholder:text-muted-foreground focus-visible:!ring-0 disabled:opacity-50"
          />
          <Button
            type="submit"
            size="icon-sm"
            className="rounded-lg"
            disabled={text.trim().length < 2 || busy || disabled}
            aria-label="Send change"
          >
            <Send />
          </Button>
        </div>
        <AnimatePresence initial={false}>
          {aim ? (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: duration.fast }}
              className="flex flex-wrap items-center gap-1 overflow-hidden px-2 pb-1 pt-1.5"
            >
              <span className="mr-1 text-[11px] text-muted-foreground">Changes</span>
              {aim === "versions" ? (
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-foreground">
                  More versions
                </span>
              ) : (
                AIMS.filter((a) => a !== "auto").map((a) => {
                  const on = aim === a;
                  const unavailable = a !== "words" && !hasPicture;
                  return (
                    <button
                      key={a}
                      type="button"
                      disabled={unavailable}
                      aria-pressed={on}
                      onClick={() => setOverride(a)}
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors disabled:hidden",
                        on
                          ? "bg-primary/15 text-foreground ring-1 ring-primary/40"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {AIM_LABEL[a as EditAim]}
                    </button>
                  );
                })
              )}
              <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                {priceFor(aim, detected?.count)}
              </span>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </form>

      {!aim && base ? (
        <p className="mt-2 px-1 text-[11.5px] text-muted-foreground" data-testid="edit-prices">
          <span>Words · {priceFor("words")}</span>
          {hasPicture ? <span> · Picture · {priceFor("picture")}</span> : null}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {hasPicture
          ? PICTURE_CHIPS.map((chip) => (
              <Chip
                key={chip.label}
                disabled={busy || disabled}
                onClick={() => send(chip.text, { aim: "picture" })}
              >
                {chip.label}
              </Chip>
            ))
          : null}
        {WORD_CHIPS.map((p) => (
          <Chip
            key={p.id}
            disabled={busy || disabled}
            onClick={() => send(p.instruction, { aim: "words", preset: p.id })}
          >
            {p.label}
          </Chip>
        ))}
      </div>

      {canVersion ? (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-surface-2/70 px-3 py-2">
          <Layers className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 text-[12.5px] text-foreground">
            More versions to choose from
          </span>
          {[2, 3, 4].map((n) => (
            <button
              key={n}
              type="button"
              disabled={busy || disabled}
              onClick={() => moreVersions(n)}
              title={`${n} versions · ${priceFor("versions", n)}`}
              aria-label={`Make ${n} more versions, ${priceFor("versions", n)}`}
              className="grid size-7 place-items-center rounded-full bg-surface-3 text-[12px] font-semibold text-foreground ring-1 ring-border transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-45"
            >
              {n}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function Chip({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-8 items-center rounded-full bg-surface-2/70 px-3 text-xs font-medium text-foreground ring-1 ring-transparent transition-[background-color,box-shadow,translate] duration-[--motion-duration-fast] hover:-translate-y-px hover:bg-primary-surface hover:shadow-1 hover:ring-primary-border disabled:opacity-45"
    >
      {children}
    </button>
  );
}
