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
import { ArrowRight, RefreshCw, RotateCcw, Sparkles, Star, Wand2, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { duration, ease } from "@/lib/motion";
import { readBrandPayload, studioApi } from "@/lib/studio/client";
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
  const [deck, setDeck] = useState<Deck>(() => newDeck([], [], []));
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [exit, setExit] = useState<DeckAction>("skip");

  const fetchIdeas = useCallback(
    async (refresh: boolean) => {
      if (fixtureIdeas) return fixtureIdeas;
      const skipped = readSkippedIdeas(workspaceId);
      const res = await studioApi.ideas({
        workspaceId,
        type,
        brand: readBrandPayload(workspaceId),
        dismissed: skipped.map((d) => d.title).slice(-30),
        refresh,
        limit: 8,
      });
      return res.ideas;
    },
    [workspaceId, type, fixtureIdeas],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStatus("loading");
    void fetchIdeas(false)
      .then((ideas) => {
        if (cancelled) return;
        setDeck(newDeck(ideas, readSavedIdeas(workspaceId), readSkippedIdeas(workspaceId)));
        setStatus("ready");
      })
      .catch(() => !cancelled && setStatus("error"));
    return () => {
      cancelled = true;
    };
  }, [open, fetchIdeas, workspaceId]);

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
      <DialogContent className="max-w-[440px] gap-4 overflow-hidden p-5 sm:p-6">
        <div className="pr-10">
          <DialogTitle className="flex items-center gap-1.5">
            <Sparkles className="size-4 text-primary" />
            Swipe through ideas
          </DialogTitle>
          <DialogDescription className="mt-1">
            Right to save, left to skip. Make the one you like.
          </DialogDescription>
        </div>

        <div className="relative h-[300px]" data-testid="idea-deck">
          {status === "loading" ? (
            <div className="absolute inset-0 overflow-hidden rounded-[var(--ds-radius-tile)] bg-surface-2">
              <span className="studio-weave absolute inset-0" aria-hidden />
              <span className="sr-only">Loading ideas</span>
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

        <div className="flex items-center justify-center gap-3">
          <RoundButton label="Skip" onClick={() => act("skip")} disabled={!top}>
            <X className="size-5" />
          </RoundButton>
          <RoundButton
            label="Undo last swipe"
            onClick={() => update(undoSwipe(deck))}
            disabled={!deck.last}
            small
          >
            <RotateCcw className="size-4" />
          </RoundButton>
          <RoundButton label="Save" onClick={() => act("save")} disabled={!top} tone="save">
            <Star className="size-5" />
          </RoundButton>
          <Button className="ml-1 rounded-full" disabled={!top} onClick={() => top && make(top)}>
            <Wand2 />
            Make this
          </Button>
        </div>

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
        className="pointer-events-none absolute left-4 top-16 -rotate-6 rounded-lg border-2 border-primary px-2 py-0.5 text-sm font-bold uppercase tracking-wide text-primary"
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

function CardFace({ idea, top }: { idea: StudioIdea; top?: boolean }) {
  return (
    <div
      className={cn(
        `studio-tone-${idea.type} flex h-full flex-col rounded-[var(--ds-radius-tile)] border bg-surface-3 p-5 select-none`,
        top ? "border-border shadow-4" : "border-border/60",
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 text-[12px] font-medium text-foreground/80">
          <TypeGlyph type={idea.type} size="sm" className="size-6 [&_svg]:size-3.5" />
          {STUDIO_FORMATS[idea.type].label}
        </span>
        <span className="rounded-full bg-[hsl(var(--tone)/0.12)] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--tone-ink)] ring-1 ring-[hsl(var(--tone)/0.28)]">
          {IDEA_SOURCE_LABEL[idea.source]}
        </span>
      </div>
      <p className="mt-4 text-[20px] font-semibold leading-snug tracking-tight text-foreground text-balance">
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
        tone === "save" ? "text-primary hover:bg-primary/10" : "text-foreground hover:bg-surface-2",
      )}
    >
      {children}
    </motion.button>
  );
}
