import { describe, expect, it } from "vitest";

import {
  creditsFor,
  creditsToUsd,
  customerUsd,
  DEFAULT_PRICING,
  quoteLines,
  roundUsd,
} from "./pricing";

describe("pricing", () => {
  it("applies the margin to the provider price", () => {
    expect(customerUsd(10)).toBe(16);
    expect(customerUsd(12.5)).toBe(20);
  });

  it("rounds money to the cent so equality comparisons are meaningful", () => {
    expect(roundUsd(10.005)).toBe(10.01);
    expect(customerUsd(3.33)).toBe(5.33);
  });

  it("rounds credits up, so a fraction is never absorbed silently", () => {
    // 3.33 * 1.6 = 5.328 -> 5.33 USD -> 533 credits exactly.
    expect(creditsFor(3.33)).toBe(533);
    // 1.01 * 1.6 = 1.616 -> 1.62 -> 162.
    expect(creditsFor(1.01)).toBe(162);
  });

  it("treats a missing or negative provider price as free rather than throwing", () => {
    expect(customerUsd(Number.NaN)).toBe(0);
    expect(customerUsd(-5)).toBe(0);
    expect(creditsFor(-5)).toBe(0);
  });

  it("converts credits back to dollars for display", () => {
    expect(creditsToUsd(1600)).toBe(16);
    expect(creditsToUsd(0)).toBe(0);
  });

  it("quotes a set of lines and keeps the per-line breakdown", () => {
    const quote = quoteLines([
      { donorId: 1, providerUsd: 10 },
      { donorId: 2, providerUsd: 10 },
      { donorId: 3, providerUsd: 25 },
    ]);

    expect(quote.providerUsd).toBe(45);
    expect(quote.credits).toBe(1600 + 1600 + 4000);
    expect(quote.lines).toHaveLength(3);
    expect(quote.lines[2]).toEqual({ donorId: 3, providerUsd: 25, credits: 4000 });
  });

  it("honours a different margin and credit rate", () => {
    const config = { margin: 2, creditsPerUsd: 10 };
    expect(customerUsd(10, config)).toBe(20);
    expect(creditsFor(10, config)).toBe(200);
  });

  it("keeps the default rate a whole number of credits per dollar", () => {
    expect(Number.isInteger(DEFAULT_PRICING.creditsPerUsd)).toBe(true);
    expect(DEFAULT_PRICING.margin).toBeGreaterThanOrEqual(1);
  });

  it("never quotes less than the provider charges", () => {
    for (const price of [1, 5, 10, 33.33, 250]) {
      expect(customerUsd(price)).toBeGreaterThanOrEqual(price);
    }
  });
});
