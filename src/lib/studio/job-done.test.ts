import { describe, expect, it } from "vitest";
import { afterComesFirst, asksBeforeAfter, jobDoneLayout, jobDonePanels } from "./job-done";

describe("job done (Round 9, flag jobdone)", () => {
  it("hears a before and after in the brief", () => {
    expect(asksBeforeAfter("Before and after of the kitchen we tiled")).toBe(true);
    expect(asksBeforeAfter("before/after: driveway clean")).toBe(true);
    expect(asksBeforeAfter("How it looked before we started, and after")).toBe(true);
    expect(asksBeforeAfter("Garden transformation this week")).toBe(true);
    expect(asksBeforeAfter("A post about our new opening hours")).toBe(false);
  });

  it("keeps the photo order unless the brief says the first is the after", () => {
    expect(afterComesFirst("before and after, first photo is the after")).toBe(true);
    expect(afterComesFirst("before and after, the second one is before")).toBe(true);
    expect(afterComesFirst("before and after of the bathroom")).toBe(false);
  });

  it("stacks tall posts and sets square and wide ones side by side", () => {
    expect(jobDoneLayout("4:5").split).toBe("stack");
    expect(jobDoneLayout("9:16").split).toBe("stack");
    expect(jobDoneLayout("1:1").split).toBe("side");
    expect(jobDoneLayout("16:9").split).toBe("side");
  });

  it("fills the canvas with two panels and a thin divider", () => {
    for (const ratio of ["1:1", "4:5", "9:16", "16:9"]) {
      const layout = jobDoneLayout(ratio);
      const [a, b] = jobDonePanels(layout);
      if (layout.split === "side") {
        expect(a.left + a.width).toBeLessThan(b.left);
        expect(b.left + b.width).toBe(layout.width);
      } else {
        expect(a.top + a.height).toBeLessThan(b.top);
        expect(b.top + b.height).toBe(layout.height);
      }
    }
  });
});
