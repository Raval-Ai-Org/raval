import { describe, expect, it } from "vitest";
import { CONTENT_LANGUAGES, contentLanguageOf, searchLanguages, withLanguage } from "./languages";

describe("content languages", () => {
  it("has unique codes and labels that fit the look's 40 characters", () => {
    const codes = new Set(CONTENT_LANGUAGES.map((l) => l.code));
    expect(codes.size).toBe(CONTENT_LANGUAGES.length);
    for (const l of CONTENT_LANGUAGES) expect(l.label.length).toBeLessThanOrEqual(40);
  });

  it("reads English when nothing was chosen", () => {
    expect(contentLanguageOf(undefined)).toBe("English");
    expect(contentLanguageOf({ writing: { language: "  " } })).toBe("English");
    expect(contentLanguageOf({ writing: { language: "Urdu" } })).toBe("Urdu");
  });

  it("finds a language by either name", () => {
    expect(searchLanguages("espa").map((l) => l.label)).toEqual(["Spanish"]);
    expect(searchLanguages("german").map((l) => l.code)).toEqual(["de"]);
    expect(searchLanguages("")).toHaveLength(CONTENT_LANGUAGES.length);
  });

  it("keeps the rest of the look", () => {
    const look = { writing: { tone: "warm" }, visual: { mood: "calm" } };
    expect(withLanguage(look, "French")).toEqual({
      writing: { tone: "warm", language: "French" },
      visual: { mood: "calm" },
    });
  });
});
