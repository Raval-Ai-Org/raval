import { describe, expect, it } from "vitest";
import { awarenessFor, pickFramework } from "./frameworks";
import { INDUSTRIES, industryOf } from "./industries";
import { KNOWLEDGE_MAX_CHARS, knowledgeFor, knowledgeRule } from "./select";
import { SKILLS, skillsFor } from "./skills";

describe("industryOf", () => {
  it("reads the industry line first", () => {
    expect(industryOf("Restaurant", "software platform for teams")?.id).toBe("restaurant");
    expect(industryOf("B2B SaaS", null)?.id).toBe("saas");
  });
  it("needs two matches in free text", () => {
    expect(industryOf(null, "We sell one thing")).toBeNull();
    expect(industryOf(null, "A cosy cafe serving coffee and espresso all day")?.id).toBe("cafe");
  });
  it("has unique ids", () => {
    expect(new Set(INDUSTRIES.map((i) => i.id)).size).toBe(INDUSTRIES.length);
  });
});

describe("pickFramework", () => {
  it("leaves memes and relatable posts alone", () => {
    expect(pickFramework({ category: "meme" })).toBeNull();
    expect(pickFramework({ category: "relatable", goal: "offer" })).toBeNull();
  });
  it("fits the job", () => {
    expect(pickFramework({ category: "proof" })?.id).toBe("star");
    expect(pickFramework({ adObjective: "leads" })?.id).toBe("pas");
    expect(pickFramework({ category: "sale" })?.id).toBe("four-ps");
    expect(pickFramework({ category: "tips", format: "carousel" })?.id).toBe("acca");
    expect(pickFramework({ format: "video" })?.id).toBe("hook-story-offer");
  });
  it("maps stages to awareness", () => {
    expect(awarenessFor({ stage: "attract" })).toBe("unaware");
    expect(awarenessFor({ category: "sale" })).toBe("most");
  });
});

describe("skills", () => {
  it("has unique ids", () => {
    expect(new Set(SKILLS.map((s) => s.id)).size).toBe(SKILLS.length);
  });
  it("gives a sale its offer skill first, at most three", () => {
    const picked = skillsFor({ category: "sale", goal: "offer" });
    expect(picked[0].id).toBe("offer-clarity");
    expect(picked.length).toBeLessThanOrEqual(3);
  });
  it("gives nothing to an empty job", () => {
    expect(skillsFor({})).toEqual([]);
  });
});

describe("knowledgeFor", () => {
  it("is deterministic and capped", () => {
    const job = { category: "sale", goal: "offer", format: "ad", industry: "Restaurant" };
    expect(knowledgeRule(job)).toBe(knowledgeRule(job));
    const { lines, industry } = knowledgeFor(job);
    expect(industry?.id).toBe("restaurant");
    expect(lines.join("").length).toBeLessThanOrEqual(KNOWLEDGE_MAX_CHARS);
    expect(lines.some((l) => l.includes("never invent") || l.includes("Never invent"))).toBe(true);
  });
  it("gives a meme no argument shape", () => {
    const { lines } = knowledgeFor({ category: "meme", industry: "SaaS" });
    expect(lines.some((l) => l.startsWith("Argument shape"))).toBe(false);
    expect(lines.some((l) => l.startsWith("B2B buyer") || l.startsWith("Software that"))).toBe(
      false,
    );
    expect(lines.some((l) => l.startsWith("What this audience lives with"))).toBe(true);
  });
});
