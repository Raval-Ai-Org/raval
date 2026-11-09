"use client";
// IdeaSwipeDeck — ideas one card at a time. Drag or press → to save, ← to
// skip, Enter to make the top idea. Saved ideas stay in a tray; asking for
// more is always a person's click (each batch is a model call).
import { useCallback, useEffect, useState } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type PanInfo,
} from "framer-motion";
import { ArrowRight, Heart, RefreshCw, RotateCcw, Wand2, X } from "@/components/icons";
import { Illustration, type IlloKind } from "@/components/app/home/illustrations";
import { MoxFace } from "@/components/brand/mox/MoxFace";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { duration, ease } from "@/lib/motion";
import { cachedIdeas, loadIdeas } from "@/lib/studio/idea-cache";
import { STUDIO_FORMATS, type StudioType } from "@/lib/studio/formats";
import { IDEA_SOURCE_LABEL, type StudioIdea } from "@/lib/studio/ideas";
import {
  addIdeas,
  newDeck,
  persistDeck,
  readSavedIdeas,
  readSkippedIdeas,
  swipe,
  swipeFromDrag,
  undoSwipe,
  unsave,
  type Deck,
  type DeckAction,
} from "@/lib/studio/idea-deck";
import { TypeGlyph } from "./studio-ui";

export function IdeaSwipeDeck({
  open,
  onOpenChange,
  workspaceId,
  type,
  onPick,
  fixtureIdeas,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  type?: StudioType;
  /** Make this idea: fills the brief. */
  onPick: (idea: StudioIdea) => void;
  /** Preview/testing: these instead of calling the API. */
  fixtureIdeas?: StudioIdea[];
}) {
  const reduce = useReducedMotion();
  // Ideas Home already fetched (or the last batch kept in this browser) are
  // shown at once; the shimmer shows only when there is nothing in hand.
  const initial = fixtureIdeas ?? cachedIdeas(workspaceId, type)?.ideas ?? null;
  const [deck, setDeck] = useState<Deck>(() =>
    initial
      ? newDeck(initial, readSavedIdeas(workspaceId), readSkippedIdeas(workspaceId))
      : newDeck([], [], []),
  );
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    initial ? "ready" : "loading",
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [exit, setExit] = useState<DeckAction>("skip");

  const fetchIdeas = useCallback(
    async (refresh: boolean) => {
      if (fixtureIdeas) return fixtureIdeas;
      return loadIdeas(workspaceId, type, { refresh });
    },
    [workspaceId, type, fixtureIdeas],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const saved = () => readSavedIdeas(workspaceId);
    const skipped = () => readSkippedIdeas(workspaceId);
    if (fixtureIdeas) {
      setDeck(newDeck(fixtureIdeas, saved(), skipped()));
      setStatus("ready");
      return;
    }
    const inHand = cachedIdeas(workspaceId, type);
    if (inHand) {
      setDeck(newDeck(inHand.ideas, saved(), skipped()));
      setStatus("ready");
      if (inHand.fresh) return;
      // An older batch: swipe it now, new ideas join the end of the stack
      // when they arrive (never reshuffling the card under the finger).
      void fetchIdeas(false)
        .then((ideas) => !cancelled && setDeck((d) => addIdeas(d, ideas)))
        .catch(() => {});
    } else {
      setStatus("loading");
      // Not aborted on close: the request is shared, its answer is kept for
      // the next opening, and it runs in the background lane either way.
      void fetchIdeas(false)
        .then((ideas) => {
          if (cancelled) return;
          setDeck(newDeck(ideas, saved(), skipped()));
          setStatus("ready");
        })
        .catch(() => !cancelled && setStatus("error"));
    }
    return () => {
      cancelled = true;
    };
  }, [open, fetchIdeas, workspaceId, type, fixtureIdeas]);

  const update = useCallback(
    (next: Deck) => {
      setDeck(next);
      if (!fixtureIdeas) persistDeck(workspaceId, next);
    },
    [workspaceId, fixtureIdeas],
  );
  const act = useCallback(
    (action: DeckAction) => {
      setExit(action);
      update(swipe(deck, action));
    },
    [deck, update],
  );
  const make = useCallback(
    (idea: StudioIdea) => {
      onPick(idea);
      onOpenChange(false);
    },
    [onPick, onOpenChange],
  );
  const more = async () => {
    setLoadingMore(true);
    try {
      update(addIdeas(deck, await fetchIdeas(true)));
    } catch {
      setStatus("error");
    } finally {
      setLoadingMore(false);
    }
  };

  const top = deck.queue[0];
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest("input,textarea")) return;
      if (e.key === "ArrowRight" && top) act("save");
      else if (e.key === "ArrowLeft" && top) act("skip");
      else if (e.key === "Enter" && top && !(e.target as HTMLElement)?.closest("button")) make(top);
      else if ((e.key === "z" || e.key === "Backspace") && deck.last) update(undoSwipe(deck));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, top, act, make, deck, update]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px] gap-4 overflow-hidden rounded-[28px] p-5 sm:p-6">
        <DialogTitle className="sr-only">Swipe through ideas</DialogTitle>
        <DialogDescription className="sr-only">
          Right to save, left to skip. Make the one you like.
        </DialogDescription>
        {/* Holo: Mox asks one question, with how many are left. */}
        <div className="flex items-center gap-3 pr-10">
          <MoxFace mood={status === "loading" ? "thinking" : top ? "happy" : "wow"} size={40} />
          <div className="min-w-0">
            <p className="text-[18px] font-bold leading-tight tracking-[-0.02em]">
              {top ? "Keep this idea?" : "Ideas for you"}
            </p>
            <p className="text-[12px] text-muted-foreground">
              {status === "ready" && top ? `${deck.queue.length} left` : "Swipe right to keep"}
            </p>
          </div>
        </div>

        <div className="relative h-[300px]" data-testid="idea-deck">
          {status === "loading" ? (
            <div
              role="status"
              className="absolute inset-0 overflow-hidden rounded-[var(--ds-radius-tile)] bg-surface-2"
            >
              <span className="studio-weave absolute inset-0" aria-hidden />
              {/* A card's shape, so the first ideas land where the eye already is. */}
              <div className="relative flex h-full flex-col justify-end gap-2.5 p-5" aria-hidden>
                <span className="h-5 w-24 rounded-full bg-foreground/[0.07]" />
                <span className="h-5 w-4/5 rounded-full bg-foreground/[0.09]" />
                <span className="h-3.5 w-3/5 rounded-full bg-foreground/[0.06]" />
              </div>
              <p className="absolute inset-x-0 top-5 text-center text-[12.5px] font-medium text-muted-foreground">
                Mox is thinking up ideas for your brand…
              </p>
            </div>
          ) : status === "error" ? (
            <div className="grid h-full place-items-center rounded-[var(--ds-radius-tile)] bg-surface-2 p-6 text-center text-sm text-muted-foreground">
              Ideas aren&apos;t available right now. You can still write your own brief.
            </div>
          ) : top ? (
            <AnimatePresence initial={false} custom={exit}>
              {deck.queue
                .slice(0, 3)
                .reverse()
                .map((idea) => {
                  const depth = deck.queue.indexOf(idea);
                  return depth === 0 ? (
                    <TopCard key={idea.id} idea={idea} reduce={!!reduce} onSwipe={act} />
                  ) : (
                    <motion.div
                      key={idea.id}
                      aria-hidden
                      initial={false}
                      animate={{
                        scale: 1 - depth * 0.05,
                        y: depth * 14,
                        opacity: 1 - depth * 0.25,
                      }}
                      transition={{ duration: duration.medium, ease: ease.emphasized }}
                      className="absolute inset-0"
                    >
                      {depth === 1 ? (
                        <CardFace idea={idea} />
                      ) : (
                        <div className="h-full rounded-[var(--ds-radius-tile)] border border-border/60 bg-surface-3" />
                      )}
                    </motion.div>
                  );
                })}
            </AnimatePresence>
          ) : (
            <div className="grid h-full place-items-center rounded-[var(--ds-radius-tile)] border border-dashed border-border p-6 text-center">
              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">You&apos;ve seen them all</p>
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={() => void more()}
                  disabled={loadingMore || !!fixtureIdeas}
                >
                  <RefreshCw className={cn("size-4", loadingMore && "animate-spin")} />
                  More ideas
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Holo's pair: Skip (soft red) and Save (green), undo between. */}
        <div className="flex items-center gap-2">
          <PillButton label="Skip" onClick={() => act("skip")} disabled={!top} tone="skip">
            <X className="size-4" strokeWidth={2.6} />
          </PillButton>
          <RoundButton
            label="Undo last swipe"
            onClick={() => update(undoSwipe(deck))}
            disabled={!deck.last}
            small
          >
            <RotateCcw className="size-4" />
          </RoundButton>
          <PillButton label="Save" onClick={() => act("save")} disabled={!top} tone="save">
            <Heart className="size-4" strokeWidth={2.6} />
          </PillButton>
        </div>
        <button
          type="button"
          disabled={!top}
          onClick={() => top && make(top)}
          className="ds-grad-pill inline-flex h-11 w-full items-center justify-center gap-2 rounded-full text-[14px] font-bold transition active:scale-[0.98] disabled:opacity-40"
        >
          <Wand2 className="size-4" />
          Make this
        </button>

        {deck.saved.length ? (
          <div className="border-t border-border/60 pt-3">
            <p className="mb-2 text-[12px] font-medium text-muted-foreground">
              Saved · {deck.saved.length}
            </p>
            <ul className="max-h-32 space-y-1 overflow-y-auto pr-1" aria-label="Saved ideas">
              {deck.saved.map((idea) => (
                <li key={idea.id} className="group flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => make(idea)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-foreground hover:bg-surface-2"
                  >
                    <TypeGlyph
                      type={idea.type}
                      size="sm"
                      className="size-5 shrink-0 [&_svg]:size-3"
                    />
                    <span className="truncate">{idea.title}</span>
                    <ArrowRight className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
                  </button>
                  <button
                    type="button"
                    onClick={() => update(unsave(deck, idea.id))}
                    aria-label={`Remove saved idea: ${idea.title}`}
                    className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function TopCard({
  idea,
  reduce,
  onSwipe,
}: {
  idea: StudioIdea;
  reduce: boolean;
  onSwipe: (action: DeckAction) => void;
}) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-220, 0, 220], [-12, 0, 12]);
  const saveOpacity = useTransform(x, [20, 110], [0, 1]);
  const skipOpacity = useTransform(x, [-110, -20], [1, 0]);
  const onDragEnd = (_: unknown, info: PanInfo) => {
    const action = swipeFromDrag(info.offset.x, info.velocity.x);
    if (action) onSwipe(action);
  };
  return (
    <motion.div
      className="absolute inset-0 cursor-grab touch-pan-y active:cursor-grabbing"
      style={{ x, rotate: reduce ? 0 : rotate }}
      drag="x"
      dragSnapToOrigin
      dragElastic={0.7}
      onDragEnd={onDragEnd}
      initial={{ scale: 0.95, y: 14, opacity: 0.75 }}
      animate={{ scale: 1, y: 0, opacity: 1 }}
      variants={{
        exit: (action: DeckAction) =>
          reduce
            ? { opacity: 0, transition: { duration: duration.fast } }
            : {
                x: action === "save" ? 420 : -420,
                rotate: action === "save" ? 18 : -18,
                opacity: 0,
                transition: { duration: 0.32, ease: ease.emphasized },
              },
      }}
      exit="exit"
      transition={{ duration: duration.medium, ease: ease.emphasized }}
      role="group"
      aria-roledescription="idea card"
      aria-label={idea.title}
    >
      <CardFace idea={idea} top />
      <motion.span
        style={{ opacity: saveOpacity }}
        className="pointer-events-none absolute left-4 top-16 -rotate-6 rounded-lg border-2 border-primary px-2 py-0.5 text-sm font-bold uppercase tracking-wide text-primary-ink"
      >
        Save
      </motion.span>
      <motion.span
        style={{ opacity: skipOpacity }}
        className="pointer-events-none absolute right-4 top-16 rotate-6 rounded-lg border-2 border-muted-foreground px-2 py-0.5 text-sm font-bold uppercase tracking-wide text-muted-foreground"
      >
        Skip
      </motion.span>
    </motion.div>
  );
}

const IDEA_ILLO: Record<StudioType, IlloKind> = {
  video: "video",
  script: "animate",
  story: "story",
  image: "post",
  carousel: "carousel",
  social: "swipe",
  article: "article",
  ad: "ad",
};

function CardFace({ idea, top }: { idea: StudioIdea; top?: boolean }) {
  return (
    <div
      className={cn(
        `studio-tone-${idea.type} relative flex h-full flex-col overflow-hidden rounded-[22px] border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] p-5 select-none`,
        top && "shadow-[var(--ds-card-shadow-hover)]",
      )}
    >
      {/* A picture for the format in the card's corner, Holo style. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-6 -top-6 size-36 rounded-full bg-[radial-gradient(closest-side,hsl(var(--tone)/0.18),transparent)]"
      />
      <Illustration
        kind={IDEA_ILLO[idea.type]}
        className="pointer-events-none absolute right-2 top-2 h-[78px] w-[96px]"
      />
      <div className="relative flex flex-wrap items-center gap-1.5 pr-24">
        <span className="inline-flex items-center gap-1 text-[12px] font-medium text-foreground/80">
          <TypeGlyph type={idea.type} size="sm" className="size-6 [&_svg]:size-3.5" />
          {STUDIO_FORMATS[idea.type].label}
        </span>
        <span className="rounded-full bg-[hsl(var(--tone)/0.12)] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--tone-ink)] ring-1 ring-[hsl(var(--tone)/0.28)]">
          {IDEA_SOURCE_LABEL[idea.source]}
        </span>
      </div>
      <p className="relative mt-6 text-[20px] font-bold leading-snug tracking-[-0.02em] text-foreground text-balance">
        {idea.title}
      </p>
      {idea.why ? (
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{idea.why}</p>
      ) : null}
      <p className="mt-auto line-clamp-3 border-l-2 border-[hsl(var(--tone)/0.5)] pl-3 text-[12.5px] leading-relaxed text-foreground/80">
        {idea.brief}
      </p>
    </div>
  );
}

function PillButton({
  children,
  label,
  onClick,
  disabled,
  tone,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone: "save" | "skip";
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      whileTap={{ scale: 0.95 }}
      className={cn(
        "inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full text-[12.5px] font-bold uppercase tracking-wide transition-colors disabled:opacity-40",
        tone === "save"
          ? "border-2 border-[var(--mox-green)] text-[var(--mox-green-deep)] hover:bg-[var(--mox-green)]/10 dark:text-[var(--mox-lime)]"
          : "bg-destructive/10 text-destructive hover:bg-destructive/15",
      )}
    >
      {children}
      {label}
    </motion.button>
  );
}

function RoundButton({
  children,
  label,
  onClick,
  disabled,
  tone,
  small,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "save";
  small?: boolean;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      whileTap={{ scale: 0.9 }}
      className={cn(
        "grid place-items-center rounded-full bg-surface-3 shadow-2 ring-1 ring-border transition-colors disabled:opacity-40",
        small ? "size-9 text-muted-foreground" : "size-12",
        tone === "save" ? "text-primary-ink hover:bg-primary/10" : "text-foreground hover:bg-surface-2",
      )}
    >
      {children}
    </motion.button>
  );
}
