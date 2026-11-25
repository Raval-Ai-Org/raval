import { describe, expect, it } from "vitest";
import {
  addGuideline,
  autoOutcome,
  parseDecision,
  questionFingerprint,
  tidyGuidelines,
} from "./auto-reply";

describe("parseDecision", () => {
  it("keeps a clear reply", () => {
    expect(parseDecision({ action: "reply", reply: "Thank you!", why: "praise" })).toEqual({
      action: "reply",
      reply: "Thank you!",
      question: null,
      why: "praise",
    });
  });

  it("sends anything unclear to a person", () => {
    expect(parseDecision(null).action).toBe("person");
    expect(parseDecision({ action: "post it" }).action).toBe("person");
    expect(parseDecision({ action: "reply", reply: "  " }).action).toBe("person");
    expect(parseDecision({ action: "ask" }).action).toBe("person");
  });
});

describe("autoOutcome", () => {
  const reply = parseDecision({ action: "reply", reply: "Rs 650, Sara!" });

  it("sends a reply the checks kept whole", () => {
    expect(autoOutcome(reply, { text: "Rs 650, Sara!", removed: 0 })).toEqual({
      kind: "send",
      text: "Rs 650, Sara!",
    });
  });

  it("never sends a reply that lost a figure the brand never gave", () => {
    const out = autoOutcome(reply, { text: "Sara!", removed: 1 });
    expect(out.kind).toBe("hold");
  });

  it("asks the team when a fact is missing, and sends nothing", () => {
    const ask = parseDecision({ action: "ask", question: "Do you deliver to Karachi?" });
    expect(autoOutcome(ask, null)).toEqual({
      kind: "ask",
      question: "Do you deliver to Karachi?",
      draft: null,
    });
  });

  it("holds complaints for a person and skips spam", () => {
    expect(autoOutcome(parseDecision({ action: "person", reply: "Sorry!" }), null).kind).toBe(
      "hold",
    );
    expect(autoOutcome(parseDecision({ action: "skip" }), null).kind).toBe("skip");
  });
});

describe("questionFingerprint", () => {
  it("joins the same question asked in other words", () => {
    expect(questionFingerprint("Do you deliver to Karachi?")).toBe(
      questionFingerprint("deliver karachi"),
    );
    expect(questionFingerprint("What is the price of the cold brew?")).toBe(
      questionFingerprint("Cold brew price?"),
    );
    expect(questionFingerprint("Do you deliver to Karachi?")).not.toBe(
      questionFingerprint("Do you deliver to Lahore?"),
    );
  });
});

describe("guidelines", () => {
  it("adds one rule per line, once", () => {
    const one = addGuideline("", "Reply in Roman Urdu");
    expect(addGuideline(one, "reply in roman urdu")).toBe("Reply in Roman Urdu");
    expect(addGuideline(one, "Never promise a date")).toBe(
      "Reply in Roman Urdu\nNever promise a date",
    );
    expect(tidyGuidelines("  a \r\n\n b ")).toBe("a\nb");
  });
});
