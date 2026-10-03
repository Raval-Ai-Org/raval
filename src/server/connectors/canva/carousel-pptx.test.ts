import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildCarouselPptx } from "./carousel-pptx.server";

describe("editable carousel PPTX", () => {
  it("keeps slide order and text as native PowerPoint elements", async () => {
    const bytes = await buildCarouselPptx(
      [
        { role: "cover", heading: "First heading", body: "First body" },
        { role: "point", heading: "Second heading", body: "Second body" },
        { role: "cta", heading: "Third heading", body: "Third body" },
      ],
      {
        design: { v: 1, look: "editorial", colorway: "light", motif: "blocks" },
        theme: {
          bg: "#ffffff",
          ink: "#111111",
          muted: "#666666",
          accent: "#114488",
          accentInk: "#ffffff",
          surface: "#eeeeee",
          line: "#cccccc",
          headingFont: "Inter",
          bodyFont: "Inter",
        },
        brand: "Mellox",
        ratio: "4:5",
      },
    );
    const zip = await JSZip.loadAsync(bytes);
    const pages = await Promise.all(
      [1, 2, 3].map((n) => zip.file(`ppt/slides/slide${n}.xml`)!.async("string")),
    );
    expect(pages[0]).toContain("First heading");
    expect(pages[1]).toContain("Second heading");
    expect(pages[2]).toContain("Third heading");
    expect(pages.every((page) => page.includes("<a:t>"))).toBe(true);
    expect(zip.file("ppt/slides/slide4.xml")).toBeNull();
  });
});
