import { describe, expect, it } from "vitest";
import {
  applyCalibration,
  calibrate,
  engagementRate,
  learnedPatterns,
  outcomeReady,
  percentileAmong,
  readMetrics,
  shrunkShift,
  type MeasuredPost,
} from "./calibration";
import type { Dimensions, Trait } from "./contracts";
import { stableHash } from "./hash";
import {
  aggregatePulse,
  cleanJudgement,
  cleanTwinAnswer,
  panelPlan,
  rankVersions,
  segmentSpread,
  TOO_CLOSE_MARGIN,
} from "./panel";
import {
  applyCaps,
  checkSubject,
  cleanDimensions,
  confidenceFor,
  overallOf,
  subjectHash,
  verdictFor,
} from "./score";
import { subjectFromContent } from "./subject";
import {
  applyUserTraits,
  audienceBlock,
  makeTrait,
  mergeTraits,
  panelTwins,
  sameTraits,
  seedFromBrandDna,
  slugify,
  splitStatements,
  twinsFingerprint,
} from "./twins";

const dims = (n: number): Dimensions => ({ fit: n, hook: n, clarity: n, trust: n, cta: n });

const twin = (slug: string, weight: number, profile: Trait[] = [], version = 1) => ({
  id: slug,
  slug,
  kind: "group" as const,
  name: slug,
  segment: "",
  summary: "",
  weight,
  profile,
  version,
  status: "active",
});

describe("audience groups", () => {
  it("seeds one group per Brand DNA customer, with shared traits", () => {
    const drafts = seedFromBrandDna({
      customer: {
        painPoints: "Too little time; Late payments",
        personas: [
          { id: "p1", name: "Salon owners", role: "Owner", goals: "More bookings" },
          { id: "p2", name: "Salon owners", goals: "Fewer no-shows" },
        ],
      },
    });
    expect(drafts).toHaveLength(2);
    expect(drafts[0].slug).toBe("salon-owners");
    expect(drafts[1].slug).not.toBe(drafts[0].slug);
    expect(drafts[0].profile.every((t) => t.source === "brand_dna")).toBe(true);
    expect(drafts[0].profile.map((t) => t.text)).toContain("Late payments");
    expect(drafts[0].origin_ref).toBe("p1");
  });

  it("falls back to one group from the audience text, and to nothing when empty", () => {
    expect(seedFromBrandDna({ audience: "Local cafe owners" })[0].name).toBe("Your audience");
    expect(seedFromBrandDna({ audience: "  " })).toEqual([]);
    expect(seedFromBrandDna(null)).toEqual([]);
  });

  it("splits lists into statements and makes safe slugs", () => {
    expect(splitStatements("Save time; avoid fines\n- sleep better")).toEqual([
      "Save time",
      "avoid fines",
      "sleep better",
    ]);
    expect(slugify("Busy Salon Owners!")).toBe("busy-salon-owners");
    expect(slugify("Overall")).toBe("overall-group");
    expect(slugify("مالکان")).toMatch(/^group-[0-9a-f]{8}$/);
  });

  it("never loses what a person wrote when new traits arrive", () => {
    const mine = makeTrait("pain", "Hates long forms", "user");
    const old = makeTrait("goal", "Old goal", "brand_dna");
    const measured = makeTrait("pattern", "Short posts do better", "measured");
    const merged = mergeTraits([mine, old, measured], [makeTrait("goal", "New goal", "assumed")]);
    const texts = merged.map((t) => t.text);
    expect(texts).toContain("Hates long forms");
    expect(texts).toContain("Short posts do better");
    expect(texts).toContain("New goal");
    expect(texts).not.toContain("Old goal");
    // Nothing new: the old set stays.
    expect(mergeTraits([mine, old], []).map((t) => t.text)).toContain("Old goal");
  });

  it("treats reordered traits and reordered fields as unchanged", () => {
    const a = makeTrait("goal", "More bookings", "brand_dna");
    const b = makeTrait("pain", "No time", "user");
    const stored = [
      { text: b.text, source: b.source, kind: b.kind, id: b.id, confidence: b.confidence },
      a,
    ];
    expect(sameTraits([a, b], stored)).toBe(true);
    expect(sameTraits([a, b], [a])).toBe(false);
    expect(sameTraits([a, b], [a, { ...b, source: "assumed" }])).toBe(false);
  });

  it("marks edited traits as the person's and keeps untouched ones", () => {
    const held = makeTrait("goal", "More bookings", "brand_dna");
    const measured = makeTrait("pattern", "Questions work", "measured");
    const out = applyUserTraits(
      [held, measured],
      [
        { id: held.id, kind: "goal", text: "More bookings" },
        { kind: "pain", text: "No time" },
      ],
    );
    expect(out.find((t) => t.text === "More bookings")?.source).toBe("brand_dna");
    expect(out.find((t) => t.text === "No time")?.source).toBe("user");
    expect(out.some((t) => t.source === "measured")).toBe(true);
  });

  it("fingerprints the audience and picks the panel", () => {
    const a = [twin("a", 60), twin("b", 40)];
    expect(twinsFingerprint(a)).toBe(twinsFingerprint([...a].reverse()));
    expect(twinsFingerprint(a)).not.toBe(twinsFingerprint([twin("a", 60, [], 2), twin("b", 40)]));
    const many = ["a", "b", "c", "d", "e", "f"].map((s, i) => twin(s, 10 + i));
    expect(panelTwins(many)).toHaveLength(5);
    expect(panelTwins(many)[0].slug).toBe("f");
    expect(panelTwins([{ ...twin("overall", 100), kind: "overall" as const }])).toEqual([]);
  });

  it("writes a compact block for generators, or nothing", () => {
    expect(audienceBlock([])).toBe("");
    const block = audienceBlock([
      twin("Owners", 100, [makeTrait("goal", "more bookings", "brand_dna")]),
      {
        ...twin("overall", 100, [makeTrait("pattern", "Short posts do better.", "measured")]),
        kind: "overall" as const,
      },
    ]);
    expect(block).toContain("## Who this is for");
    expect(block).toContain("wants more bookings");
    expect(block).toContain("Short posts do better.");
    expect(
      audienceBlock([twin("a", 1, [makeTrait("goal", "x".repeat(250), "user")])], 120).length,
    ).toBeLessThanOrEqual(120);
  });
});

describe("score", () => {
  it("weights dimensions into one number and cleans model output", () => {
    expect(overallOf(dims(80))).toBe(80);
    expect(overallOf({ ...dims(50), fit: 100 })).toBe(65);
    expect(cleanDimensions({ fit: 140, hook: -3, clarity: "x" })).toEqual({
      fit: 100,
      hook: 0,
      clarity: 50,
      trust: 50,
      cta: 50,
    });
    expect(verdictFor(81)).toBe("Strong");
    expect(verdictFor(49)).toBe("Weak");
  });

  it("caps dimensions from free checks, and only ever lowers", () => {
    const quiet = checkSubject({
      kind: "post",
      platform: "linkedin",
      title: "",
      body: "We opened a second shop on Mill Road last week.",
    });
    expect(quiet.caps.cta).toBe(55);
    expect(applyCaps(dims(90), quiet.caps).cta).toBe(55);
    expect(applyCaps(dims(40), quiet.caps).cta).toBe(40);

    const asks = checkSubject({
      kind: "post",
      platform: "",
      title: "",
      body: "We opened a second shop on Mill Road. Which street should be next?",
    });
    expect(asks.caps.cta).toBeUndefined();

    const tiny = checkSubject({ kind: "post", platform: "", title: "", body: "Hi" });
    expect(tiny.caps.fit).toBe(45);

    const generic = checkSubject({
      kind: "post",
      platform: "",
      title: "",
      body: "Unlock seamless growth and elevate your brand. Try it today?",
    });
    expect(generic.caps.trust).toBe(70);
  });

  it("hashes the exact text, ignoring case and spacing only", () => {
    const base = { kind: "post" as const, platform: "x", title: "T", body: "Hello  world" };
    expect(subjectHash(base)).toBe(subjectHash({ ...base, body: "hello world " }));
    expect(subjectHash(base)).not.toBe(subjectHash({ ...base, body: "Hello there" }));
    expect(subjectHash(base)).not.toBe(subjectHash({ ...base, platform: "linkedin" }));
    expect(stableHash("a")).toHaveLength(32);
  });

  it("only claims confidence it has earned", () => {
    const known = [1, 2, 3, 4].map((i) => makeTrait("goal", `g${i}`, "brand_dna"));
    expect(confidenceFor({ depth: "score", traits: known, measuredPosts: 0 })).toBe("low");
    expect(confidenceFor({ depth: "pulse", traits: known, measuredPosts: 0 })).toBe("medium");
    expect(
      confidenceFor({
        depth: "pulse",
        traits: [makeTrait("goal", "g", "assumed")],
        measuredPosts: 0,
      }),
    ).toBe("low");
    expect(confidenceFor({ depth: "score", traits: [], measuredPosts: 8 })).toBe("medium");
    expect(confidenceFor({ depth: "score", traits: [], measuredPosts: 25 })).toBe("high");
  });

  it("reads the scored text from the saved row", () => {
    const post = subjectFromContent({
      kind: "social",
      channel: "linkedin",
      title: "Launch",
      body: "  We are live.  ",
      meta: { studio_type: "social" },
    });
    expect(post?.subject).toMatchObject({
      kind: "post",
      platform: "linkedin",
      body: "We are live.",
    });
    const carousel = subjectFromContent({
      kind: "carousel",
      channel: "instagram",
      title: "Tips",
      body: "Save this",
      meta: { studio_type: "carousel", slides: [{ heading: "One", body: "First" }] },
    });
    expect(carousel?.subject.body).toContain("Slide 1: One — First");
    expect(carousel?.subject.body).toContain("Caption: Save this");
    expect(
      subjectFromContent({ kind: "blog", channel: null, title: "A", body: "Long", meta: {} }),
    ).toBeNull();
    expect(
      subjectFromContent({
        kind: "social",
        channel: null,
        title: "A",
        body: " ",
        meta: { studio_type: "social" },
      }),
    ).toBeNull();
  });
});

describe("panel", () => {
  it("splits seats by share with a floor and a ceiling", () => {
    expect(panelPlan([])).toEqual([]);
    expect(
      panelPlan([
        { id: "a", weight: 50 },
        { id: "b", weight: 50 },
      ]).map((s) => s.people),
    ).toEqual([8, 8]);
    const plan = panelPlan([
      { id: "a", weight: 90 },
      { id: "b", weight: 5 },
      { id: "c", weight: 5 },
    ]);
    expect(plan.map((s) => s.people)).toEqual([8, 3, 3]);
  });

  const answer = (id: string, weight: number, n: number, stance: string, objection?: string) =>
    cleanTwinAnswer(
      {
        dimensions: dims(n),
        people: [
          { who: "Owner", stance, quote: "Looks useful", wouldAct: true },
          { who: "", stance: "nonsense", quote: "dropped" },
        ],
        likes: ["Clear offer"],
        objections: objection ? [objection] : [],
      },
      { id, name: id, weight },
      6,
    )!;

  it("drops unusable answers and people", () => {
    expect(cleanTwinAnswer(null, { id: "a", name: "a", weight: 1 }, 5)).toBeNull();
    expect(cleanTwinAnswer({ people: [] }, { id: "a", name: "a", weight: 1 }, 5)).toBeNull();
    expect(answer("a", 50, 70, "like").people).toHaveLength(1);
  });

  it("weights groups into one result", () => {
    expect(aggregatePulse([])).toBeNull();
    const out = aggregatePulse([
      answer("fans", 75, 80, "love", "Price is unclear"),
      answer("doubters", 25, 40, "skip", "Price is unclear."),
    ])!;
    // fans: .6*80+.4*100 = 88; doubters: .6*40+.4*28 = 35.2 → 35; weighted 74.75.
    expect(out.overall).toBe(75);
    expect(out.dimensions.fit).toBe(70);
    expect(out.pulse.people).toBe(2);
    expect(out.pulse.sentiment).toEqual({ positive: 50, neutral: 0, negative: 50 });
    expect(out.pulse.objections).toEqual(["Price is unclear"]);
    expect(out.pulse.segments[0].name).toBe("fans");
    expect(segmentSpread(out.pulse.segments)).toBe(53);
  });

  const versions = ["Original", "Problem first", "Story"].map((label, i) => ({
    ref: null,
    label,
    title: "",
    body: `body ${i}`,
    isOriginal: i === 0,
  }));

  const judgement = (scores: number[], picks: number[]) =>
    cleanJudgement(
      {
        versions: scores.map((n, index) => ({
          index,
          dimensions: dims(n),
          picks: picks[index],
          reason: `reason ${index}`,
        })),
      },
      { id: "t", weight: 50 },
      scores.length,
      6,
    )!;

  it("needs every version judged", () => {
    expect(
      cleanJudgement(
        { versions: [{ index: 0, dimensions: dims(50), picks: 1, reason: "" }] },
        { id: "t", weight: 1 },
        2,
        6,
      ),
    ).toBeNull();
  });

  it("ranks versions and names a winner", () => {
    const out = rankVersions(versions, [
      judgement([50, 80, 60], [1, 4, 1]),
      judgement([55, 75, 65], [1, 3, 2]),
    ]);
    expect(out.winnerIndex).toBe(1);
    expect(out.tooClose).toBe(false);
    expect(out.variants[1].rank).toBe(1);
    expect(out.variants[0].rank).toBe(3);
    expect(out.variants[1].picked).toBe(58);
    expect(out.variants[1].why).toBe("reason 1");
  });

  it("says so when the top two are a coin toss", () => {
    const out = rankVersions(versions, [judgement([70, 71, 40], [3, 3, 0])]);
    expect(out.margin).toBeLessThan(TOO_CLOSE_MARGIN);
    expect(out.tooClose).toBe(true);
  });
});

describe("learning from real results", () => {
  it("needs a viewing sample before reactions count", () => {
    expect(engagementRate(readMetrics({ views: 99, likes: 50 }))).toBeNull();
    expect(
      engagementRate(readMetrics({ views: 200, likes: 10, comments: 5, shares: 2, saves: 2 })),
    ).toBeCloseTo(0.16);
    expect(readMetrics({ views: "12", likes: -4 })).toMatchObject({ views: 0, likes: 0 });
  });

  it("places a post among the workspace's own posts", () => {
    expect(percentileAmong(5, [1, 2, 3])).toBeNull();
    expect(percentileAmong(5, [1, 2, 3, 4, 5, 6, 7, 8])).toBe(56);
    expect(percentileAmong(8, [1, 2, 3, 4, 5, 6, 7, 8])).toBe(94);
  });

  it("freezes a result only after the window closed and was read", () => {
    const now = new Date("2026-10-20T00:00:00Z");
    const deliveredAt = "2026-10-01T00:00:00Z";
    expect(outcomeReady({ deliveredAt, metricsSyncedAt: "2026-10-09T00:00:00Z", now })).toBe(true);
    expect(outcomeReady({ deliveredAt, metricsSyncedAt: "2026-10-05T00:00:00Z", now })).toBe(false);
    expect(
      outcomeReady({
        deliveredAt: "2026-10-15T00:00:00Z",
        metricsSyncedAt: "2026-10-19T00:00:00Z",
        now,
      }),
    ).toBe(false);
    expect(outcomeReady({ deliveredAt: null, metricsSyncedAt: null, now })).toBe(false);
  });

  it("corrects scores slowly, never from a handful, never by much", () => {
    const pairs = (n: number, gap: number) =>
      Array.from({ length: n }, () => ({ predicted: 60 + gap, actual: 60 }));
    expect(calibrate([])).toEqual({ n: 0, bias: 0, mae: 0 });
    expect(calibrate(pairs(8, 10))).toEqual({ n: 8, bias: 10, mae: 10 });
    expect(shrunkShift(calibrate(pairs(7, 10)))).toBe(0);
    expect(shrunkShift(calibrate(pairs(8, 10)))).toBe(3);
    expect(shrunkShift({ n: 1000, bias: 40 })).toBe(15);
    expect(shrunkShift({ n: 1000, bias: -40 })).toBe(-15);
    expect(applyCalibration(70, { n: 8, bias: 10 })).toEqual({
      overall: 67,
      calibrated: true,
      measuredPosts: 8,
    });
    expect(applyCalibration(70, { n: 3, bias: 30 })).toEqual({
      overall: 70,
      calibrated: false,
      measuredPosts: 0,
    });
    expect(applyCalibration(70, null).overall).toBe(70);
  });

  it("claims a pattern only with two posts on each side and a clear gap", () => {
    const post = (
      contentType: string,
      engagement: number,
      extra: Partial<MeasuredPost> = {},
    ): MeasuredPost => ({
      title: "t",
      platform: "linkedin",
      contentType,
      engagement,
      ...extra,
    });
    expect(learnedPatterns([post("carousel", 0.2), post("social", 0.05)])).toEqual([]);
    expect(
      learnedPatterns([
        post("carousel", 0.2),
        post("carousel", 0.2),
        post("carousel", 0.2),
        post("social", 0.05),
      ]),
    ).toEqual([]);
    const out = learnedPatterns([
      post("carousel", 0.2, { length: 200, question: true }),
      post("carousel", 0.22, { length: 250, question: true }),
      post("social", 0.05, { length: 900, question: false }),
      post("social", 0.06, { length: 1200, question: false }),
    ]);
    expect(out).toContain("Carousels get more reactions than text posts.");
    expect(out).toContain("Shorter posts get more reactions than long ones.");
    expect(out).toContain("Posts that open with a question get more reactions.");
    // Close results are not a pattern.
    expect(
      learnedPatterns([
        post("carousel", 0.1),
        post("carousel", 0.1),
        post("social", 0.09),
        post("social", 0.09),
      ]),
    ).toEqual([]);
  });
});
