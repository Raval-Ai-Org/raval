import { describe, expect, it } from "vitest";
import { FEATURES, PLANS, planAllows, type FeatureKey } from "./catalog";
import { applyTrialTier, normalizePromoCode, promoLine, TRIAL_FEATURES } from "./promo";

const growthFeatures = () =>
  Object.fromEntries(
    Object.keys(FEATURES).map((key) => [
      key,
      { allowed: planAllows("growth", key as FeatureKey), requiredPlan: "starter" },
    ]),
  );

describe("promo codes", () => {
  it("normalises case and spaces, refuses junk", () => {
    expect(normalizePromoCode(" mox3-zd6s9m ")).toBe("MOX3-ZD6S9M");
    expect(normalizePromoCode("ab")).toBeNull();
    expect(normalizePromoCode("DROP TABLE;")).toBeNull();
    expect(normalizePromoCode(42)).toBeNull();
  });

  it("says what a code gives", () => {
    expect(promoLine({ days: 1, credits: 10 })).toBe("1 day free, 10 credits");
    expect(promoLine({ days: 3, credits: 25 })).toBe("3 days free, 25 credits");
  });
});

describe("applyTrialTier", () => {
  const limits = {
    ...PLANS.growth.limits,
    engines: [...PLANS.growth.limits.engines],
    brands: PLANS.growth.brands,
    seats: PLANS.growth.seats,
  };

  it("keeps only the trial features and never turns one on", () => {
    const features = growthFeatures();
    features.studio.allowed = false;
    const out = applyTrialTier(features, limits);
    for (const [key, grant] of Object.entries(out.features)) {
      if (key === "studio") expect(grant.allowed).toBe(false);
      else
        expect(grant.allowed).toBe(
          TRIAL_FEATURES.includes(key as FeatureKey) && features[key].allowed,
        );
    }
    expect(out.features.ugc.allowed).toBe(false);
    expect(out.features.video_premium.allowed).toBe(false);
    expect(out.features.autopilot.allowed).toBe(false);
  });

  it("lowers limits to one brand, one seat and no tracking", () => {
    const out = applyTrialTier(growthFeatures(), limits);
    expect(out.limits.brands).toBe(1);
    expect(out.limits.seats).toBe(1);
    expect(out.limits.competitors).toBe(0);
    expect(out.limits.maxConcurrentRenders).toBe(0);
    expect(out.limits.engines).toEqual([]);
  });
});
