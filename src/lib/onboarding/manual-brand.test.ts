import { describe, expect, it } from "vitest";
import {
  addColor,
  addCompetitor,
  basicsIssue,
  emptyManualBrand,
  kitScore,
  makePrimary,
  manualDnaFields,
  normalizeHex,
  normalizeSiteUrl,
  paletteFromPixels,
  readManualDraft,
  type ManualBrand,
} from "./manual-brand";

const brand: ManualBrand = {
  ...emptyManualBrand,
  brandName: "Northwind Coffee",
  oneLiner: "Small-batch coffee roasted in Leeds",
};

describe("colours", () => {
  it("normalises hex and refuses anything else", () => {
    expect(normalizeHex("abc")).toBe("#AABBCC");
    expect(normalizeHex("#1f3b2d")).toBe("#1F3B2D");
    expect(normalizeHex("red")).toBeNull();
  });

  it("adds once, caps at six, and moves the primary to the front", () => {
    let list: string[] = [];
    for (const c of ["#111", "#111111", "#222", "#333", "#444", "#555", "#666", "#777"])
      list = addColor(list, c);
    expect(list).toHaveLength(6);
    expect(list[0]).toBe("#111111");
    expect(makePrimary(list, "#333333")[0]).toBe("#333333");
  });

  it("reads a logo's own colours, skipping transparent and background pixels", () => {
    const px: number[] = [];
    const put = (r: number, g: number, b: number, a: number, n: number) => {
      for (let i = 0; i < n; i++) px.push(r, g, b, a);
    };
    put(255, 255, 255, 255, 500); // white background
    put(0, 0, 0, 0, 500); // transparent
    put(232, 85, 61, 255, 300); // brand red
    put(234, 87, 60, 255, 50); // the same red, anti-aliased
    put(15, 123, 108, 255, 120); // teal
    const palette = paletteFromPixels(px);
    expect(palette).toHaveLength(2);
    expect(palette[0]).toMatch(/^#E[89]5[56]3[CD]$/);
    expect(palette).not.toContain("#FFFFFF");
  });

  it("keeps black or white when the logo has nothing else", () => {
    const px: number[] = [];
    for (let i = 0; i < 100; i++) px.push(0, 0, 0, 255);
    expect(paletteFromPixels(px)).toEqual(["#000000"]);
  });
});

describe("competitors", () => {
  it("takes a name, a site or both, and refuses repeats", () => {
    let { list } = addCompetitor([], { name: "", url: "rival.com/" });
    expect(list).toEqual([{ name: "rival.com", url: "https://rival.com" }]);
    ({ list } = addCompetitor(list, { name: "Bean Bros", url: "" }));
    expect(list).toHaveLength(2);
    expect(addCompetitor(list, { name: "Other", url: "https://www.rival.com" }).error).toBe(
      "Already on your list.",
    );
    expect(addCompetitor(list, { name: "x", url: "not a site" }).error).toMatch(/web address/);
  });

  it("only accepts web addresses", () => {
    expect(normalizeSiteUrl("javascript:alert(1)")).toBe("");
    expect(normalizeSiteUrl("localhost")).toBe("");
    expect(normalizeSiteUrl("http://shop.example.co.uk/")).toBe("http://shop.example.co.uk");
  });
});

describe("Brand DNA from the kit", () => {
  it("needs only a name and one line", () => {
    expect(basicsIssue(emptyManualBrand)).toMatch(/name/);
    expect(basicsIssue(brand)).toBeNull();
  });

  it("never fills a field the person left empty, and lists it as missing", () => {
    const dna = manualDnaFields(brand);
    expect(dna.audience).toBe("");
    expect(dna.colors).toEqual([]);
    expect(dna.logoUrl).toBeNull();
    expect(dna.missing).toEqual(
      expect.arrayContaining(["audience", "colors", "logo", "competitors"]),
    );
    expect(dna.sources.brandName).toBeTruthy();
    expect(dna.sources.audience).toBeUndefined();
  });

  it("maps colours to roles, tone to a voice line and sells to a business model", () => {
    const dna = manualDnaFields({
      ...brand,
      sells: "both",
      voice: ["friendly", "expert"],
      colors: ["#e8553d", "#F7B32B"],
      competitors: [{ name: "Bean Bros", url: "" }],
    });
    expect(dna.colors).toEqual([
      { name: "Primary", hex: "#E8553D" },
      { name: "Secondary", hex: "#F7B32B" },
    ]);
    expect(dna.voice).toBe("Warm and approachable and knowledgeable and precise.");
    expect(dna.businessModel).toBe("Products and services");
    expect(dna.competitors[0]).toMatchObject({ name: "Bean Bros" });
    expect(dna.missing).not.toContain("colors");
  });

  it("keeps only a small image logo", () => {
    expect(manualDnaFields({ ...brand, logo: "data:image/png;base64,AAAA" }).logoUrl).toBe(
      "data:image/png;base64,AAAA",
    );
    expect(
      manualDnaFields({ ...brand, logo: "data:image/svg+xml;base64,AAAA" }).logoUrl,
    ).toBeNull();
    expect(manualDnaFields({ ...brand, logo: "https://evil.test/x.png" }).logoUrl).toBeNull();
  });

  it("scores how complete the kit is", () => {
    expect(kitScore(emptyManualBrand)).toBe(0);
    expect(kitScore(brand)).toBe(20);
    expect(kitScore(brand, 2)).toBe(30);
  });

  it("restores a stored draft and drops what it can't read", () => {
    expect(readManualDraft(null)).toBeNull();
    expect(readManualDraft({ brandName: "" })).toBeNull();
    const draft = readManualDraft({
      ...brand,
      sells: "nope",
      voice: ["bold", "shouty"],
      colors: ["#fff", 3, "blue"],
      competitors: [{ name: "A" }, "x"],
      logo: "https://x.test/logo.png",
    });
    expect(draft).toMatchObject({
      sells: "products",
      voice: ["bold"],
      colors: ["#FFFFFF"],
      competitors: [{ name: "A", url: "" }],
      logo: null,
    });
  });
});
