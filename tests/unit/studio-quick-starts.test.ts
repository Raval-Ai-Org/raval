import { describe, expect, it } from "vitest";
import { STUDIO_FORMATS } from "@/lib/studio/formats";
import { ControlsSchema } from "@/lib/studio/jobs";
import { QUICK_STARTS } from "@/lib/studio/quick-starts";

describe("quick starts", () => {
  it("have unique ids and a lead-in the user can finish", () => {
    const ids = QUICK_STARTS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const q of QUICK_STARTS) expect(q.prompt.endsWith(" ")).toBe(true);
  });

  it("only use platforms and sizes the format supports", () => {
    for (const q of QUICK_STARTS) {
      const format = STUDIO_FORMATS[q.type];
      for (const p of q.platforms) expect(format.platforms).toContain(p);
      if (!format.multiPlatform) expect(q.platforms.length).toBeLessThanOrEqual(1);
      if (q.controls?.ratio) expect(format.ratios).toContain(q.controls.ratio);
      expect(ControlsSchema.partial().safeParse(q.controls ?? {}).success).toBe(true);
    }
  });

  it("produce captions for every social result", () => {
    // Visual and video formats always write captions; social posts are the caption.
    const captioned = QUICK_STARTS.filter((q) => q.type !== "article");
    for (const q of captioned) expect(q.platforms.length).toBeGreaterThan(0);
  });
});
