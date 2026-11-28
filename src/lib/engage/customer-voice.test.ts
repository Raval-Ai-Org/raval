import { describe, expect, it } from "vitest";
import { customerVoice, customerVoiceBlock, type VoiceQuestion } from "./customer-voice";

const q = (question: string, askedCount: number, extra: Partial<VoiceQuestion> = {}) => ({
  question,
  askedCount,
  status: "open" as const,
  answer: null,
  ...extra,
});

describe("customerVoice", () => {
  it("orders questions by how many people asked, skipping dismissed ones", () => {
    const v = customerVoice(
      [
        q("Do you deliver to Lahore?", 2),
        q("What is the price of the cold brew?", 5),
        q("Is this spam?", 9, { status: "dismissed" }),
      ],
      [],
    );
    expect(v.asked.map((a) => a.count)).toEqual([5, 2]);
  });

  it("keeps the team's answer only for answered questions", () => {
    const v = customerVoice(
      [q("Hours?", 1, { status: "answered", answer: "9 to 5 every day" }), q("Stock?", 1)],
      [],
    );
    expect(v.asked[0].answer).toBe("9 to 5 every day");
    expect(v.asked[1].answer).toBeNull();
  });

  it("finds confused comments once per theme and not twice for an asked question", () => {
    const v = customerVoice(
      [q("How do I use the cleanser at night?", 3)],
      [
        { body: "How do I use the cleanser at night??", kind: "comment", moxState: "none" },
        {
          body: "What does the difference between the two kits mean",
          kind: "dm",
          moxState: "none",
        },
        {
          body: "what does the difference between both kits mean?",
          kind: "comment",
          moxState: "none",
        },
        { body: "Love it!", kind: "comment", moxState: "replied" },
        { body: "My order never came", kind: "dm", moxState: "needs_person" },
      ],
    );
    expect(v.confused).toHaveLength(1);
    expect(v.problems).toBe(1);
    expect(v.read).toBe(5);
  });

  it("writes nothing when customers said nothing useful", () => {
    expect(
      customerVoiceBlock(customerVoice([], [{ body: "nice", kind: "comment", moxState: "none" }])),
    ).toBe("");
  });

  it("tells the writer never to invent an answer", () => {
    const block = customerVoiceBlock(customerVoice([q("Do you ship abroad?", 4)], []));
    expect(block).toMatch(/Asked by 4 people/);
    expect(block).toMatch(/don't state one/);
  });
});
