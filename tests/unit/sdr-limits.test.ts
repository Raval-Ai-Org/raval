// T010 — authoritative platform limits + pre-publish validation (spec FR-012/FR-027).
// Values mirror the SDR adapters' get_capabilities.
import { describe, it, expect } from "vitest";
import { validateContentForPlatform, PLATFORM_LIMITS } from "@/lib/sdr.server";

describe("validateContentForPlatform", () => {
  it("accepts valid content", () => {
    expect(validateContentForPlatform("twitter", { text: "hello" })).toEqual([]);
  });

  it("rejects over-limit text on X", () => {
    const errs = validateContentForPlatform("twitter", { text: "x".repeat(281) });
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("280");
  });

  it("rejects over-limit media on LinkedIn", () => {
    const errs = validateContentForPlatform("linkedin", { text: "ok", mediaUrls: ["a", "b"] });
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("1");
  });

  it("requires exactly one media on Instagram (FR-020)", () => {
    expect(validateContentForPlatform("instagram", { text: "cap", mediaUrls: [] })[0]).toContain("exactly one");
    expect(validateContentForPlatform("instagram", { text: "cap", mediaUrls: ["a", "b"] }).length).toBeGreaterThan(0);
    expect(validateContentForPlatform("instagram", { text: "cap", mediaUrls: ["a"] })).toEqual([]);
  });

  it("rejects unknown platforms", () => {
    expect(validateContentForPlatform("tiktok", { text: "x" })[0]).toContain("Unsupported");
  });

  it("limits match the SDR adapters' authoritative values (FR-027)", () => {
    expect(PLATFORM_LIMITS.twitter.maxText).toBe(280);
    expect(PLATFORM_LIMITS.twitter.maxMedia).toBe(4);
    expect(PLATFORM_LIMITS.linkedin.maxText).toBe(3000);
    expect(PLATFORM_LIMITS.linkedin.maxMedia).toBe(1);
    expect(PLATFORM_LIMITS.facebook.maxText).toBe(63206);
    expect(PLATFORM_LIMITS.instagram.maxText).toBe(2200);
    expect(PLATFORM_LIMITS.instagram.requiresMedia).toBe(true);
  });
});
