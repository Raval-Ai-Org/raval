import { describe, expect, it } from "vitest";
import {
  MAX_SITE_STOPS,
  MIN_SITE_STOPS,
  scrollAt,
  scrollExpression,
  siteCaptures,
  siteDevice,
  siteFrame,
  siteStops,
  siteTimeline,
} from "./site-reel";

describe("website reel", () => {
  it("shows a narrow capture in a phone and a wide one in a browser", () => {
    expect(siteDevice(390)).toBe("phone");
    expect(siteDevice(1440)).toBe("browser");
  });

  it("keeps the device and its screen inside the canvas, in even pixels", () => {
    const canvas = { width: 720, height: 900 };
    for (const device of ["phone", "browser"] as const) {
      const { device: d, screen } = siteFrame(canvas, device);
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.y + d.h).toBeLessThanOrEqual(canvas.height);
      expect(d.x + d.w).toBeLessThanOrEqual(canvas.width);
      expect(screen.w % 2).toBe(0);
      expect(screen.h % 2).toBe(0);
      expect(screen.y).toBeGreaterThanOrEqual(d.y);
      expect(screen.y + screen.h).toBeLessThanOrEqual(d.y + d.h);
    }
    const phone = siteFrame(canvas, "phone").screen;
    expect(phone.h / phone.w).toBeGreaterThan(1.8);
  });

  it("stops at the top first and never past the reachable page", () => {
    const stops = siteStops(6000, 700);
    expect(stops[0]).toBe(0);
    expect(stops.length).toBeGreaterThanOrEqual(MIN_SITE_STOPS);
    expect(stops.length).toBeLessThanOrEqual(MAX_SITE_STOPS);
    expect(Math.max(...stops)).toBeLessThanOrEqual(6000 - 700);
    expect([...stops].sort((a, b) => a - b)).toEqual(stops);
    // Only the first few screens of a very long page.
    expect(Math.max(...siteStops(60_000, 700))).toBeLessThanOrEqual(700 * 5);
  });

  it("refuses a page too short to scroll", () => {
    expect(siteStops(800, 700)).toEqual([]);
  });

  it("holds and eases into a 6 to 12 second reel that ends where it starts", () => {
    for (const height of [1800, 3000, 6000, 20_000]) {
      const { segments, total } = siteTimeline(siteStops(height, 700));
      expect(total).toBeGreaterThanOrEqual(6);
      expect(total).toBeLessThanOrEqual(12);
      expect(segments[0].from).toBe(0);
      expect(segments.at(-1)!.to).toBe(0);
      expect(scrollAt(segments, 0)).toBe(0);
      expect(scrollAt(segments, total)).toBe(0);
      segments.slice(1).forEach((s, i) => expect(s.start).toBe(segments[i].end));
    }
  });

  it("eases gently: no jump at the start or end of a move", () => {
    const { segments } = siteTimeline([0, 1000, 2000]);
    const move = segments.find((s) => s.from !== s.to)!;
    expect(scrollAt(segments, move.start + 0.01)).toBeLessThan(5);
    expect(scrollAt(segments, (move.start + move.end) / 2)).toBeCloseTo(500, 0);
  });

  it("gives FFmpeg the same scroll as the planner", () => {
    const { segments, total } = siteTimeline([0, 900, 1800]);
    const expression = scrollExpression(segments);
    const evaluate = (t: number) =>
      Function(
        "t",
        `const lt=(a,b)=>a<b?1:0, clip=(v,a,b)=>Math.min(b,Math.max(a,v)), iff=(c,a,b)=>c?a:b; return ${expression.replace(/\bif\(/g, "iff(")};`,
      )(t) as number;
    for (let t = 0; t <= total; t += 0.25)
      expect(evaluate(t)).toBeCloseTo(scrollAt(segments, t), 3);
  });

  it("lists full-page captures only, one per page and device", () => {
    const base = {
      kind: "website",
      status: "approved",
      label: "/ · Full page",
      created_at: "2026-10-01",
      asset: { mime_type: "image/png", url: "u" },
    };
    const list = siteCaptures([
      { ...base, asset_id: "a", region: { type: "full" } },
      { ...base, asset_id: "b", region: { type: "full" }, created_at: "2026-10-02" },
      { ...base, asset_id: "c", region: { type: "full", mobile: true } },
      { ...base, asset_id: "d", region: { type: "crop" } },
      { ...base, asset_id: "e", region: { type: "full" }, kind: "upload", label: "x" },
      { ...base, asset_id: "f", region: { type: "full" }, status: "removed", label: "y" },
    ]);
    expect(list.map((c) => c.assetId)).toEqual(["b", "c"]);
    expect(list[1].mobile).toBe(true);
  });
});
