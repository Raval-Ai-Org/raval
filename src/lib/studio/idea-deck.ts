// The ideas deck: ideas one card at a time, swiped right to save, left to
// skip. Saved and skipped ideas are a per-browser convenience (like the
// existing dismissed list), never shared state, so storage failures are
// ignored and the deck still works.
import type { StudioIdea } from "./ideas";

export type DeckAction = "save" | "skip";

export type Deck = {
  /** Cards still to see, top first. */
  queue: StudioIdea[];
  saved: StudioIdea[];
  skipped: { id: string; title: string }[];
  /** The last swipe, so it can be undone. */
  last: { action: DeckAction; idea: StudioIdea } | null;
};

const MAX_SAVED = 30;
const MAX_SKIPPED = 40;

export function newDeck(
  ideas: StudioIdea[],
  saved: StudioIdea[],
  skipped: { id: string; title: string }[],
): Deck {
  const hidden = new Set([...saved.map((i) => i.id), ...skipped.map((i) => i.id)]);
  const titles = new Set(
    [...saved, ...skipped].map((i) => i.title.trim().toLowerCase()).filter(Boolean),
  );
  return {
    queue: ideas.filter((i) => !hidden.has(i.id) && !titles.has(i.title.trim().toLowerCase())),
    saved,
    skipped,
    last: null,
  };
}

/** Swipe the top card. */
export function swipe(deck: Deck, action: DeckAction): Deck {
  const [top, ...rest] = deck.queue;
  if (!top) return deck;
  return {
    queue: rest,
    saved: action === "save" ? [top, ...deck.saved].slice(0, MAX_SAVED) : deck.saved,
    skipped:
      action === "skip"
        ? [...deck.skipped, { id: top.id, title: top.title }].slice(-MAX_SKIPPED)
        : deck.skipped,
    last: { action, idea: top },
  };
}

/** Put the last swiped card back on top. */
export function undoSwipe(deck: Deck): Deck {
  if (!deck.last) return deck;
  const { action, idea } = deck.last;
  return {
    queue: [idea, ...deck.queue],
    saved: action === "save" ? deck.saved.filter((i) => i.id !== idea.id) : deck.saved,
    skipped: action === "skip" ? deck.skipped.filter((i) => i.id !== idea.id) : deck.skipped,
    last: null,
  };
}

/** Add more ideas to the end of the deck, without repeats. */
export function addIdeas(deck: Deck, ideas: StudioIdea[]): Deck {
  const fresh = newDeck(ideas, deck.saved, deck.skipped).queue.filter(
    (i) => !deck.queue.some((q) => q.id === i.id),
  );
  return { ...deck, queue: [...deck.queue, ...fresh] };
}

export function unsave(deck: Deck, id: string): Deck {
  return { ...deck, saved: deck.saved.filter((i) => i.id !== id) };
}

/** How far a card must be dragged, in pixels, to count as a swipe. */
export const SWIPE_DISTANCE = 110;

export function swipeFromDrag(offsetX: number, velocityX: number): DeckAction | null {
  if (offsetX > SWIPE_DISTANCE || velocityX > 650) return "save";
  if (offsetX < -SWIPE_DISTANCE || velocityX < -650) return "skip";
  return null;
}

/* ── per-browser storage ── */

const savedKey = (ws: string) => `studio:ideas-saved:${ws}`;
// The same list IdeasPanel already hides from its suggestions.
const skippedKey = (ws: string) => `studio:ideas-dismissed:${ws}`;

function read<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private window or full storage: the deck still works this session */
  }
}

export const readSavedIdeas = (ws: string) => read<StudioIdea>(savedKey(ws));
export const readSkippedIdeas = (ws: string) => read<{ id: string; title: string }>(skippedKey(ws));
export function persistDeck(ws: string, deck: Deck) {
  write(savedKey(ws), deck.saved.slice(0, MAX_SAVED));
  write(skippedKey(ws), deck.skipped.slice(-MAX_SKIPPED));
}
