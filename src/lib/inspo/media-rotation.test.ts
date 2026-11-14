import { describe, expect, it } from "vitest";
import {
  eligibleMedia,
  lifetimeOf,
  pickRotationMedia,
  remainingUses,
  roll,
  mediaChance,
  type RotationMedia,
} from "./media-rotation";

const now = new Date("2026-11-14T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
const photo = (id: string, over: Partial<RotationMedia> = {}): RotationMedia => ({
  assetId: id,
  kind: "image",
  purpose: "product",
  lifetime: "permanent",
  addedAt: daysAgo(1),
  ...over,
});

/** A seed that rolls under the chance, so the test is about the rules, not luck. */
function seedUnder(chance: number): string {
  for (let i = 0; i < 1000; i++) if (roll(`s${i}`) < chance) return `s${i}`;
  throw new Error("no seed");
}
function seedOver(chance: number): string {
  for (let i = 0; i < 1000; i++) if (roll(`s${i}`) >= chance) return `s${i}`;
  throw new Error("no seed");
}

describe("lifetimeOf", () => {
  it("reads the stored choice, else a campaign photo is temporary", () => {
    expect(lifetimeOf({ region: { lifetime: "temporary" } })).toBe("temporary");
    expect(lifetimeOf({ region: {}, campaign: "Summer" })).toBe("temporary");
    expect(lifetimeOf({ region: {} })).toBe("permanent");
  });
});

describe("eligibleMedia", () => {
  it("rests a permanent photo three days and caps it in a fortnight", () => {
    const m = [photo("a")];
    expect(eligibleMedia(m, [{ assetId: "a", at: daysAgo(1) }], now)).toHaveLength(0);
    expect(eligibleMedia(m, [{ assetId: "a", at: daysAgo(4) }], now)).toHaveLength(1);
    const three = [4, 7, 10].map((d) => ({ assetId: "a", at: daysAgo(d) }));
    expect(eligibleMedia(m, three, now)).toHaveLength(0);
  });

  it("uses a temporary photo twice at most, and only while fresh", () => {
    const t = [photo("t", { lifetime: "temporary" })];
    const twice = [3, 6].map((d) => ({ assetId: "t", at: daysAgo(d) }));
    expect(eligibleMedia(t, twice, now)).toHaveLength(0);
    expect(
      eligibleMedia([photo("t", { lifetime: "temporary", addedAt: daysAgo(40) })], [], now),
    ).toHaveLength(0);
  });
});

describe("pickRotationMedia", () => {
  const base = { uses: [], now, format: "image" };

  it("is only sometimes: a high roll adds nothing", () => {
    const seed = seedOver(mediaChance("sometimes", "image"));
    expect(pickRotationMedia({ ...base, media: [photo("a")], seed })).toBeNull();
  });

  it("never adds own media two pieces in a row", () => {
    const seed = seedUnder(mediaChance("often", "image"));
    expect(
      pickRotationMedia({
        ...base,
        media: [photo("a")],
        seed,
        frequency: "often",
        lastPieceUsedMedia: true,
      }),
    ).toBeNull();
  });

  it("picks the least used photo, product first, and never for ads or stories", () => {
    const seed = seedUnder(mediaChance("sometimes", "carousel"));
    const pick = pickRotationMedia({
      ...base,
      format: "carousel",
      media: [photo("a", { purpose: "person" }), photo("b"), photo("c")],
      uses: [{ assetId: "c", at: daysAgo(5) }],
      seed,
    });
    expect(pick?.assetIds[0]).toBe("b");
    expect(pick?.assetIds).toHaveLength(3);
    expect(mediaChance("often", "ad")).toBe(0);
    expect(pickRotationMedia({ ...base, format: "story", media: [photo("a")], seed })).toBeNull();
  });
});

describe("remainingUses", () => {
  it("gives temporary photos what's left of their two", () => {
    const left = remainingUses(
      [photo("t", { lifetime: "temporary" }), photo("p")],
      [{ assetId: "t", at: daysAgo(5) }],
      now,
    );
    expect(left.get("t")).toBe(1);
    expect(left.get("p")).toBe(3);
  });
});
