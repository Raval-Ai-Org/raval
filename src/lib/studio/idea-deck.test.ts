import { describe, expect, it } from "vitest";
import type { StudioIdea } from "./ideas";
import { addIdeas, newDeck, swipe, swipeFromDrag, undoSwipe, unsave } from "./idea-deck";

const idea = (id: string, title = `Idea ${id}`): StudioIdea => ({
  id,
  type: "image",
  title,
  why: "",
  brief: "brief",
  platforms: ["instagram"],
  source: "pillar",
});

describe("idea deck", () => {
  it("hides ideas already saved or skipped, by id or title", () => {
    const deck = newDeck(
      [idea("a"), idea("b"), idea("c", "Skipped one")],
      [idea("a")],
      [{ id: "x", title: "skipped ONE" }],
    );
    expect(deck.queue.map((i) => i.id)).toEqual(["b"]);
  });

  it("saves right, skips left, and undoes the last swipe", () => {
    let deck = newDeck([idea("a"), idea("b"), idea("c")], [], []);
    deck = swipe(deck, "save");
    deck = swipe(deck, "skip");
    expect(deck.saved.map((i) => i.id)).toEqual(["a"]);
    expect(deck.skipped.map((i) => i.id)).toEqual(["b"]);
    expect(deck.queue.map((i) => i.id)).toEqual(["c"]);
    deck = undoSwipe(deck);
    expect(deck.queue.map((i) => i.id)).toEqual(["b", "c"]);
    expect(deck.skipped).toEqual([]);
    expect(undoSwipe(deck)).toBe(deck);
  });

  it("does nothing on an empty deck", () => {
    const deck = newDeck([], [], []);
    expect(swipe(deck, "save")).toBe(deck);
  });

  it("adds more ideas without repeats", () => {
    let deck = swipe(newDeck([idea("a"), idea("b")], [], []), "skip");
    deck = addIdeas(deck, [idea("a"), idea("b"), idea("c")]);
    expect(deck.queue.map((i) => i.id)).toEqual(["b", "c"]);
    expect(unsave(swipe(deck, "save"), "b").saved).toEqual([]);
  });

  it("reads a drag as a swipe only past the distance or with speed", () => {
    expect(swipeFromDrag(150, 0)).toBe("save");
    expect(swipeFromDrag(-150, 0)).toBe("skip");
    expect(swipeFromDrag(40, 900)).toBe("save");
    expect(swipeFromDrag(40, 100)).toBeNull();
  });
});
