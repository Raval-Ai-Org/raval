import { describe, expect, it } from "vitest";
import { hasSavedLook, startHere } from "./start-here";

describe("start here", () => {
  it("counts only what is really there", () => {
    const r = startHere({ brandHealth: 10, products: 0, hasLook: false, hasGoal: false });
    expect(r.done).toBe(0);
    expect(r.next?.id).toBe("brand");
    expect(r.complete).toBe(false);
  });

  it("treats unknown numbers as not done", () => {
    const r = startHere({ brandHealth: null, products: null, hasLook: false, hasGoal: true });
    expect(r.steps.map((s) => s.done)).toEqual([false, false, false, true]);
  });

  it("is complete when every step is done", () => {
    const r = startHere({ brandHealth: 80, products: 2, hasLook: true, hasGoal: true });
    expect(r.complete).toBe(true);
    expect(r.next).toBeNull();
    expect(r.done).toBe(r.total);
  });

  it("knows an empty look from a saved one", () => {
    expect(hasSavedLook(undefined)).toBe(false);
    expect(hasSavedLook({})).toBe(false);
    expect(hasSavedLook({ visual: {} })).toBe(false);
    expect(hasSavedLook({ visual: { mood: "calm" } })).toBe(true);
  });
});
