import { describe, expect, it } from "vitest";
import {
  CONCEPT_TEST,
  CONCEPT_TEST_RELEVANT,
  HOUSE_CRAFT,
  HOUSE_TYPE_LINE_VOICE,
  TECHNIQUES,
  creativeSystemLines,
  houseCraft,
  techniquesFor,
} from "./creative-system";
import { composedHeadline } from "./post-plan";
import { drawnWordsDrift } from "./brief-fit";
import { readBrief } from "./brief-read";
import { slidePlanText } from "./carousel/story";
import { pickSurpriseIdea } from "./post-styles";
import { SKILL_LINES_CHARS, skillLinesBody } from "./skill-lines";
import {
  ANGLES,
  buildAdPrompt,
  buildCarouselPrompt,
  buildVisualBriefPrompt,
  emptyContext,
} from "./prompts";

// Round 9 (ADR-0053): every pack is off by default and "off" must be today's
// prompt exactly; "on" may only swap a line for one no longer, and add at
// most 3 short lines inside the Business section.

const ids = (list: { id: string }[]) => list.map((t) => t.id);

// Stored technique ids: add, never rename.
const STORED_TECHNIQUES = [
  "visual-metaphor",
  "hero-drama",
  "type-and-subject",
  "symbolic-object",
  "number-hero",
  "object-pun",
  "culture-tie",
  "character-product",
  "bold-statement",
  "contrast",
  "real-moment",
  "clean-announcement",
  "editorial-portrait",
  "show-the-work",
];

function plumber(skills?: Record<string, boolean>, skillLines?: string[]) {
  return {
    ctx: {
      ...emptyContext("Northside Plumbing"),
      industry: "Plumbing and heating",
      brandText:
        "Northside Plumbing fixes leaks, boilers and blocked drains for homes across the north side.",
    },
    intent: { brief: "Post about our same-day boiler repair service", goal: "leads" } as never,
    controls: { platforms: ["instagram"] } as never,
    angle: ANGLES[0],
    ...(skills ? { skills } : {}),
    ...(skillLines ? { skillLines } : {}),
  };
}

describe("round 9 relevance pack", () => {
  it("keeps technique ids add-only", () => {
    expect(ids([...TECHNIQUES])).toEqual(STORED_TECHNIQUES);
  });

  it("off: services are offered exactly what they were before", () => {
    const off = ids(techniquesFor({ service: true }));
    expect(off[0]).toBe("symbolic-object");
    expect(off).not.toContain("show-the-work");
    expect(creativeSystemLines({ service: true }).join("\n")).toContain("crane hook");
  });

  it("on: services lead with the real work and lose the crane", () => {
    const on = ids(techniquesFor({ service: true, relevance: true }));
    expect(on[0]).toBe("show-the-work");
    expect(on.at(-1)).toBe("symbolic-object");
    const text = creativeSystemLines({ service: true, skills: { relevance: true } }).join("\n");
    expect(text).not.toMatch(/crane/i);
    // Posts that must be clear keep their plain technique first.
    const hiring = ids(techniquesFor({ deliverable: "hiring", service: true, relevance: true }));
    expect(hiring.slice(0, 2)).toEqual(["clean-announcement", "show-the-work"]);
    // A product brand is not touched.
    expect(ids(techniquesFor({ deliverable: "launch", relevance: true }))).toEqual(
      ids(techniquesFor({ deliverable: "launch" })),
    );
  });

  it("swapped lines are no longer than the ones they replace", () => {
    expect(CONCEPT_TEST_RELEVANT.length).toBeLessThanOrEqual(CONCEPT_TEST.length);
    expect(HOUSE_TYPE_LINE_VOICE.length).toBeLessThanOrEqual(HOUSE_CRAFT[1].length);
    expect(houseCraft({ type: true })[1]).toBe(HOUSE_TYPE_LINE_VOICE);
    expect(houseCraft({})).toBe(HOUSE_CRAFT);
    expect(HOUSE_TYPE_LINE_VOICE).not.toMatch(/condensed/i);
  });

  it("off is byte-identical; on keeps the system no longer and the user within 450 chars", () => {
    const builders = [
      (a: ReturnType<typeof plumber>) => buildVisualBriefPrompt({ ...a, medium: "image" } as never),
      (a: ReturnType<typeof plumber>) => buildCarouselPrompt(a as never),
      (a: ReturnType<typeof plumber>) => buildAdPrompt(a as never),
    ];
    const lines = [
      "What to show: the engineer at the boiler, tools out, in a real home.",
      "Rings false here: a hard hat, a crane, a handshake.",
    ];
    for (const build of builders) {
      const off = build(plumber());
      const offExplicit = build(plumber({}));
      expect(offExplicit.system).toBe(off.system);
      expect(offExplicit.user).toBe(off.user);
      const on = build(plumber({ relevance: true, type: true }, lines));
      expect(on.system.length).toBeLessThanOrEqual(off.system.length + 60);
      expect(on.user.length - off.user.length).toBeLessThanOrEqual(SKILL_LINES_CHARS + 20);
      expect(on.user).toContain("the engineer at the boiler");
    }
    const post = buildVisualBriefPrompt({
      ...plumber({ relevance: true }),
      medium: "image",
    } as never);
    expect(post.system).not.toContain("GPT Image");
    expect(post.system).toContain("out of 50");
  });

  it("caps skill lines at 3 and 450 characters", () => {
    const long = "x".repeat(300);
    expect(skillLinesBody([long, long, "a", "b", "c"])).toEqual([long, "a", "b"]);
    expect(skillLinesBody(undefined)).toEqual([]);
  });

  it("composed artwork draws the director's words, not the internal title", () => {
    const out = { title: "Boiler service Q4", onImageText: "Warm by tonight" };
    expect(composedHeadline(out, "brief")).toBe("Boiler service Q4");
    expect(composedHeadline(out, "brief", { relevance: true })).toBe("Warm by tonight");
    expect(composedHeadline({ onImageText: "" }, "the brief", { relevance: true })).toBe(
      "the brief",
    );
  });

  it("flags drawn words that share nothing with the brief (shadow only)", () => {
    const read = readBrief("Post about our same-day boiler repair service");
    expect(drawnWordsDrift({ read, headline: "Dream bigger today" })).toMatch(/none of/);
    expect(drawnWordsDrift({ read, headline: "Boiler fixed by tonight" })).toBeNull();
  });

  it("carousel close and Surprise me follow the pack", () => {
    expect(slidePlanText(5)).toBe(slidePlanText(5, {}));
    expect(slidePlanText(5, { relevance: true })).toContain("brief's own next step");
    const off = pickSurpriseIdea({ seed: "s", recent: [] });
    expect(pickSurpriseIdea({ seed: "s" })).toEqual(off);
    for (let i = 0; i < 40; i++) {
      const idea = pickSurpriseIdea({ seed: `seed-${i}`, relevance: true });
      if (idea.id === "service-object") expect(idea.line).not.toMatch(/crane/i);
    }
  });
});

describe("round 9 context pack", () => {
  it("gives the director the caption, the goal and the campaign phase only when on", () => {
    const args = {
      ...plumber(),
      controls: { platforms: ["instagram"], campaign: "Winter ready" } as never,
      ctx: {
        ...plumber().ctx,
        campaignsNow: [
          {
            name: "Winter ready",
            phase: "Build-up",
            purpose: "Get boilers serviced before the cold.",
          },
        ],
      },
      pictureCaption: "Book your boiler service before the first frost.",
    };
    const off = buildVisualBriefPrompt({ ...args, medium: "image" } as never);
    const on = buildVisualBriefPrompt({
      ...args,
      skills: { context: true },
      medium: "image",
    } as never);
    expect(off.user).not.toContain("first frost");
    expect(on.user).toContain("first frost");
    expect(on.user).toContain("What the post is for: leads");
    expect(on.user).toContain("Phase: Build-up");
    expect(on.system).toBe(off.system);
  });

  it("tells the director about attached photos and live research only when on", () => {
    const args = {
      ...plumber(),
      controls: { platforms: ["instagram"], referenceAssetIds: ["a", "b"] } as never,
      ctx: {
        ...plumber().ctx,
        liveResearch: { summary: "Gas boiler checks are due yearly.", sources: [] },
      },
    };
    const off = buildVisualBriefPrompt({ ...args, medium: "image" } as never);
    const on = buildVisualBriefPrompt({
      ...args,
      skills: { context: true },
      medium: "image",
    } as never);
    expect(off.user).not.toContain("2 photos of their own");
    expect(on.user).toContain("2 photos of their own");
    expect(on.user).toContain("Gas boiler checks are due yearly.");
    expect(on.system).toBe(off.system);
  });
});
