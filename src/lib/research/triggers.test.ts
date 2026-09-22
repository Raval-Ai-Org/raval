import { describe, expect, it } from "vitest";
import { briefNeedsResearch, decideChatResearch } from "./triggers";

const YEAR = new Date().getFullYear();

describe("decideChatResearch", () => {
  it("researches when the user asks for it outright", () => {
    expect(decideChatResearch("Can you search the web for this?").research).toBe(true);
    expect(decideChatResearch("Give me an answer with sources please").reason).toBe("explicit");
  });

  it("researches an external subject asked about the present", () => {
    const decision = decideChatResearch("What are the latest trends in the fitness industry?");
    expect(decision.research).toBe(true);
    expect(decision.reason).toBe("recency");
  });

  it("treats the current year as a recency signal", () => {
    expect(decideChatResearch(`How is the SaaS market doing in ${YEAR}?`).research).toBe(true);
  });

  it("researches a question about a named outside thing", () => {
    expect(decideChatResearch("Who is our biggest competitor in this space?").research).toBe(true);
  });

  it("does not research a request to edit text the user already has", () => {
    expect(decideChatResearch("Make it shorter and change the tone to friendly").research).toBe(
      false,
    );
  });

  it("does not research a question about the user's own data", () => {
    expect(decideChatResearch("What does my brand dna say about our audience?").research).toBe(
      false,
    );
    expect(decideChatResearch("Show me my analytics for last week").research).toBe(false);
  });

  it("does not research an ordinary creative request", () => {
    expect(
      decideChatResearch("Write me three Instagram captions about our new colour").research,
    ).toBe(false);
  });

  it("does not research a very short message", () => {
    expect(decideChatResearch("thanks!").research).toBe(false);
    expect(decideChatResearch("ok").reason).toBe("none");
  });

  it("does not research on a recency word alone", () => {
    expect(decideChatResearch("Can you rewrite this post so it sounds current?").research).toBe(
      false,
    );
  });

  it("carries the message through as the query when it does research", () => {
    const decision = decideChatResearch("What is happening in the coffee market right now?");
    expect(decision.query).toContain("coffee market");
  });

  it("prefers an internal reading even when an external word appears", () => {
    expect(decideChatResearch("Rewrite my drafts so they mention the market more").research).toBe(
      false,
    );
  });
});

describe("briefNeedsResearch", () => {
  it("researches a factual or market-based brief", () => {
    expect(briefNeedsResearch("Write a blog post on the state of the coffee industry")).toBe(true);
    expect(briefNeedsResearch("An article comparing us versus the main alternatives")).toBe(true);
    expect(briefNeedsResearch("A post backed by statistics about remote work")).toBe(true);
  });

  it("researches anything explicitly about now", () => {
    expect(briefNeedsResearch(`A rundown of the latest developments this month`)).toBe(true);
  });

  it("does not research a plain creative brief", () => {
    expect(briefNeedsResearch("A playful caption for a photo of our new packaging")).toBe(false);
    expect(briefNeedsResearch("Three hooks for a reel about our team")).toBe(false);
  });

  it("does not research a very short brief", () => {
    expect(briefNeedsResearch("a post")).toBe(false);
  });

  it("does not research an edit of existing copy", () => {
    expect(briefNeedsResearch("Rewrite this draft so it is shorter and punchier")).toBe(false);
  });
});
