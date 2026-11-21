import { describe, expect, it } from "vitest";
import {
  MOX_DURATION,
  MOX_FPS,
  MOX_MEDIA,
  MOX_SCENES,
  mediaFrame,
  moxSceneAt,
  moxTotalFrames,
  rand,
} from "./mox-timeline";

describe("Meet Mox timeline", () => {
  it("covers the whole film with no gap or overlap", () => {
    expect(MOX_SCENES[0].start).toBe(0);
    expect(MOX_SCENES[MOX_SCENES.length - 1].end).toBe(MOX_DURATION);
    for (let i = 1; i < MOX_SCENES.length; i++) {
      expect(MOX_SCENES[i].start).toBe(MOX_SCENES[i - 1].end);
      expect(MOX_SCENES[i].end).toBeGreaterThan(MOX_SCENES[i].start);
    }
  });

  it("is 107 seconds, each scene named once", () => {
    expect(moxTotalFrames()).toBe(107 * MOX_FPS);
    expect(new Set(MOX_SCENES.map((scene) => scene.id)).size).toBe(MOX_SCENES.length);
  });

  it("finds a scene for every frame, including the last", () => {
    for (let frame = 0; frame <= moxTotalFrames(); frame++) {
      const t = frame / MOX_FPS;
      const scene = moxSceneAt(t);
      expect(t).toBeGreaterThanOrEqual(scene.start);
      expect(t).toBeLessThanOrEqual(scene.end);
    }
    expect(moxSceneAt(-1).id).toBe("built");
    expect(moxSceneAt(999).id).toBe("finale");
  });

  it("picks footage stills by time, holding or looping at the end", () => {
    expect(mediaFrame("reel-1", 0)).toBe("/promo-mox/reel-1/f0001.jpg");
    expect(mediaFrame("reel-1", 1)).toBe("/promo-mox/reel-1/f0031.jpg");
    const last = `/promo-mox/reel-1/f${String(MOX_MEDIA["reel-1"].frames).padStart(4, "0")}.jpg`;
    expect(mediaFrame("reel-1", 999)).toBe(last);
    expect(mediaFrame("reel-1", MOX_MEDIA["reel-1"].frames / 30, { loop: true })).toBe(
      "/promo-mox/reel-1/f0001.jpg",
    );
    expect(mediaFrame("reel-1", -3)).toBe("/promo-mox/reel-1/f0001.jpg");
  });

  it("keeps layout jitter steady and in range", () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(rand(seed)).toBe(rand(seed));
      expect(rand(seed)).toBeGreaterThanOrEqual(0);
      expect(rand(seed)).toBeLessThan(1);
    }
  });
});
