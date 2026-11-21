import { describe, expect, it } from "vitest";
import { fitImagePrompt, IMAGE_PROMPT_LIMIT } from "./image-prompt-fit";

const longBody = "Layout and craft rules for the picture. ".repeat(300); // ~12k chars

describe("fitImagePrompt", () => {
  it("keeps a revision note when the body alone is past the limit", () => {
    const note = "Revision: make the background deep green and remove the second cup.";
    const prompt = fitImagePrompt({ body: longBody, must: [note] });
    expect(prompt.length).toBeLessThanOrEqual(IMAGE_PROMPT_LIMIT);
    expect(prompt).toContain(note);
    expect(prompt.indexOf(note)).toBeLessThan(200);
    // The body is trimmed from its end, not dropped.
    expect(prompt).toContain("Layout and craft rules");
  });

  it("returns the body unchanged when there is nothing to keep and it fits", () => {
    expect(fitImagePrompt({ body: "A calm morning scene." })).toBe("A calm morning scene.");
  });

  it("ignores empty notes", () => {
    expect(fitImagePrompt({ body: "Scene.", must: ["", null, undefined, false, "  "] })).toBe(
      "Scene.",
    );
  });

  it("never exceeds the limit, even with huge notes", () => {
    const prompt = fitImagePrompt({ body: longBody, must: [longBody], limit: 500 });
    expect(prompt.length).toBe(500);
  });
});
