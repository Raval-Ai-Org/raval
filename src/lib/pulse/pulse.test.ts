import { describe, expect, it } from "vitest";
import { buildPulse, waitingPlace } from "./pulse";

const base = {
  program: null,
  waiting: [],
  campaigns: [],
  products: [],
  goal: null,
};

describe("buildPulse", () => {
  it("counts a campaign's waiting posts with Autopilot off", () => {
    const pulse = buildPulse({
      ...base,
      waiting: [{ campaign_id: "c1" }, { campaign_id: "c1" }, { campaign_id: null }],
      campaigns: [{ id: "c1", name: "Launch", key_date: null, phase: "Build-up" }],
    });
    // A step left by an Autopilot that is gone waits for nobody.
    expect(pulse.autopilot).toEqual({ status: null, waiting: 0 });
    expect(pulse.campaigns[0].waiting).toBe(2);
    expect(pulse.waiting).toBe(2);
    expect(waitingPlace(pulse)).toEqual({ to: "campaign", id: "c1" });
  });

  it("leaves out pieces of campaigns that aren't running", () => {
    const pulse = buildPulse({ ...base, waiting: [{ campaign_id: "gone" }] });
    expect(pulse.waiting).toBe(0);
    expect(waitingPlace(pulse)).toBeNull();
  });

  it("sends people to Autopilot when it has posts waiting too", () => {
    const pulse = buildPulse({
      ...base,
      program: { status: "running" },
      waiting: [{ campaign_id: null }, { campaign_id: "c1" }],
      campaigns: [{ id: "c1", name: "Launch", key_date: null, phase: null }],
    });
    expect(pulse.waiting).toBe(2);
    expect(pulse.autopilot).toEqual({ status: "running", waiting: 1 });
    expect(waitingPlace(pulse)).toEqual({ to: "autopilot" });
  });

  it("keeps real product names and a known goal only", () => {
    const pulse = buildPulse({
      ...base,
      products: [{ name: " Oat  kit " }, { name: "Oat kit" }, { name: "x" }, { name: "Beans" }],
      goal: { focus: "made-up" },
    });
    expect(pulse.products).toEqual(["Oat kit", "Beans"]);
    expect(pulse.goal).toBeNull();
    expect(buildPulse({ ...base, goal: { focus: "sales" } }).goal).toEqual({
      focus: "sales",
      label: "Sell more",
    });
  });
});
