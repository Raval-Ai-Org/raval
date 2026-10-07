import { describe, expect, it } from "vitest";
import { buildStarters, IDEAS_PER_GROUP, starterFacts } from "./starters";

const texts = (facts: Parameters<typeof buildStarters>[0], day = 0) =>
  buildStarters(facts, day).flatMap((group) => group.ideas.map((idea) => idea.text));

describe("starterFacts", () => {
  it("takes one short phrase from each field", () => {
    const facts = starterFacts({
      brandName: " Acme Coffee ",
      products: "- Cold brew subscription\n- Beans",
      audienceTags: ["Busy office teams", "Cafés"],
      competitors: [{ name: "Bean Box" }],
      socials: [{ platform: "instagram" }, { platform: "linkedin" }],
      websiteUrl: "https://acme.example",
    });
    expect(facts).toEqual({
      brand: "Acme Coffee",
      product: "Cold brew subscription",
      audience: "Busy office teams",
      competitor: "Bean Box",
      platform: "LinkedIn",
      hasWebsite: true,
    });
  });

  it("drops long or empty values and falls back to LinkedIn", () => {
    const facts = starterFacts({
      brandName: "",
      products: "We sell a very wide range of handmade things for every room of the house",
      socials: [{ platform: "youtube" }],
    });
    expect(facts).toEqual({
      brand: undefined,
      product: undefined,
      audience: undefined,
      competitor: undefined,
      platform: "LinkedIn",
      hasWebsite: false,
    });
  });
});

describe("buildStarters", () => {
  it("gives every group the same number of short, unique ideas on any day", () => {
    for (const facts of [starterFacts({}), starterFacts({ brandName: "Acme", products: "Tea" })]) {
      for (let day = -3; day < 12; day++) {
        for (const group of buildStarters(facts, day)) {
          expect(group.ideas).toHaveLength(IDEAS_PER_GROUP);
          expect(new Set(group.ideas.map((i) => i.text)).size).toBe(IDEAS_PER_GROUP);
          for (const idea of group.ideas) {
            expect(idea.text.length).toBeLessThanOrEqual(110);
            expect(idea.text).not.toMatch(/undefined|null/);
            expect(idea.text.endsWith(" ")).toBe(idea.run === "prefill");
          }
        }
      }
    }
  });

  it("names what the brand really has, first", () => {
    const groups = buildStarters(
      starterFacts({
        brandName: "Acme",
        products: "Cold brew",
        competitors: [{ name: "Bean Box" }],
        socials: [{ platform: "Instagram" }],
        websiteUrl: "https://acme.example",
      }),
    );
    const first = Object.fromEntries(groups.map((g) => [g.id, g.ideas[0].text]));
    expect(first.create).toBe("Write an Instagram post about Cold brew");
    expect(first.competitors).toBe("What has Bean Box done lately?");
    expect(first.found).toContain("Acme");
  });

  it("never names a competitor or product that isn't there", () => {
    const all = texts(starterFacts({})).join("\n");
    expect(all).toContain("Who are my main competitors?");
    expect(all).toContain("What do I need to set up so you can check my website?");
  });

  it("changes with the day", () => {
    const facts = starterFacts({});
    expect(texts(facts, 0)).not.toEqual(texts(facts, 1));
  });
});
