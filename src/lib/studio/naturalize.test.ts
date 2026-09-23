import { describe, expect, it } from "vitest";
import {
  aiClicheScore,
  checkPreservation,
  extractProtectedTokens,
  isBetterThanOriginal,
  needsNaturalization,
} from "./naturalize";

describe("aiClicheScore / needsNaturalization", () => {
  it("does not flag a plain, specific caption", () => {
    const text =
      "Our Q3 pricing update goes live Monday. Check the new plans at mellox.ai/pricing.";
    expect(needsNaturalization(text)).toBe(false);
    expect(aiClicheScore(text).score).toBe(0);
  });

  it("flags a caption stacked with generic AI-marketing phrasing", () => {
    const text =
      "In today's fast-paced digital world, unlock your potential and elevate your brand. " +
      "Whether you're a startup or an enterprise, take your marketing to the next level!";
    const report = aiClicheScore(text);
    expect(report.score).toBeGreaterThanOrEqual(2);
    expect(report.hits).toContain("unlock");
    expect(report.hits).toContain("elevate");
    expect(needsNaturalization(text)).toBe(true);
  });

  it("flags emoji-heavy and exclamation-heavy captions as a signal", () => {
    const text = "New drop!! 🔥🔥🔥🚀✨ grab yours now!!!";
    expect(aiClicheScore(text).hits).toEqual(
      expect.arrayContaining(["emoji-heavy", "exclamation-heavy"]),
    );
  });

  it("ignores blank input", () => {
    expect(needsNaturalization("")).toBe(false);
    expect(needsNaturalization("   ")).toBe(false);
  });
});

describe("extractProtectedTokens / checkPreservation", () => {
  it("extracts URLs, mentions, hashtags and numbers", () => {
    const tokens = extractProtectedTokens(
      "Save 20% at https://mellox.ai/sale, tag @mellox_ai #MarketingAI. Only 500 left.",
    );
    expect(tokens).toEqual(
      expect.arrayContaining(["https://mellox.ai/sale", "@mellox_ai", "#MarketingAI", "20", "500"]),
    );
  });

  it("passes when a rewrite keeps every protected token", () => {
    const original = "Save 20% at https://mellox.ai/sale — only 500 left, tag @mellox_ai #sale";
    const rewritten =
      "Grab 20% off at https://mellox.ai/sale while 500 spots remain. @mellox_ai #sale";
    expect(checkPreservation(original, rewritten).ok).toBe(true);
  });

  it("fails when a rewrite drops a URL, number or hashtag", () => {
    const original = "Save 20% at https://mellox.ai/sale, only 500 left. #sale";
    const rewritten = "Big savings happening right now, don't miss out.";
    const check = checkPreservation(original, rewritten);
    expect(check.ok).toBe(false);
    expect(check.missing).toEqual(
      expect.arrayContaining(["https://mellox.ai/sale", "20", "500", "#sale"]),
    );
  });
});

describe("isBetterThanOriginal", () => {
  it("rejects an unchanged or empty rewrite", () => {
    const original = "Unlock your potential today.";
    expect(isBetterThanOriginal(original, original)).toBe(false);
    expect(isBetterThanOriginal(original, "   ")).toBe(false);
  });

  it("rejects a rewrite that didn't reduce the cliché score", () => {
    const original = "Unlock your potential and elevate your brand today.";
    const rewritten = "Elevate your brand and unlock new growth today.";
    expect(isBetterThanOriginal(original, rewritten)).toBe(false);
  });

  it("rejects a rewrite that ballooned in length (padding, not rewriting)", () => {
    const original = "Unlock your potential.";
    const rewritten = "A".repeat(200);
    expect(isBetterThanOriginal(original, rewritten)).toBe(false);
  });

  it("accepts a shorter, cliché-free rewrite", () => {
    const original =
      "Unlock your potential and elevate your brand in today's fast-paced digital world.";
    const rewritten = "Our new dashboard shows exactly where your campaigns are working.";
    expect(isBetterThanOriginal(original, rewritten)).toBe(true);
  });
});
