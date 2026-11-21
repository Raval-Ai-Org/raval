import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MECHANIC_RULES } from "./formats";
import { fitMemeText, memeBoxRects, memeLineIssues, memeTemplate, shortlistMemes } from "./select";
import { MEME_TEMPLATES } from "./templates.generated";

describe("meme templates", () => {
  it("every template has its picture, boxes inside the frame and a known mechanic", () => {
    for (const t of MEME_TEMPLATES) {
      expect(existsSync(join(process.cwd(), "public", "memes", `${t.id}.jpg`)), t.id).toBe(true);
      expect(t.boxes.length).toBeGreaterThan(0);
      for (const r of memeBoxRects(t, 1000, 1000)) {
        expect(r.x + r.w).toBeLessThanOrEqual(1000);
        expect(r.y + r.h).toBeLessThanOrEqual(1000);
      }
      expect(MECHANIC_RULES[t.mechanic as keyof typeof MECHANIC_RULES], t.id).toBeTruthy();
    }
  });
});

describe("shortlistMemes", () => {
  it("is stable per seed, varied and skips recent templates", () => {
    const a = shortlistMemes({ seed: "Brand:brief" });
    expect(shortlistMemes({ seed: "Brand:brief" }).map((t) => t.id)).toEqual(a.map((t) => t.id));
    expect(a.length).toBe(10);
    const perMechanic = new Map<string, number>();
    for (const t of a) perMechanic.set(t.mechanic, (perMechanic.get(t.mechanic) ?? 0) + 1);
    expect(Math.max(...perMechanic.values())).toBeLessThanOrEqual(2);
    const next = shortlistMemes({ seed: "Brand:brief", recent: [a[0].id] });
    expect(next.some((t) => t.id === a[0].id)).toBe(false);
  });
});

describe("memeLineIssues", () => {
  const drake = memeTemplate("drake")!;
  it("wants one line per box", () => {
    expect(memeLineIssues(drake, ["only one"])).not.toEqual([]);
    expect(
      memeLineIssues(drake, ["writing captions at 2am", "letting the brand voice do it"]),
    ).toEqual([]);
  });
  it("refuses long lines and hashtags", () => {
    expect(memeLineIssues(drake, ["a b c d e f g h i j k l m n", "ok"]).length).toBeGreaterThan(0);
    expect(memeLineIssues(drake, ["#sale now", "ok"]).length).toBeGreaterThan(0);
  });
});

describe("fitting words", () => {
  it("places boxes in pixels and fits words inside", () => {
    const t = memeTemplate("gru")!;
    const rects = memeBoxRects(t, 900, 577);
    expect(rects).toHaveLength(t.boxes.length);
    const fit = fitMemeText("FORGET TO REPLY TO ANY OF THEM", rects[3]);
    expect(fit.lines.length * fit.size * 1.1).toBeLessThanOrEqual(rects[3].h);
    expect(fit.size).toBeGreaterThan(12);
  });
});
