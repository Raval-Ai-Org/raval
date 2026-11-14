import { describe, expect, it } from "vitest";
import type { CampaignMedia, CampaignPiece } from "./contracts";
import { withInspoMedia } from "./media";

const piece = (i: number, over: Partial<CampaignPiece> = {}): CampaignPiece => ({
  id: `p-${i}`,
  phase: "tease",
  date: `2026-12-${String(i + 1).padStart(2, "0")}`,
  time: "10:00",
  platform: "instagram",
  format: "image",
  aim: "save",
  hook: "question",
  storyTheme: null,
  title: "",
  idea: "",
  visual: "",
  mediaIds: [],
  mediaMode: "none",
  edited: false,
  ...over,
});
const uuid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const media: CampaignMedia[] = [
  { assetId: uuid(1), kind: "image", role: "hero", label: "" },
  { assetId: uuid(2), kind: "image", role: "people", label: "" },
];

describe("withInspoMedia", () => {
  it("places Inspo photos on some pieces only, never two in a row", () => {
    const pieces = Array.from({ length: 9 }, (_, i) => piece(i));
    const out = withInspoMedia(pieces, {
      media,
      remaining: new Map([
        [uuid(1), 3],
        [uuid(2), 3],
      ]),
      every: 3,
    });
    const used = out.map((p) => p.mediaIds.length > 0);
    expect(used.filter(Boolean)).toHaveLength(3);
    for (let i = 1; i < used.length; i++) expect(used[i] && used[i - 1]).toBe(false);
    expect(out.filter((p) => p.mediaIds.length).every((p) => p.mediaMode === "design")).toBe(true);
  });

  it("keeps a temporary photo to what's left of its uses and leaves edited pieces alone", () => {
    const pieces = Array.from({ length: 12 }, (_, i) => piece(i, { edited: i === 1 }));
    const out = withInspoMedia(pieces, {
      media: [media[0]],
      remaining: new Map([[uuid(1), 1]]),
      every: 2,
    });
    expect(out.filter((p) => p.mediaIds.includes(uuid(1)))).toHaveLength(1);
    expect(out[1]).toBe(pieces[1]);
  });

  it("never adds photos to stories, videos or pieces that already have them", () => {
    const pieces = [
      piece(0, { format: "story" }),
      piece(1, { format: "video" }),
      piece(2, { mediaIds: [uuid(3)], mediaMode: "design" }),
    ];
    const out = withInspoMedia(pieces, { media, remaining: new Map([[uuid(1), 3]]), every: 2 });
    expect(out.map((p) => p.mediaIds)).toEqual([[], [], [uuid(3)]]);
  });
});
