import { describe, expect, it } from "vitest";
import { AIM_STAGE, pillarSequence } from "./shape";
import { stageLine } from "./brief";

describe("pillar shares", () => {
  it("follows the strategy's mix", () => {
    const seq = pillarSequence(
      [
        { title: "Teach", share: 50 },
        { title: "Proof", share: 30 },
        { title: "Offer", share: 20 },
      ],
      10,
    );
    const count = (t: string) => seq.filter((x) => x === t).length;
    expect([count("Teach"), count("Proof"), count("Offer")]).toEqual([5, 3, 2]);
    expect(seq.some((x, i) => i > 0 && x === seq[i - 1] && x !== "Teach")).toBe(false);
  });

  it("takes equal turns without shares and continues across weeks", () => {
    expect(pillarSequence(["A", "B"], 4)).toEqual(["A", "B", "A", "B"]);
    expect(pillarSequence(["A", "B"], 2, 1)).toEqual(["B", "A"]);
    expect(pillarSequence([], 3)).toEqual([]);
  });
});

describe("funnel stage", () => {
  it("maps every aim to a stage and writes the stage's job", () => {
    expect(AIM_STAGE.act).toBe("convert");
    expect(AIM_STAGE.relate).toBe("attract");
    expect(stageLine("convince", "We answer on Sundays")).toMatch(/trust.*Sundays/);
    expect(stageLine("nope", "x")).toBeNull();
  });
});

import { actionRate, summarizeLearnings } from "./learn";
describe("learnings from saves and sends", () => {
  it("leaves out what the network never reported", () => {
    expect(actionRate({ title: "a", platform: null, contentType: null, views: 100 })).toBeNull();
    expect(
      actionRate({
        title: "a",
        platform: null,
        contentType: null,
        views: 1000,
        saves: 5,
        shares: 5,
      }),
    ).toBe(15);
  });
  it("names the aim people act on, from two posts per group", () => {
    const p = (aim: string, saves: number) => ({
      title: aim,
      platform: "instagram",
      contentType: "image",
      views: 1000,
      saves,
      shares: 0,
      comments: 0,
      aim,
    });
    const out = summarizeLearnings([p("save", 40), p("save", 30), p("relate", 2), p("relate", 3)]);
    expect(out.some((l) => l.startsWith("Measured: posts made to be saved"))).toBe(true);
  });
});
