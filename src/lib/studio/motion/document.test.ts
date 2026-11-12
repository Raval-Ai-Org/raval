import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  drawnIssues,
  MotionDocSchema,
  motionPage,
  parseRgb,
  staticIssues,
  type MeasuredPage,
  type MotionDoc,
} from "./document";
import { beatGrid, pickMotionLayout } from "./principles";

const doc = (over: Partial<MotionDoc> = {}): MotionDoc => ({
  scenes: [
    { start: 0, end: 3, does: "Headline snaps in" },
    { start: 3, end: 8, does: "Logo end card" },
  ],
  copy: ["Coffee that stays hot", "Order today"],
  html: '<h1 class="a">Coffee that stays hot</h1><p class="b">Order today</p><img data-slot="logo">',
  css: ".a{animation:in 0.6s both}@keyframes in{from{opacity:0}to{opacity:1}}",
  ...over,
});

const ctx = {
  seconds: 8,
  knownFacts: "Thermo bottle keeps coffee hot for 12 hours. Order today.",
  slots: { logo: true, photos: 1 },
};

describe("the design document", () => {
  it("cuts a long scene note instead of refusing the design", () => {
    // Opus and Gemini 4 Carbon both wrote 200+ character notes (live, 2026-11-12).
    const parsed = MotionDocSchema.parse(
      doc({ scenes: [{ start: 0, end: 8, does: "x".repeat(400) }] }),
    );
    expect(parsed.scenes[0].does).toHaveLength(200);
    expect(parsed.scenes[0].does.endsWith("…")).toBe(true);
  });
});

describe("static checks", () => {
  it("passes a clean document", () => {
    expect(staticIssues(doc(), ctx)).toEqual([]);
  });

  it("refuses script, handlers, outside addresses and imports", () => {
    const bad = doc({
      html: '<h1 onclick="x()">Hi</h1><script>alert(1)</script><img src="https://e.com/a.png"><svg><use href="https://e.com/s.svg"/></svg>',
      css: "@import url(https://e.com/a.css);.a{background:url(https://e.com/b.png)}@keyframes k{}",
    });
    const issues = staticIssues(bad, ctx).join("\n");
    expect(issues).toContain("<script>");
    expect(issues).toContain("event handler");
    expect(issues).toContain("src or other address");
    expect(issues).toContain("other than #id");
    expect(issues).toContain("@import");
    expect(issues).toContain("url() other than");
  });

  it("allows SVG references to its own ids", () => {
    const svg = doc({
      html: '<svg><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/><use href="#g"/></svg><h1>Order today</h1>',
    });
    expect(staticIssues(svg, ctx)).toEqual([]);
  });

  it("refuses a figure or a claim the brand never made", () => {
    const issues = staticIssues(doc({ copy: ["50% off today", "Clinically proven warmth"] }), ctx);
    expect(issues.some((i) => i.includes("says 50"))).toBe(true);
    expect(issues.some((i) => i.includes('"clinically"'))).toBe(true);
    // A figure the brand gave is fine.
    expect(staticIssues(doc({ copy: ["Hot for 12 hours"] }), ctx)).toEqual([]);
  });

  it("refuses slots that have nothing to fill them, overruns and no motion", () => {
    const issues = staticIssues(
      doc({
        html: '<img data-slot="logo"><img data-slot="photo-2"><h1>Order today</h1>',
        css: ".a{opacity:1}",
        scenes: [{ start: 0, end: 10, does: "all" }],
      }),
      { ...ctx, slots: { logo: false, photos: 1 } },
    ).join("\n");
    expect(issues).toContain("no logo");
    expect(issues).toContain("photo-2 has no photo");
    expect(issues).toContain("Nothing moves");
    expect(issues).toContain("run to 10 s");
  });

  it("keeps to approved copy when the person gave exact words", () => {
    const issues = staticIssues(doc({ copy: ["Order today, friends"] }), {
      ...ctx,
      approvedCopy: ["Order today"],
    });
    expect(issues.join()).toContain("friends");
  });
});

describe("page", () => {
  it("fills slots from code, sets brand variables and a no-script policy", () => {
    const page = motionPage({
      doc: doc(),
      canvas: { width: 1080, height: 1920 },
      palette: { primary: "#c6ff00", text: "red;}body{x" as string },
      fontFaces: "",
      fonts: { heading: 'Inter"}', body: "Inter" },
      slots: { logo: "data:image/png;base64,AAA" },
    });
    expect(page).not.toContain("script-src");
    expect(page).not.toContain("'unsafe-eval'");
    expect(page).toContain("default-src 'none'");
    expect(page).toContain('src="data:image/png;base64,AAA"');
    expect(page).toContain("--brand-primary:#c6ff00");
    expect(page).not.toContain("--brand-text");
    expect(page).toContain('--font-heading:"Inter"');
    expect(page).toContain("width:1080px");
  });
});

describe("drawn checks", () => {
  const base = (texts: MeasuredPage["texts"], over: Partial<MeasuredPage> = {}): MeasuredPage => ({
    canvas: { width: 1080, height: 1920 },
    texts,
    lastMotion: 5,
    contrasts: [],
    ...over,
  });
  const at = (
    text: string,
    t: number,
    box = { x: 200, y: 600, width: 600, height: 120 },
    fontSize = 90,
  ) => ({
    t,
    text,
    box,
    fontSize,
    opacity: 1,
  });

  it("passes when every line shows, inside the safe area, big enough, then holds", () => {
    expect(
      drawnIssues(base([at("Coffee that stays hot", 1), at("Order today", 5)]), doc(), 8),
    ).toEqual([]);
  });

  it("flags words outside the copy, outside the safe area, too small, never shown, never ending", () => {
    const issues = drawnIssues(
      base(
        [
          at("Coffee that stays hot", 1, { x: 10, y: 600, width: 600, height: 100 }),
          at("Buy now cheap", 2),
          at("Order", 3, undefined, 20),
        ],
        { lastMotion: Infinity, contrasts: [{ text: "Order", ratio: 1.4 }] },
      ),
      doc(),
      8,
    ).join("\n");
    expect(issues).toContain("leaves the safe area");
    expect(issues).toContain('"Buy now cheap" is on screen but is not in the copy');
    expect(issues).toContain("too small");
    expect(issues).toContain("never ends");
    expect(issues).toContain("hard to read");
    // "Order today" is half shown ("today" missing) — one word of two is allowed.
    expect(issues).not.toContain('"Order today" never shows');
  });

  it("flags motion running into the end hold", () => {
    const issues = drawnIssues(
      base([at("Coffee that stays hot", 1), at("Order today", 5)], { lastMotion: 7.4 }),
      doc(),
      8,
    );
    expect(issues.join()).toContain("still moves at 7.4 s");
  });
});

describe("colour", () => {
  it("measures contrast like WCAG", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 0);
    expect(parseRgb("rgba(10, 20, 30, 0.5)")).toEqual([10, 20, 30]);
    expect(parseRgb("transparent")).toBeNull();
  });
});

describe("principles", () => {
  it("picks a layout from the brief and avoids the last two", () => {
    expect(
      pickMotionLayout({
        brief: "Summer sale 20% off",
        hasProductPhoto: false,
        hasFigure: true,
        seed: 1,
      }),
    ).toBe("offer-burst");
    expect(
      pickMotionLayout({
        brief: "Summer sale",
        hasProductPhoto: true,
        hasFigure: false,
        recent: ["offer-burst"],
        seed: 1,
      }),
    ).toBe("product-spotlight");
  });

  it("lists beat times up to the end hold", () => {
    expect(beatGrid(4, 0.5)).toBe("0, 1, 2");
  });
});
