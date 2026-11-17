import { describe, expect, it } from "vitest";
import { briefNamesProduct, readBrief } from "./brief-read";
import { briefFitIssues } from "./brief-fit";

describe("readBrief", () => {
  it("reads a hiring brief as hiring, with its count", () => {
    const read = readBrief("We're hiring 3 senior product designers in Lahore. Apply by Dec 5.");
    expect(read.deliverable).toBe("hiring");
    expect(read.facts).toEqual(expect.arrayContaining(["Dec 5"]));
    expect(read.facts.join(" ")).toContain("3 senior");
    expect(read.keyTerms).toEqual(expect.arrayContaining(["hiring", "designers", "lahore"]));
  });

  it("keeps an offer's figure", () => {
    const read = readBrief("Black Friday sale: 20% off all hoodies this weekend");
    expect(read.deliverable).toBe("promo-offer");
    expect(read.facts).toContain("20% off");
  });

  it("reads an event with a date and time", () => {
    const read = readBrief("Join us for our live workshop on 12 January at 6pm");
    expect(read.deliverable).toBe("event");
    expect(read.facts).toEqual(expect.arrayContaining(["12 January", "6pm"]));
  });

  it("reads a greeting", () => {
    expect(readBrief("Eid Mubarak to all our customers").deliverable).toBe("greeting");
  });

  it("makes a bare product brief a product post", () => {
    const read = readBrief("A post for the Glow Serum Vitamin C", {
      productNames: ["Glow Serum Vitamin C"],
    });
    expect(read.productAsked).toBe(true);
    expect(read.deliverable).toBe("product-hero");
  });

  it("keeps quoted words", () => {
    expect(readBrief('Headline should say "Built for builders"').quoted).toEqual([
      "Built for builders",
    ]);
  });
});

describe("briefNamesProduct", () => {
  it("needs more than one shared word", () => {
    expect(briefNamesProduct("we're hiring a designer", ["Designer Tote"])).toBe(false);
    expect(briefNamesProduct("show the designer tote in black", ["Designer Tote"])).toBe(true);
    expect(briefNamesProduct("new Glow serum drop", ["Glow"])).toBe(true);
  });
});

describe("briefFitIssues", () => {
  const read = readBrief("We're hiring 3 product designers. Apply by Dec 5.");

  it("passes copy on the brief's subject", () => {
    expect(
      briefFitIssues({ read, headline: "Design with us", lines: ["3 designer roles open"] }),
    ).toEqual([]);
  });

  it("flags a product headline on a hiring brief", () => {
    const issues = briefFitIssues({ read, headline: "Glow that lasts all day" });
    expect(issues.join(" ")).toMatch(/drifted/);
  });

  it("flags invented figures", () => {
    const issues = briefFitIssues({ read, headline: "Join 50 designers" });
    expect(issues.join(" ")).toMatch(/50/);
  });

  it("flags a long headline", () => {
    const issues = briefFitIssues({
      read,
      headline: "We are hiring designers who care deeply about every single pixel",
    });
    expect(issues.join(" ")).toMatch(/words/);
  });
});
