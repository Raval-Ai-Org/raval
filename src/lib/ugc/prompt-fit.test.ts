import { describe, expect, it } from "vitest";
import { fitVideoPrompt } from "./prompt-fit";

const prompt = [
  "Vertical phone video.",
  "CREATOR: a woman in her late twenties.",
  "CAMERA & LOOK: handheld, natural light.",
  "BRAND VOICE: warm and plain.",
  "BEAT SHEET:",
  '0-4s: she says "Okay, this is my new summer thing."',
  "CREATIVE NOTES: " + "keep it light. ".repeat(20),
  "DO NOT INCLUDE: on-screen text, music.",
  "MODEL DIRECTION: real phone footage.",
].join("\n");

describe("fitVideoPrompt", () => {
  it("leaves a prompt that fits alone", () => {
    expect(fitVideoPrompt(prompt, 10_000)).toBe(prompt);
  });

  it("drops creative notes first and keeps the rules at the end", () => {
    const fitted = fitVideoPrompt(prompt, prompt.length - 100);
    expect(fitted).not.toContain("CREATIVE NOTES");
    expect(fitted).toContain("BRAND VOICE");
    expect(fitted).toContain("DO NOT INCLUDE: on-screen text, music.");
    expect(fitted).toContain("MODEL DIRECTION");
    expect(fitted).toContain('she says "Okay, this is my new summer thing."');
  });

  it("drops brand voice and camera next, then cuts the end only as a last resort", () => {
    const fitted = fitVideoPrompt(prompt, 170);
    expect(fitted).not.toContain("BRAND VOICE");
    expect(fitted).not.toContain("CAMERA & LOOK");
    expect(fitted.length).toBeLessThanOrEqual(170);
    expect(fitted.startsWith("Vertical phone video.")).toBe(true);
  });
});
