import { describe, expect, it } from "vitest";
import { resolveLook } from "@/lib/brand-look/resolve";
import { styleBlockFor } from "@/lib/brand-look/prompt";
import {
  answersToGoals,
  answersToLook,
  answersToProfile,
  readAnswers,
  recommendedRhythm,
  whoRunsLine,
} from "./answers";
import { ONBOARDING_ART_IDS } from "./art";
import { askScreens, questionArtIds } from "./questions";

describe("answersToLook", () => {
  it("fills person, tone, emoji and length from the answers", () => {
    const look = answersToLook(
      { role: "creator", tone: "funny", emoji: "few", length: "short" },
      { writing: { language: "English" } },
    );
    expect(look.writing).toMatchObject({
      language: "English",
      person: "i",
      emoji: "light",
      sentenceLength: "short",
      tone: { casual: 85, playful: 85, detailed: 15 },
    });
  });

  it("never overwrites what a person set", () => {
    const look = answersToLook(
      { teamSize: "small", tone: "corporate", emoji: "plenty" },
      { writing: { person: "brand", emoji: "none", tone: { casual: 90 } } },
    );
    expect(look.writing?.person).toBe("brand");
    expect(look.writing?.emoji).toBe("none");
    expect(look.writing?.tone).toEqual({ casual: 90, playful: 10 });
  });

  it("leaves 'Let Mox decide' unset", () => {
    const look = answersToLook({ tone: "auto", emoji: "auto", length: "auto" }, {});
    expect(look.writing).toBeUndefined();
  });

  it("reaches the prompt through styleBlockFor", () => {
    const look = answersToLook(
      {
        role: "marketing",
        tone: "personal",
        emoji: "none",
        styles: ["bold-poster", "3d"],
      },
      {},
    );
    const block = styleBlockFor(resolveLook({ look }), "image");
    expect(block).toMatch(/Point of view/);
    expect(block).toMatch(/No emoji/);
    expect(block).toMatch(/Bold poster/);
    expect(block).not.toMatch(/Medium: photo/);
  });
});

describe("answersToGoals", () => {
  it("needs a focus", () => {
    expect(answersToGoals({ rhythm: 3 }, null)).toBeNull();
  });

  it("keeps targets a person typed and caps channels", () => {
    const raw = answersToGoals(
      {
        focus: "sales",
        rhythm: 4,
        channels: ["instagram", "tiktok", "linkedin", "facebook", "youtube", "threads"],
      },
      {
        focus: "reach",
        targets: [{ metric: "reach", target: 5000 }],
        timeframeWeeks: 26,
        postsPerWeek: 2,
        channels: [],
        startedAt: new Date().toISOString(),
        note: "Spring",
      },
    );
    expect(raw).toMatchObject({
      focus: "sales",
      postsPerWeek: 4,
      timeframeWeeks: 26,
      targets: [{ metric: "reach", target: 5000 }],
      note: "Spring",
    });
    expect((raw?.channels as string[]).length).toBe(5);
  });

  it("stars a steady rhythm", () => {
    expect(recommendedRhythm("very")).toBe(7);
    expect(recommendedRhythm("not_yet")).toBe(3);
    expect(recommendedRhythm("sometimes", "launch")).toBe(4);
  });
});

describe("profile", () => {
  it("keeps who runs the brand and says it in one line", () => {
    const p = answersToProfile({ role: "owner", teamSize: "solo", activity: "sometimes" });
    expect(p).toEqual({ role: "owner", teamSize: "solo", activity: "sometimes" });
    expect(whoRunsLine(p)).toBe("the owner, on their own");
    expect(whoRunsLine({ role: "creator", teamSize: "solo" })).toBe(
      "a creator posting as themselves",
    );
    expect(whoRunsLine(undefined)).toBeNull();
  });
});

describe("readAnswers", () => {
  it("drops anything that isn't a real answer", () => {
    expect(
      readAnswers({ role: "king", tone: "funny", rhythm: 5, styles: ["3d", "nope", 3] }),
    ).toEqual({ tone: "funny", styles: ["3d"] });
  });
});

describe("questions", () => {
  it("asks one thing per screen and every picture exists", () => {
    const made = new Set<string>(ONBOARDING_ART_IDS);
    for (const id of questionArtIds()) expect(made.has(id), id).toBe(true);
  });

  it("asks where people heard of Mellox once per account", () => {
    const ids = (known: boolean) =>
      askScreens({}, { mode: "site", sourceKnown: known }).map((s) => s.id);
    expect(ids(false)).toContain("source");
    expect(ids(true)).not.toContain("source");
  });

  it("answers the tone with a short beat", () => {
    const ids = askScreens({ tone: "corporate" }, { mode: "site", sourceKnown: true }).map(
      (s) => s.id,
    );
    expect(ids.indexOf("tone-reaction")).toBe(ids.indexOf("tone") + 1);
  });

  it("stars exactly one rhythm", () => {
    const rhythm = askScreens({ activity: "regular" }, { mode: "site", sourceKnown: true }).find(
      (s) => s.id === "rhythm",
    );
    expect(rhythm?.kind === "pick" && rhythm.options.filter((o) => o.recommended).length).toBe(1);
  });
});

describe("autopilot set-up", () => {
  it("proposes the approval the person picked, never full where it isn't allowed", async () => {
    const { autopilotModeFor, weekdaysForRhythm } = await import("./answers");
    expect(autopilotModeFor("assist", true)).toBe("assist");
    expect(autopilotModeFor("full", false)).toBe("autopilot");
    expect(autopilotModeFor(undefined, true)).toBe("full");
    expect(weekdaysForRhythm(3)).toEqual([1, 3, 5]);
    expect(weekdaysForRhythm(7)).toHaveLength(7);
    expect(weekdaysForRhythm(14)).toHaveLength(7);
  });

  it("keeps the approval on the profile", () => {
    expect(answersToProfile({ approval: "assist" })).toEqual({ approval: "assist" });
  });
});

describe("own photos (Round 9)", () => {
  it("asks for the brand's real photos once, before the last question", () => {
    const list = askScreens({ tone: "auto" }, { mode: "site", sourceKnown: false });
    const at = list.findIndex((s) => s.kind === "photos");
    expect(at).toBeGreaterThan(0);
    expect(list[at + 1]?.id).toBe("source");
    expect(askScreens({}, { mode: "manual", sourceKnown: true }).at(-1)?.kind).toBe("photos");
  });

  it("uses three or more photos often, never over a person's own setting", async () => {
    const { answersToLook, OWN_PHOTOS_OFTEN } = await import("./answers");
    expect(answersToLook({ photos: OWN_PHOTOS_OFTEN }, null).visual?.ownMedia).toBe("often");
    expect(answersToLook({ photos: 2 }, null).visual?.ownMedia).toBeUndefined();
    expect(answersToLook({ photos: 9 }, { visual: { ownMedia: "rarely" } }).visual?.ownMedia).toBe(
      "rarely",
    );
  });
});
