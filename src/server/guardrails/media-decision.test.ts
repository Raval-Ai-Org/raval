import { describe, expect, it } from "vitest";
import { combineMediaReads, isPolicyViolation, readMediaDecision } from "./media-decision";

describe("media decision", () => {
  it.each([
    "sexual_content",
    "adult_content",
    "explicit_nudity",
    "nsfw",
    "sexualized_deepfake",
    "child_exploitation",
    "graphic_violence",
    "hate_symbol",
    "self_harm",
    "drug_promotion",
    "firearms",
    "credit_card_visible",
    "personal_data",
    "deceptive_impersonation",
  ])("recognizes %s as a prohibited policy", (category) => {
    expect(isPolicyViolation(category)).toBe(true);
  });

  it.each([
    "real_person",
    "identifiable_person",
    "face",
    "minor_present",
    "child_in_image",
    "brand_logo",
    "trademark",
    "text_overlay",
    "alcohol",
    "swimwear",
    "skincare",
    "low_quality",
    "marketing_content",
    "begun",
  ])("does not treat %s as a prohibited policy", (category) => {
    expect(isPolicyViolation(category)).toBe(false);
  });

  it("reads safe=false without a named policy as ambiguous, never flagged", () => {
    expect(readMediaDecision(false, [])).toEqual({ kind: "ambiguous", categories: [] });
    expect(readMediaDecision(false, ["real_person"]).kind).toBe("ambiguous");
    expect(readMediaDecision(false, ["unable_to_view"])).toEqual({
      kind: "ambiguous",
      categories: ["unable_to_view"],
    });
    expect(readMediaDecision(true, ["nudity"])).toEqual({
      kind: "flagged",
      categories: ["nudity"],
    });
    expect(readMediaDecision(true, ["product_photo"])).toEqual({ kind: "safe" });
  });

  it("needs two named refusals to block and two safe reads to clear", () => {
    const flagged = { kind: "flagged" as const, categories: ["nudity"] };
    const safe = { kind: "safe" as const };
    const ambiguous = { kind: "ambiguous" as const, categories: [] };
    expect(combineMediaReads([flagged, flagged, safe]).verdict).toBe("flagged");
    expect(combineMediaReads([flagged, safe, safe]).verdict).toBe("safe");
    expect(combineMediaReads([ambiguous, safe, safe]).verdict).toBe("safe");
    expect(combineMediaReads([flagged, safe, ambiguous]).verdict).toBe("unverified");
    expect(combineMediaReads([ambiguous, ambiguous, ambiguous]).verdict).toBe("unverified");
    expect(combineMediaReads([flagged, null, null]).verdict).toBe("unverified");
  });
});
