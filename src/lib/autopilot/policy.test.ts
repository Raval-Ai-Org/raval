import { describe, expect, it } from "vitest";
import { reachableSlots, type CycleSlot } from "./policy";

describe("reachableSlots", () => {
  const slot = (over: Partial<CycleSlot>): CycleSlot => ({
    index: 0,
    date: "2026-11-20",
    time: "09:00",
    platform: "instagram",
    type: "social",
    allowedTypes: ["social"],
    topic: "",
    at: "2026-11-20T09:00:00.000Z",
    ...over,
  });

  it("keeps only channels with an account, articles always", () => {
    const slots = [
      slot({ index: 0, platform: "instagram" }),
      slot({ index: 1, platform: "threads" }),
      slot({ index: 2, platform: null, type: "article", allowedTypes: ["article"] }),
      slot({ index: 3, type: "story", platform: "facebook", platforms: ["facebook", "instagram"] }),
    ];
    const { slots: kept, unreachable } = reachableSlots(slots, ["instagram"]);
    expect(kept.map((s) => s.index)).toEqual([0, 2, 3]);
    expect(kept[2]).toMatchObject({ platform: "instagram", platforms: ["instagram"] });
    expect(unreachable).toBe(1);
  });

  it("keeps every slot when nothing is connected, so readiness can ask", () => {
    const slots = [slot({ platform: "threads" })];
    expect(reachableSlots(slots, []).slots).toEqual(slots);
    expect(reachableSlots(slots, null).slots).toEqual(slots);
  });
});
