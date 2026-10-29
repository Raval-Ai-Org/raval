import { describe, expect, it } from "vitest";
import {
  CONCEPT_METHOD,
  COVER_TEST,
  DELIVERABLES,
  SELF_REVIEW,
  TYPE_SYSTEM,
  deliverableById,
  deliverablePromptLines,
  detectDeliverable,
  emphasisTreatment,
  qualityCheckLines,
  verbatimTextBlock,
} from "./creative-knowledge";
import { archetypeById, pickArchetype } from "./art-direction";

const OTHER_BRANDS = [
  "Nike",
  "Crocs",
  "Pepsi",
  "Fanta",
  "Starbucks",
  "Apple",
  "Stripe",
  "Linear",
  // Names in the studied reference set (Post Training): lessons only, never names.
  "Buzz",
  "Higgsfield",
  "PRSNLI",
  "KIKO",
  "Chicken Express",
  "Siri",
  "Tesla",
  "DAP",
];

describe("deliverables", () => {
  it.each([
    ["Black Friday: 30% off everything this weekend", "promo-offer"],
    ["Join us for a free workshop on pricing, Thursday 6pm", "event"],
    ["We're hiring a senior designer to join our team", "hiring"],
    ["Introducing our new cold brew range", "launch"],
    ["5 mistakes founders make with pricing", "tips"],
    ["How to plan a content calendar in one hour", "tips"],
    ["What's inside every bottle, and why", "feature-board"],
    ["Before and after: the same kitchen in a week", "comparison"],
    ["“It changed how our whole team works,” a customer told us", "quote"],
    ["Wishing everyone a joyful Ramadan Kareem", "greeting"],
    ["Something new is coming soon. Stay tuned.", "teaser"],
    ["Northwind x Lumen: two studios, one collection", "collab"],
    [
      "Case study: a new identity for a fitness app. Scope: naming, identity, website",
      "case-study",
    ],
    ["Hi, we’re Northwind. We build websites and digital products.", "intro"],
    ["Taking the day off today, so hold your horses", "humour"],
    ["Now open in Lahore: our first store in Pakistan", "market-entry"],
  ])("reads %j as %s", (text, id) => {
    expect(detectDeliverable({ text }).id).toBe(id);
  });

  it("does not mistake everyday words for an offer or a launch", () => {
    expect(detectDeliverable({ text: "We write code that ships. Let's deal with it." }).id).toBe(
      "brand-moment",
    );
    expect(detectDeliverable({ text: "Drop a comment with your favourite tool" }).id).toBe(
      "brand-moment",
    );
  });

  it("falls back on the objective and the product", () => {
    expect(detectDeliverable({ text: "Calm mornings.", objective: "product-launch" }).id).toBe(
      "launch",
    );
    expect(
      detectDeliverable({ text: "Calm mornings.", objective: "awareness", physicalProduct: true })
        .id,
    ).toBe("product-hero");
    expect(detectDeliverable({ text: "Calm mornings." }).id).toBe("brand-moment");
  });

  it("only prefers layouts that exist", () => {
    for (const d of DELIVERABLES)
      for (const id of d.prefer) expect(archetypeById(id)).not.toBeNull();
  });

  it("steers the layout pick toward what suits the deliverable", () => {
    const quote = deliverableById("quote")!;
    const picks = Array.from({ length: 30 }, (_, i) =>
      pickArchetype({ brandText: "", seed: `q${i}`, prefer: quote.prefer }),
    );
    expect(picks.every((a) => quote.prefer.includes(a.id))).toBe(true);
  });

  it("always names what must not be invented", () => {
    for (const d of DELIVERABLES) {
      const text = deliverablePromptLines(d).join("\n");
      expect(text).toContain("Never invent:");
      expect(text).toContain("Reading order:");
    }
  });
});

describe("prompt contract", () => {
  it("sets exact copy as data, once, with a fixed line count", () => {
    const block = verbatimTextBlock({
      lines: [
        { label: "Headline", text: "  Slow  mornings, better coffee " },
        { label: "Support", text: "" },
      ],
      emphasis: "better coffee",
      emphasisSeed: "Northbean",
    }).join("\n");
    expect(block).toContain('Headline: "Slow mornings, better coffee"');
    expect(block).not.toContain("Support:");
    expect(block).toContain("Use exactly this line");
    expect(block).toContain('Emphasis: the words "better coffee"');
  });

  it("ignores an emphasis that is not in the copy and an empty copy list", () => {
    const block = verbatimTextBlock({
      lines: [{ label: "Headline", text: "Hello" }],
      emphasis: "missing",
    });
    expect(block.join("\n")).not.toContain("Emphasis:");
    expect(verbatimTextBlock({ lines: [{ label: "Headline", text: " " }] })).toEqual([]);
  });

  it("keeps one emphasis treatment per brand", () => {
    expect(emphasisTreatment("Northbean")).toBe(emphasisTreatment("Northbean"));
  });

  it("checks for text only when there is text", () => {
    expect(qualityCheckLines({ hasText: true }).join(" ")).toContain("character by character");
    expect(qualityCheckLines({ hasText: false }).join(" ")).toContain("No letters");
    expect(qualityCheckLines({ hasText: false, hasProduct: true }).join(" ")).toContain(
      "silhouette",
    );
  });

  it("never names another company", () => {
    const text = [
      ...DELIVERABLES.flatMap(deliverablePromptLines),
      ...TYPE_SYSTEM,
      ...COVER_TEST,
      ...CONCEPT_METHOD,
      SELF_REVIEW,
    ].join("\n");
    for (const brand of OTHER_BRANDS) expect(text).not.toMatch(new RegExp(`\\b${brand}\\b`));
  });

  it("never asks for engagement bait", () => {
    const text = [...COVER_TEST, SELF_REVIEW].join(" ").toLowerCase();
    expect(text).not.toContain("comment");
    expect(text).not.toContain("swipe");
  });
});
