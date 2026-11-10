import { describe, expect, it } from "vitest";
import {
  MOTIONMOX_ELEMENTS,
  MOTIONMOX_ELEMENT_IDS,
  elementsFromBrief,
  quotedPhrases,
  readSeconds,
  visibility,
} from "./elements";
import {
  motionMoxLook,
  planMotionMox,
  wantsDesignedOpening,
  type MotionMoxPlanInput,
} from "./plan";
import { groundSpec, specSeconds, type MotionMoxSpec } from "./spec";

const input = (over: Partial<MotionMoxPlanInput> = {}): MotionMoxPlanInput => ({
  canvas: { width: 720, height: 1280 },
  segments: [
    { kind: "video", src: "clip-0.mp4", seconds: 6, sound: true },
    { kind: "video", src: "clip-1.mp4", seconds: 5, sound: true },
    { kind: "image", src: "end.png", seconds: 3, zoom: 1.04 },
  ],
  endCard: true,
  transition: "smoothleft",
  transitionSeconds: 0.5,
  copy: [
    { label: "Headline", text: "Same-day plumbing" },
    { label: "Support line", text: "From Rs 2,500" },
  ],
  endCopy: [{ label: "Headline", text: "Acme Plumbing" }],
  brief: "Add our logo, captions, a price tag and end with 'Book now'",
  brandName: "Acme Plumbing",
  asked: [],
  overlay: "overlay.png",
  overlaySeconds: 4,
  captions: [],
  logo: "logo.png",
  colours: ["#0B3D2E", "#F4C430", "#ffffff"],
  font: "Inter",
  ...over,
});

describe("elements", () => {
  it("ids are unique and every id has an element", () => {
    expect(new Set(MOTIONMOX_ELEMENT_IDS).size).toBe(MOTIONMOX_ELEMENT_IDS.length);
    for (const id of MOTIONMOX_ELEMENT_IDS) expect(MOTIONMOX_ELEMENTS[id].id).toBe(id);
  });

  it("reads what the person asked for", () => {
    expect(elementsFromBrief("add our logo and captions")).toEqual(["captions", "logo-bug"]);
    expect(elementsFromBrief("Put the price Rs 999 and a Shop now button")).toEqual([
      "price-tag",
      "cta",
    ]);
    expect(elementsFromBrief("a calm video of our cafe")).toEqual([]);
  });

  it("keeps quoted phrases as the person wrote them", () => {
    expect(quotedPhrases(`end with "Shop now" and 'Free delivery'`)).toEqual([
      "Shop now",
      "Free delivery",
    ]);
  });

  it("gives words time to be read", () => {
    expect(readSeconds(1)).toBeGreaterThanOrEqual(1.6);
    expect(readSeconds(9)).toBeGreaterThan(readSeconds(3));
  });

  it("fades in and out on the element's own timing", () => {
    const el = MOTIONMOX_ELEMENTS.headline;
    expect(visibility(0, { from: 1, to: 4 }, el)).toBe(0);
    expect(visibility(1 + el.enter / 2, { from: 1, to: 4 }, el)).toBeCloseTo(0.5);
    expect(visibility(2.5, { from: 1, to: 4 }, el)).toBe(1);
    expect(visibility(4.1, { from: 1, to: 4 }, el)).toBe(0);
  });
});

describe("planMotionMox", () => {
  it("the usual video keeps the designed opening, the logo and the end card", () => {
    const { spec } = planMotionMox(input({ brief: "a launch video", asked: [] }));
    expect(spec.overlay?.src).toBe("overlay.png");
    expect(spec.texts).toEqual([]);
    expect(spec.logo?.src).toBe("logo.png");
    expect(spec.transition).toBe("slide-left");
  });

  it("adds what was asked, only with words it was given", () => {
    const { spec, notes } = planMotionMox(input({ asked: ["headline", "price-tag", "cta"] }));
    const byElement = Object.fromEntries(spec.texts.map((t) => [t.element, t.text]));
    expect(byElement.headline).toBe("Same-day plumbing");
    expect(byElement["price-tag"]).toBe("From Rs 2,500");
    expect(byElement.cta).toBe("Book now");
    expect(spec.overlay).toBeNull();
    expect(notes).toEqual([]);
  });

  it("says so instead of inventing a price", () => {
    const { spec, notes } = planMotionMox(
      input({
        asked: ["price-tag"],
        copy: [{ label: "Headline", text: "Fresh coffee" }],
        brief: "add a price",
      }),
    );
    expect(spec.texts.some((t) => t.element === "price-tag")).toBe(false);
    expect(notes[0]).toMatch(/No price/);
  });

  it("keeps words off the end card", () => {
    const { spec } = planMotionMox(input({ asked: ["headline", "cta"] }));
    const endStart = specSeconds(spec) - 3;
    for (const t of spec.texts) expect(t.to).toBeLessThanOrEqual(endStart + 1e-6);
  });

  it("only needs the image model's opening when MotionMox isn't drawing the headline", () => {
    expect(wantsDesignedOpening([])).toBe(true);
    expect(wantsDesignedOpening(["headline", "cta"])).toBe(false);
  });

  it("picks readable colours from the brand", () => {
    const look = motionMoxLook(["#0B3D2E", "#F4C430", "#fff"], null);
    expect(look.accent).toBe("#f4c430");
    expect(look.ink).toBe("#0b3d2e");
    expect(look.paper).toBe("#ffffff");
    expect(motionMoxLook([], null).accent).toMatch(/^#/);
  });
});

describe("groundSpec", () => {
  const planned = () => planMotionMox(input({ asked: ["headline", "price-tag", "cta"] }));

  it("passes a planned spec untouched", () => {
    const { spec, allowedText } = planned();
    const grounded = groundSpec(spec, allowedText);
    expect(grounded.dropped).toEqual([]);
    expect(grounded.spec.texts).toHaveLength(spec.texts.length);
  });

  it("drops words that aren't in the approved copy", () => {
    const { spec, allowedText } = planned();
    const bad: MotionMoxSpec = {
      ...spec,
      texts: [...spec.texts, { element: "badge", text: "50% off today", from: 1, to: 4 }],
    };
    const grounded = groundSpec(bad, allowedText);
    expect(grounded.spec.texts.some((t) => t.text === "50% off today")).toBe(false);
    expect(grounded.dropped[0]).toMatch(/not in the approved copy/);
  });

  it("clamps times and transitions to the video", () => {
    const { spec, allowedText } = planned();
    const wild = {
      ...spec,
      transitionSeconds: 1.2,
      texts: [{ element: "headline" as const, text: "Same-day plumbing", from: 0, to: 59 }],
    };
    const grounded = groundSpec(wild, allowedText).spec;
    expect(grounded.transitionSeconds).toBe(1);
    expect(grounded.texts[0].to).toBe(specSeconds(grounded));
  });

  it("refuses a file outside the render folder", () => {
    const { spec, allowedText } = planned();
    const escape = { ...spec, segments: [{ kind: "video", src: "../secret.mp4", seconds: 3 }] };
    expect(() => groundSpec(escape, allowedText)).toThrow();
    const remote = { ...spec, logo: { src: "https://example.com/logo.png", from: 0 } };
    expect(() => groundSpec(remote, allowedText)).toThrow();
  });
});
