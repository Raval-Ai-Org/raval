import { describe, expect, it } from "vitest";
import {
  AUTO_POOL_SIZE,
  PICTURE_STYLES,
  autoPictureStyles,
  effectiveStyles,
  styleForPiece,
  stylesForPiece,
  type PictureStyleId,
} from "./picture-styles";

describe("picture style rotation", () => {
  it("gives every style real example posts", () => {
    for (const s of PICTURE_STYLES.filter((x) => x.id !== "custom")) {
      expect(s.examples.length).toBeGreaterThan(0);
      for (const e of s.examples) expect(e).toMatch(/^\/Home\/wall\/.+\.webp$/);
    }
  });

  it("lets Mox rotate a pool wider than three", () => {
    const pool = autoPictureStyles({ industry: "Burger restaurant" });
    expect(pool.length).toBe(AUTO_POOL_SIZE);
    expect(new Set(pool).size).toBe(pool.length);
    expect(autoPictureStyles({}).length).toBe(AUTO_POOL_SIZE);
  });

  it("walks the whole pool before a style comes back", () => {
    const pool = autoPictureStyles({ industry: "skincare" });
    const recent: PictureStyleId[] = [];
    for (let i = 0; i < pool.length; i++) {
      const pick = styleForPiece(pool, `job-${i}`, recent)!;
      expect(recent).not.toContain(pick);
      recent.unshift(pick);
    }
    expect(new Set(recent).size).toBe(pool.length);
  });

  it("gives an auto piece one style, and keeps a person's own picks", () => {
    const auto = effectiveStyles(null, { industry: "fintech app" });
    const piece = stylesForPiece(auto, "job-1", [auto.ids[0]]);
    expect(piece?.ids).toHaveLength(1);
    expect(piece?.picked).not.toBe(auto.ids[0]);

    const own = effectiveStyles({ styles: ["3d", "people"] }, {});
    expect(stylesForPiece(own, "job-1", ["3d"])).toEqual({
      ids: ["3d", "people"],
      auto: false,
      picked: null,
    });
    expect(stylesForPiece({ ids: ["custom"], auto: true }, "x")?.ids).toEqual(["custom"]);
  });
});
