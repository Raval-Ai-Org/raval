import { describe, expect, it } from "vitest";
import {
  briefAsksForOwnMedia,
  libraryLines,
  mediaFolders,
  mediaForBrief,
  type LibraryItem,
} from "./media-library";

const items: LibraryItem[] = [
  { assetId: "a", kind: "image", folder: "Launch event", label: "Ribbon cutting" },
  { assetId: "b", kind: "image", folder: "Launch event", label: "Crowd at the door" },
  { assetId: "c", kind: "image", folder: "Team", label: "Ayesha in the kitchen" },
  { assetId: "d", kind: "image", folder: null, label: "Summer menu flat lay" },
  { assetId: "e", kind: "image", folder: null, label: null, name: "IMG_2041" },
];

describe("media library", () => {
  it("lists folders by size", () => {
    expect(mediaFolders(items)).toEqual([
      { name: "Launch event", count: 2 },
      { name: "Team", count: 1 },
    ]);
  });

  it("a folder named in the brief brings all its media", () => {
    expect(
      mediaForBrief(items, "A thank-you post with our launch event photos").map((i) => i.assetId),
    ).toEqual(["a", "b"]);
  });

  it("labels match on meaningful words, never on filler", () => {
    expect(mediaForBrief(items, "Our new summer menu is here").map((i) => i.assetId)).toEqual([
      "d",
    ]);
    expect(mediaForBrief(items, "Make a post with our photos")).toEqual([]);
    expect(mediaForBrief(items, "")).toEqual([]);
  });

  it("knows when a brief asks for own media", () => {
    expect(briefAsksForOwnMedia("use the team photos")).toBe(true);
    expect(briefAsksForOwnMedia("a tips carousel about saving money")).toBe(false);
  });

  it("writes one line per folder with its labels", () => {
    expect(libraryLines(items)).toContain(
      "- Launch event (2 items): Ribbon cutting; Crowd at the door",
    );
  });
});
