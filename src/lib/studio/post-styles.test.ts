import { describe, expect, it } from "vitest";
import {
  POST_STYLES,
  pickCarouselStyle,
  pickPostStyles,
  pickSurpriseIdea,
  postStyleById,
} from "./post-styles";

const ids = (list: { id: string }[]) => list.map((s) => s.id);

describe("pickPostStyles", () => {
  it("offers a hiring post an announcement or a behind-the-scenes photo, never a product", () => {
    const styles = ids(pickPostStyles({ deliverable: "hiring", platform: "linkedin", seed: "a" }));
    expect(styles[0]).toMatch(/announcement-card|candid-team/);
    expect(styles).not.toContain("product-spotlight");
    expect(styles).not.toContain("offer-post");
  });

  it("puts a named physical product in a product spotlight", () => {
    const styles = ids(
      pickPostStyles({
        deliverable: "product-hero",
        platform: "instagram",
        physicalProduct: true,
        productAsked: true,
        seed: "b",
      }),
    );
    expect(styles).toContain("product-spotlight");
  });

  it("never offers a product style without a product", () => {
    for (const deliverable of ["brand-moment", "tips", "event"] as const)
      expect(ids(pickPostStyles({ deliverable, physicalProduct: false, seed: "c" }))).not.toContain(
        "product-spotlight",
      );
  });

  it("offers an offer post only for an offer with a figure", () => {
    expect(
      ids(pickPostStyles({ deliverable: "promo-offer", hasFacts: true, seed: "d" })),
    ).toContain("offer-post");
    expect(
      ids(pickPostStyles({ deliverable: "promo-offer", hasFacts: false, seed: "d" })),
    ).not.toContain("offer-post");
  });

  it("keeps a greeting a greeting", () => {
    expect(pickPostStyles({ deliverable: "greeting", seed: "e" })[0].id).toBe("greeting-card");
  });

  it("moves away from the style used last", () => {
    const first = pickPostStyles({ deliverable: "tips", platform: "instagram", seed: "f" })[0].id;
    const next = pickPostStyles({
      deliverable: "tips",
      platform: "instagram",
      seed: "f",
      recent: [first],
    })[0].id;
    expect(next).not.toBe(first);
  });

  it("offers at most three, all real ids", () => {
    const styles = pickPostStyles({ deliverable: "brand-moment", seed: "g" });
    expect(styles.length).toBeLessThanOrEqual(3);
    for (const s of styles) expect(postStyleById(s.id)).toBe(s);
  });

  it("never stages a post on a stunt", () => {
    const all = POST_STYLES.map((s) => `${s.picture} ${s.words}`)
      .join(" ")
      .toLowerCase();
    expect(all).not.toMatch(/diorama|portal|monument|kaleidoscope|giant/);
  });
});

describe("pickCarouselStyle", () => {
  it("makes a how-to a step-by-step", () => {
    expect(
      pickCarouselStyle({ deliverable: "tips", brief: "How to brew pour-over at home" }).id,
    ).toBe("step-by-step");
  });

  it("tours a named product", () => {
    expect(
      pickCarouselStyle({
        deliverable: "product-hero",
        physicalProduct: true,
        productAsked: true,
      }).id,
    ).toBe("product-tour");
  });

  it("tells a behind-the-scenes story in photos on Instagram", () => {
    expect(
      pickCarouselStyle({
        deliverable: "brand-moment",
        platform: "instagram",
        brief: "Behind the scenes at our roastery",
      }).id,
    ).toMatch(/photo-story|editorial-text/);
  });
});

describe("pickSurpriseIdea", () => {
  it("never picks an offer the brand doesn't have, or an occasion that isn't close", () => {
    for (let i = 0; i < 40; i++) {
      const idea = pickSurpriseIdea({ seed: `s${i}` });
      expect(["offer", "occasion"]).not.toContain(idea.id);
    }
  });
});
