import { describe, expect, it } from "vitest";
import {
  HOOK_STYLES,
  consistencySection,
  memorySection,
  openingLine,
  pickHookStyle,
} from "./memory";
import { findRepeatedOpening } from "./novelty";
import { playbookSection } from "./playbook";
import { buildCarouselPrompt, buildSocialPrompt, emptyContext, ANGLES } from "./prompts";
import { getCarouselStructure } from "./carousel/story";
import { groundTrends, trendLines, trendsAreFresh, trendsFor, type SocialTrends } from "./trends";

const sources = [{ url: "https://a.example/one" }, { url: "https://b.example/two" }];

describe("social trends", () => {
  it("keeps only trends that cite a source the search returned", () => {
    const trends = groundTrends(
      [
        {
          platform: "Instagram",
          kind: "format",
          title: "Seven to ten slide carousels",
          detail: "Longer carousels that teach one thing step by step are being saved more.",
          source: 1,
        },
        {
          platform: "x",
          kind: "hook",
          title: "Plain one-line openings",
          detail: "Posts that open with one plain statement are getting more replies.",
          source: 2,
        },
        {
          platform: "tiktok",
          kind: "format",
          title: "Invented by the model",
          detail: "This one cites a source that was never supplied to the model.",
          source: 9,
        },
        { platform: "tiktok", kind: "format", title: "No source at all", detail: "x".repeat(40) },
      ],
      sources,
    );
    expect(trends).toHaveLength(2);
    expect(trends[0]).toMatchObject({ platform: "instagram", url: "https://a.example/one" });
    expect(trends[1].platform).toBe("twitter");
  });

  it("treats an old snapshot as no snapshot", () => {
    const now = new Date("2026-10-03T00:00:00Z");
    expect(trendsAreFresh({ collectedAt: "2026-09-25T00:00:00Z" }, now)).toBe(true);
    expect(trendsAreFresh({ collectedAt: "2026-08-01T00:00:00Z" }, now)).toBe(false);
    expect(trendsAreFresh(null, now)).toBe(false);
    const stale: SocialTrends = {
      collectedAt: "2020-01-01T00:00:00Z",
      items: [{ platform: "all", kind: "format", title: "Old", detail: "Old news.", url: "u" }],
    };
    expect(trendLines(stale, ["instagram"])).toBe("");
  });

  it("puts the requested platforms first and spreads across them", () => {
    const item = (platform: string, title: string) =>
      ({ platform, kind: "format", title, detail: "A usable detail sentence.", url: "u" }) as never;
    const trends: SocialTrends = {
      collectedAt: new Date().toISOString(),
      items: [
        item("tiktok", "t1"),
        item("tiktok", "t2"),
        item("tiktok", "t3"),
        item("linkedin", "l1"),
        item("all", "g1"),
        item("facebook", "f1"),
      ],
    };
    const picked = trendsFor(trends, ["linkedin", "tiktok"], 4).map((t) => t.title);
    expect(picked).toContain("l1");
    expect(picked).toContain("t1");
    expect(picked).toContain("g1");
    expect(picked).not.toContain("f1");
  });
});

const recent = [
  {
    title: "Cold brew mistakes",
    type: "social",
    channel: "instagram",
    angle: "how-to",
    createdAt: "2026-10-01",
    status: "published",
    hook: "Most people grind their cold brew far too fine",
    sample:
      "Most people grind their cold brew far too fine. Here is what we do instead, and why it matters for the cup you pour on day three.",
  },
];

describe("content memory", () => {
  it("opens differently from the last few pieces", () => {
    const recent = HOOK_STYLES.slice(0, 5).map((h) => h.id);
    for (const seed of ["a", "b", "c", "d"]) {
      expect(recent).not.toContain(pickHookStyle(seed, recent).id);
    }
    expect(pickHookStyle("a", recent, "question").id).toBe("question");
  });

  it("reads the first real line of a post", () => {
    expect(openingLine("\n\n# Most cafés get this wrong\nMore text\n#coffee #brew")).toBe(
      "Most cafés get this wrong",
    );
    expect(openingLine("#coffee #brew\nActual line")).toBe("Actual line");
    expect(openingLine(null)).toBe("");
  });

  it("lists taken openings and offers published copy as a voice reference only", () => {
    expect(memorySection(recent)).toContain("Most people grind their cold brew far too fine");
    expect(consistencySection(recent)).toContain("<published 1>");
    expect(consistencySection([{ ...recent[0], status: "rejected" }])).toBe("");
    expect(memorySection([])).toBe("");
  });

  it("catches a new piece that opens the way an old one did", () => {
    const repeat = findRepeatedOpening(
      {
        variants: [
          {
            platform: "instagram",
            title: "",
            body: "Most people grind their cold brew far too fine.\nSo here is a new idea.",
            hashtags: [],
            chars: 0,
          },
        ],
      },
      recent,
    );
    expect(repeat?.title).toBe("Cold brew mistakes");
    expect(
      findRepeatedOpening(
        {
          variants: [
            {
              platform: "instagram",
              title: "",
              body: "Your Sunday batch tastes flat by Wednesday for one reason.",
              hashtags: [],
              chars: 0,
            },
          ],
        },
        recent,
      ),
    ).toBeNull();
  });
});

describe("prompts carry craft, trends and memory", () => {
  const ctx = {
    ...emptyContext("Slow Pour"),
    recent,
    socialTrends: {
      collectedAt: new Date().toISOString(),
      items: [
        {
          platform: "instagram" as const,
          kind: "format" as const,
          title: "Seven to ten slide carousels",
          detail: "Longer step-by-step carousels are being saved more.",
          url: "https://a.example/one",
        },
      ],
    },
  };
  const base = {
    ctx,
    intent: { brief: "Why cold brew goes flat" },
    controls: { platforms: ["instagram" as const], slideCount: 7 },
    angle: ANGLES[1],
    hook: HOOK_STYLES[0],
  };

  it("social prompt", () => {
    const { user } = buildSocialPrompt(base);
    expect(user).toContain("## Opening");
    expect(user).toContain("## How this platform and format work");
    expect(user).toContain("Seven to ten slide carousels");
    expect(user).toContain("Never write that something is trending");
    expect(user).toContain("## Already made");
    expect(user).toContain("## Stay consistent with the profile");
    // The source link stays out of the prompt: the model must not cite it.
    expect(user).not.toContain("a.example");
  });

  it("carousel prompt plans every slide and names the structure", () => {
    const { system } = buildCarouselPrompt({
      ...base,
      carouselStructure: getCarouselStructure("steps")!,
    });
    expect(system).toContain("Slide 1: cover");
    expect(system).toContain("Slide 6: recap");
    expect(system).toContain("Slide 7: close");
    expect(system).toContain("Step by step");
    expect(system).toContain("ONE piece told across slides");
  });

  it("names the playbook for each requested platform", () => {
    const text = playbookSection("carousel", ["instagram", "linkedin"]);
    expect(text).toContain("instagram:");
    expect(text).toContain("linkedin:");
  });
});
