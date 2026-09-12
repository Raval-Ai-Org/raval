import { describe, expect, it } from "vitest";
import {
  normalizeStudioType,
  studioTypeFromContent,
  STUDIO_FORMATS,
  STUDIO_TYPE_ORDER,
} from "@/lib/studio/formats";
import { recommendedRatio, IMAGE_SIZE_BY_RATIO } from "@/lib/studio/aspect";
import { upcomingMoments, daysUntil } from "@/lib/studio/moments";
import {
  ANGLES,
  buildArticlePrompt,
  buildSocialPrompt,
  emptyContext,
  finalizeVariant,
  finalizeVariants,
  pickAngle,
} from "@/lib/studio/prompts";
import {
  collectSignals,
  dedupeIdeas,
  fallbackIdeas,
  sanitizeIdea,
  similarity,
} from "@/lib/studio/ideas";
import { CreateJobSchema } from "@/lib/studio/jobs";

describe("studio formats", () => {
  it("maps retired canvas names to types that still exist", () => {
    expect(normalizeStudioType("social-post")).toBe("social");
    expect(normalizeStudioType("design-asset")).toBe("image");
    expect(normalizeStudioType("seo-brief")).toBe("article");
    expect(normalizeStudioType("email")).toBe("article");
    expect(normalizeStudioType("landing-page")).toBe("article");
    expect(normalizeStudioType("nonsense")).toBeNull();
  });

  it("resolves legacy kinds as read-only and tagged rows by their studio type", () => {
    expect(studioTypeFromContent("brief")).toBe("legacy");
    expect(studioTypeFromContent("email")).toBe("legacy");
    expect(studioTypeFromContent("post", { studio_type: "carousel" })).toBe("carousel");
    expect(studioTypeFromContent("blog")).toBe("article");
    expect(studioTypeFromContent("post")).toBe("social");
  });

  it("every media format offers at least one renderable ratio", () => {
    for (const type of STUDIO_TYPE_ORDER) {
      const f = STUDIO_FORMATS[type];
      if (f.media === "image" || f.media === "optional-image") {
        expect(f.ratios.some((r) => IMAGE_SIZE_BY_RATIO[r])).toBe(true);
      }
      expect(f.stages[0].id).toBe("context");
    }
  });
});

describe("aspect defaults", () => {
  it("follows the platform when there's one clear choice", () => {
    expect(recommendedRatio(["instagram"])).toBe("4:5");
    expect(recommendedRatio(["tiktok"], "video")).toBe("9:16");
  });
  it("compromises on square for mixed feeds", () => {
    expect(recommendedRatio(["instagram", "twitter"])).toBe("1:1");
  });
});

describe("marketing moments", () => {
  it("surfaces Black Friday inside its lead window only", () => {
    const early = upcomingMoments(new Date("2026-09-01T12:00:00Z"), { limit: 20 });
    expect(early.some((m) => m.name === "Black Friday")).toBe(false);
    const near = upcomingMoments(new Date("2026-11-05T12:00:00Z"), { limit: 20 });
    const bf = near.find((m) => m.name === "Black Friday");
    expect(bf?.date).toBe("2026-11-27");
    expect(daysUntil("2026-11-27", new Date("2026-11-05T12:00:00Z"))).toBe(22);
  });
});

describe("prompt engine", () => {
  const ctx = {
    ...emptyContext("Northwind Coffee"),
    brandText: "## Brand DNA\n- Brand: Northwind Coffee\n- Audience: remote workers",
    recent: [
      {
        title: "Why cold brew beats iced coffee",
        type: "social",
        channel: "instagram",
        angle: "myth",
        createdAt: "2026-09-10",
      },
      {
        title: "Behind our roastery",
        type: "social",
        channel: "linkedin",
        angle: "behind-scenes",
        createdAt: "2026-09-08",
      },
    ],
  };

  it("avoids recently used angles and is stable per seed", () => {
    const a = pickAngle("seed-1", ["myth", "behind-scenes"]);
    expect(["myth", "behind-scenes"]).not.toContain(a.id);
    expect(pickAngle("seed-1", ["myth", "behind-scenes"]).id).toBe(a.id);
    expect(pickAngle("x", [], "data").id).toBe("data");
    expect(ANGLES.length).toBeGreaterThan(6);
  });

  it("builds a platform-specific social prompt with brand, avoid list and angle", () => {
    const angle = pickAngle("seed", []);
    const built = buildSocialPrompt({
      ctx,
      intent: { brief: "Launch our new oat latte", goal: "launch" },
      controls: { platforms: ["linkedin", "twitter"] },
      angle,
    });
    expect(built.user).toContain("Northwind Coffee");
    expect(built.user).toContain("Why cold brew beats iced coffee");
    expect(built.user).toContain(angle.label);
    expect(built.user).toContain("twitter (X / Twitter)");
    expect(built.user).toMatch(/Goal: launch/);
    expect(built.system).not.toMatch(/Write a LinkedIn post about/);
  });

  it("includes the current draft and target when refining", () => {
    const built = buildArticlePrompt({
      ctx,
      intent: { brief: "Guide to home espresso" },
      controls: { platforms: [], length: "short" },
      angle: ANGLES[0],
      refine: { instruction: "Make it warmer", target: "all" },
      current: {
        title: "Old title",
        article: {
          title: "Old",
          dek: "",
          metaDescription: "",
          markdown: "x",
          takeaways: [],
          wordCount: 1,
        },
      },
    });
    expect(built.user).toContain("Old title");
    expect(built.user).toContain("Make it warmer");
    expect(built.temperature).toBeLessThan(0.6);
  });

  it("enforces platform limits and hashtag caps", () => {
    const v = finalizeVariant("twitter", {
      body: "x".repeat(400),
      hashtags: ["a", "#a", "b", "c"],
    });
    expect(v.chars).toBeLessThanOrEqual(280);
    expect(v.hashtags).toEqual(["#a", "#b"]);
    const { variants, missing } = finalizeVariants(["linkedin", "twitter"], {
      title: "t",
      variants: [{ platform: "x", body: "short take", hashtags: [] }],
    });
    expect(variants.map((x) => x.platform)).toEqual(["twitter"]);
    expect(missing).toEqual(["linkedin"]);
  });
});

describe("ideas", () => {
  const ctx = {
    ...emptyContext("Northwind Coffee"),
    opportunities: ["Decaf demand is rising — publish a decaf guide"],
    moments: upcomingMoments(new Date("2026-11-05T12:00:00Z"), { limit: 2 }),
    recent: [
      {
        title: "Decaf guide for night owls",
        type: "article",
        channel: "blog",
        angle: null,
        createdAt: new Date().toISOString(),
      },
    ],
  };

  it("collects signals from moments, trends, gaps and pillars", () => {
    const signals = collectSignals(
      ctx,
      {
        products: "Single-origin beans; subscription",
        customer: { painPoints: "Coffee tastes bitter at home" },
      },
      new Date("2026-11-05T12:00:00Z"),
    );
    const sources = new Set(signals.map((s) => s.source));
    expect(sources.has("season")).toBe(true);
    expect(sources.has("trend")).toBe(true);
    expect(sources.has("pillar")).toBe(true);
  });

  it("dedupes against recent work and each other", () => {
    expect(similarity("Decaf guide for night owls", "The night owl decaf guide")).toBeGreaterThan(
      0.45,
    );
    const ideas = fallbackIdeas(collectSignals(ctx, null, new Date("2026-11-05T12:00:00Z")), ctx, {
      limit: 5,
    });
    const kept = dedupeIdeas(
      [...ideas, { ...ideas[0], id: "dup" }],
      ["Decaf guide for night owls"],
    );
    expect(kept.filter((i) => i.title === ideas[0].title).length).toBeLessThanOrEqual(1);
    expect(ideas.every((i) => !/^create/i.test(i.title))).toBe(true);
  });

  it("sanitizes model ideas to valid formats and platforms", () => {
    expect(
      sanitizeIdea({
        type: "email",
        title: "Something useful",
        brief: "A long enough brief for testing.",
      }),
    ).toBeNull();
    const idea = sanitizeIdea({
      type: "article",
      title: "Espresso at home, demystified",
      brief: "Explain the three variables that matter.",
      platforms: ["instagram"],
    });
    expect(idea?.platforms).toEqual([]);
  });
});

describe("job contract", () => {
  it("rejects unknown types and short briefs", () => {
    const base = {
      workspaceId: "3f1c2a8e-5b7d-4c1a-9e2f-0a1b2c3d4e5f",
      idempotencyKey: "studio-abcdef12",
      controls: {},
    };
    expect(
      CreateJobSchema.safeParse({ ...base, type: "email", intent: { brief: "hello there" } })
        .success,
    ).toBe(false);
    expect(
      CreateJobSchema.safeParse({ ...base, type: "social", intent: { brief: "hi" } }).success,
    ).toBe(false);
    expect(
      CreateJobSchema.safeParse({
        ...base,
        type: "social",
        intent: { brief: "Announce the launch" },
      }).success,
    ).toBe(true);
  });
});
