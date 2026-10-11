import { describe, expect, it } from "vitest";
import {
  DURATION,
  FPS,
  SCENES,
  clamp01,
  count,
  easeOut,
  easeOutBack,
  progress,
  sceneAt,
  totalFrames,
  typed,
} from "./timeline";

describe("promo timeline", () => {
  it("covers the whole film with no gap or overlap", () => {
    expect(SCENES[0].start).toBe(0);
    expect(SCENES[SCENES.length - 1].end).toBe(DURATION);
    for (let i = 1; i < SCENES.length; i++) {
      expect(SCENES[i].start).toBe(SCENES[i - 1].end);
      expect(SCENES[i].end).toBeGreaterThan(SCENES[i].start);
    }
  });

  it("is forty seconds at thirty frames a second", () => {
    expect(DURATION).toBe(40);
    expect(totalFrames()).toBe(40 * FPS);
  });

  it("names each scene once", () => {
    expect(new Set(SCENES.map((scene) => scene.id)).size).toBe(SCENES.length);
  });

  it("finds a scene for every frame, including the last", () => {
    for (let frame = 0; frame <= totalFrames(); frame++) {
      const t = frame / FPS;
      const scene = sceneAt(t);
      expect(t).toBeGreaterThanOrEqual(scene.start);
      expect(t).toBeLessThanOrEqual(scene.end);
    }
    expect(sceneAt(-1).id).toBe("hook");
    expect(sceneAt(99).id).toBe("outro");
  });

  it("clamps progress and easing", () => {
    expect(progress(0, 1, 2)).toBe(0);
    expect(progress(2, 1, 2)).toBe(0.5);
    expect(progress(9, 1, 2)).toBe(1);
    expect(progress(1, 1, 0)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(easeOut(-1)).toBe(0);
    expect(easeOut(2)).toBe(1);
    expect(easeOutBack(0)).toBeCloseTo(0);
    expect(easeOutBack(1)).toBeCloseTo(1);
  });

  it("types and counts", () => {
    expect(typed("mellox", 0)).toBe("");
    expect(typed("mellox", 0.5)).toBe("mel");
    expect(typed("mellox", 2)).toBe("mellox");
    expect(count(62, 94, 0)).toBe(62);
    expect(count(62, 94, 1)).toBe(94);
  });
});
