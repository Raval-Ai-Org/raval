import { describe, expect, it } from "vitest";
import { assuranceOf, isFreshMfa } from "./assurance";

describe("assuranceOf", () => {
  it("is not strong without a second factor", () => {
    expect(assuranceOf({ aal: "aal1", amr: [{ method: "password", timestamp: 1 }] })).toEqual({
      mfa: false,
      mfaAt: null,
    });
    expect(assuranceOf(null)).toEqual({ mfa: false, mfaAt: null });
  });

  it("reads the latest TOTP time", () => {
    const result = assuranceOf({
      aal: "aal2",
      amr: [
        { method: "totp", timestamp: 100 },
        { method: "password", timestamp: 50 },
        { method: "totp", timestamp: 300 },
        "junk",
        { method: "totp", timestamp: "x" },
      ],
    });
    expect(result).toEqual({ mfa: true, mfaAt: 300 });
  });
});

describe("isFreshMfa", () => {
  const strong = { mfa: true, mfaAt: 1000 };
  it("accepts a recent check and refuses an old one", () => {
    expect(isFreshMfa(strong, 1000 + 60)).toBe(true);
    expect(isFreshMfa(strong, 1000 + 601)).toBe(false);
  });
  it("refuses without a second factor or a time", () => {
    expect(isFreshMfa({ mfa: false, mfaAt: 1000 }, 1001)).toBe(false);
    expect(isFreshMfa({ mfa: true, mfaAt: null }, 1001)).toBe(false);
  });
  it("refuses a timestamp far in the future", () => {
    expect(isFreshMfa(strong, 500)).toBe(false);
  });
});
