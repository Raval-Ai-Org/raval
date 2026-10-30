import { describe, expect, it } from "vitest";
import { ARCHETYPE_IDS } from "../art-direction";
import { conceptMessages, groundConcept, nearRepeat, quotedHeadline, sameOpening } from "./concept";
import { benefitLines, ingredientsOf, supportLine, textureOf } from "./copy";
import { cleanAlpha, judgeCutout, paddedBox } from "./cutout";
import { dominantColour, hexToHsl, productPalette } from "./palette";
import { planProductHero } from "./plan";
import { cutoutPrompt, heroCopyLines, HERO_NEVER, productHeroPrompt } from "./prompt";
import {
  CROP_SAFE,
  pickStaging,
  recentStagings,
  stagingById,
  STAGINGS,
  STAGING_IDS,
} from "./stagings";
import { occasionOf, readHeroLook, rotateBenefits, SETS } from "./variety";

// Brands seen in studied reference posts: never named in what reaches a prompt.
const BRANDS = ["Blume", "Meltdown", "Blume Buds", "Superbalm", "Milky Fade", "Buzz", "KIKO"];

const product = {
  name: "Gel Cleanser",
  category: "Skincare",
  description: "A gentle gel cleanser for acne-prone skin. Made with green tea and aloe.",
  benefits: [
    "Gently cleanses without stripping skin",
    "Removes excess oil, dirt, and buildup",
    "Helps unclog pores and prevent breakouts over the following weeks of daily use",
    "Calms irritation and reduces redness",
  ],
};

describe("stagings", () => {
  it("has unique ids that never clash with the art-direction layouts", () => {
    expect(new Set(STAGING_IDS).size).toBe(STAGINGS.length);
    for (const id of STAGING_IDS) expect(ARCHETYPE_IDS as readonly string[]).not.toContain(id);
    for (const s of STAGINGS) {
      expect(s.scene("the product", "gel").length).toBeGreaterThan(60);
      expect(
        s.placement && s.type && s.typeWithoutText && s.light && s.finish && s.avoid,
      ).toBeTruthy();
    }
  });

  it("only picks a staging the piece can fill", () => {
    for (let i = 0; i < 40; i++) {
      const s = pickStaging({
        seed: `s${i}`,
        brief: "",
        texture: null,
        benefits: 0,
        hasText: false,
      });
      expect(
        s.needs.texture || s.needs.benefits || s.needs.text || s.needs.ingredients,
      ).toBeFalsy();
    }
  });

  it("follows what the brief asks for", () => {
    const s = pickStaging({
      seed: "x",
      brief: "Show the benefits of our cleanser",
      texture: "gel",
      benefits: 4,
      hasText: true,
    });
    expect(s.id).toBe("benefit-column");
  });

  it("stays off the latest two stagings", () => {
    for (let i = 0; i < 30; i++) {
      const s = pickStaging({
        seed: `r${i}`,
        brief: "",
        texture: "gel",
        benefits: 4,
        hasText: true,
        recent: ["glow-sweep", "texture-burst"],
      });
      expect(["glow-sweep", "texture-burst"]).not.toContain(s.id);
    }
  });

  it("never uses a staging the team asked for less of when another fits", () => {
    for (let i = 0; i < 30; i++) {
      const s = pickStaging({
        seed: `l${i}`,
        brief: "",
        texture: null,
        benefits: 0,
        hasText: false,
        lean: { liked: [], avoided: ["glow-sweep", "wet-glass"] },
      });
      expect(["glow-sweep", "wet-glass"]).not.toContain(s.id);
    }
  });

  it("reads the latest stagings from stored posts", () => {
    expect(
      recentStagings([
        { artDirection: "macro-crop" },
        { artDirection: "hero-world" },
        { artDirection: "macro-crop" },
        { artDirection: "wet-glass" },
      ]),
    ).toEqual(["macro-crop", "wet-glass"]);
    expect(stagingById("nope")).toBeNull();
  });
});

describe("copy from stored facts", () => {
  it("keeps short benefits whole, cuts long ones to a clause and drops the rest", () => {
    expect(benefitLines(product.benefits)).toEqual([
      "Gently cleanses without stripping skin",
      "Removes excess oil, dirt, and buildup",
      "Calms irritation and reduces redness",
    ]);
    expect(
      benefitLines(["Deeply hydrates for up to 72 hours, even in dry winter air and heating"]),
    ).toEqual(["Deeply hydrates for up to 72 hours"]);
  });

  it("finds the product's own formula, name first", () => {
    expect(textureOf(product)).toBe("gel");
    expect(textureOf({ name: "Night Cream", description: "with oil" })).toBe("cream");
    expect(textureOf({ name: "Running shoe", description: "Light and fast" })).toBeNull();
  });

  it("keeps a short first sentence only", () => {
    expect(supportLine(product.description)).toBe("A gentle gel cleanser for acne-prone skin.");
    expect(supportLine("word ".repeat(40))).toBeNull();
  });

  it("plans the staging and words without inventing any", () => {
    const plan = planProductHero({
      seed: "p",
      brief: "why it works",
      product,
      headline: "Clear skin starts gentle",
    });
    expect(plan.staging.id).toBe("benefit-column");
    expect(plan.copy.benefits).toHaveLength(3);
    const noWords = planProductHero({ seed: "p", brief: "", product, noWords: true });
    expect(noWords.allowText).toBe(false);
    expect(noWords.staging.id).not.toBe("benefit-column");
  });
});

describe("palette", () => {
  const pixels = (rgb: [number, number, number], n: number, alpha = 255) => {
    const out = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) out.set([...rgb, alpha], i * 4);
    return out;
  };

  it("takes the pack's own colour and builds a tone-on-tone set", () => {
    const blue = dominantColour(pixels([120, 175, 225], 500))!;
    expect(hexToHsl(blue)!.h).toBeGreaterThan(195);
    expect(hexToHsl(blue)!.h).toBeLessThan(225);
    const p = productPalette({ product: blue });
    expect(Math.abs(hexToHsl(p.background)!.h - hexToHsl(blue)!.h)).toBeLessThan(8);
    expect(hexToHsl(p.background)!.l).toBeGreaterThan(0.8);
    expect(hexToHsl(p.text)!.l).toBeLessThan(0.3);
  });

  it("ignores transparent and colourless pixels", () => {
    expect(dominantColour(pixels([250, 250, 250], 500))).toBeNull();
    expect(dominantColour(pixels([200, 30, 30], 500, 0))).toBeNull();
  });

  it("keeps the brand accent when it stands apart, and falls back to the brand colour", () => {
    expect(productPalette({ product: "#78afe1", brandColours: ["#e0645c"] }).accent).toBe(
      "#e0645c",
    );
    const brandWorld = productPalette({ product: null, brandColours: ["#2e8b57"] });
    expect(hexToHsl(brandWorld.background)!.h).toBeGreaterThan(140);
  });
});

describe("cut-out checks", () => {
  const alpha = (w: number, h: number, fill: (x: number, y: number) => number) => {
    const a = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = fill(x, y);
    return a;
  };

  it("accepts a product on transparency and finds its box", () => {
    const v = judgeCutout(
      alpha(100, 100, (x, y) => (x >= 30 && x < 70 && y >= 10 && y < 90 ? 255 : 0)),
      100,
      100,
    );
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.box).toEqual({ left: 30, top: 10, width: 40, height: 80 });
      expect(v.cropped).toBe(false);
    }
  });

  it("knows a product that runs off the photo's edge", () => {
    const v = judgeCutout(
      alpha(100, 100, (x, y) => (x < 50 && y > 20 && y < 80 ? 255 : 0)),
      100,
      100,
    );
    expect(v.ok && v.cropped).toBe(true);
  });

  it("removes a model's glow and keeps a soft edge", () => {
    expect([...cleanAlpha(Uint8Array.from([0, 60, 96, 160, 224, 255]))]).toEqual([
      0, 0, 0, 128, 255, 255,
    ]);
  });

  it("refuses a photo with its background still there", () => {
    expect(
      judgeCutout(
        alpha(50, 50, () => 255),
        50,
        50,
      ).ok,
    ).toBe(false);
    expect(
      judgeCutout(
        alpha(50, 50, (x, y) => (y < 45 ? 255 : 0)),
        50,
        50,
      ).ok,
    ).toBe(false);
  });

  it("refuses a speck", () => {
    expect(
      judgeCutout(
        alpha(100, 100, (x, y) => (x < 2 && y < 2 ? 255 : 0)),
        100,
        100,
      ).ok,
    ).toBe(false);
  });

  it("pads a box inside the image", () => {
    expect(
      paddedBox({ left: 0, top: 10, width: 50, height: 50 }, { width: 60, height: 100 }, 0.1),
    ).toEqual({ left: 0, top: 5, width: 55, height: 60 });
  });
});

describe("prompt", () => {
  const plan = planProductHero({ seed: "p", brief: "benefits", product, headline: "Gentle wins" });
  const prompt = productHeroPrompt({
    staging: plan.staging,
    palette: productPalette({ product: "#78afe1" }),
    productName: product.name,
    texture: plan.texture,
    copy: plan.copy,
    allowText: true,
    cutout: true,
    series: false,
    brandName: "Acme",
    logoCorner: "bottom-right",
  });

  it("never puts the product in a frame and keeps its label", () => {
    expect(prompt).toContain("never inside a frame, card, box");
    expect(prompt).toContain("every word, number and logo on its label exactly");
    expect(HERO_NEVER.some((r) => /clip-art/.test(r))).toBe(true);
  });

  it("sets exactly the stored words", () => {
    expect(prompt).toContain('Headline: "Gentle wins"');
    expect(prompt).toContain('Benefit 1: "Gently cleanses without stripping skin"');
    expect(prompt).not.toContain("Support line");
  });

  it("has no words at all when the look allows none", () => {
    const quiet = productHeroPrompt({
      staging: plan.staging,
      palette: productPalette({ product: null }),
      productName: product.name,
      texture: null,
      copy: plan.copy,
      allowText: false,
      cutout: false,
      series: true,
      brandName: "Acme",
    });
    expect(quiet).toContain("TEXT: none");
    expect(quiet).not.toContain("Benefit 1");
    expect(quiet).toContain("Use only the product from it");
    expect(heroCopyLines({ headline: " " }, plan.staging)).toEqual([]);
  });

  it("never names another company", () => {
    const text = [
      prompt,
      cutoutPrompt("Gel Cleanser"),
      ...STAGINGS.map((s) => [s.scene("the product", "gel"), s.type, s.avoid].join(" ")),
    ].join("\n");
    for (const brand of BRANDS) expect(text).not.toContain(brand);
  });
});

describe("every poster its own", () => {
  const posts = (n: number) => {
    const looks: ReturnType<typeof planProductHero>["look"][] = [];
    for (let i = 0; i < n; i++) {
      const plan = planProductHero({
        seed: `post-${i}`,
        brief: "",
        product,
        headline: "Gentle wins",
        recentLooks: [...looks].reverse(),
      });
      looks.push(plan.look);
    }
    return looks;
  };

  it("changes the topic, staging and light post to post, never the brand's colours", () => {
    const looks = posts(12);
    for (let i = 1; i < looks.length; i++) {
      expect(looks[i].staging).not.toBe(looks[i - 1].staging);
      expect(looks[i].topic).not.toBe(looks[i - 1].topic);
      expect(looks[i].light).not.toBe(looks[i - 1].light);
    }
    expect(new Set(looks.map((l) => l.staging)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(looks.map((l) => l.topic)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(looks.map((l) => l.palette))).toEqual(new Set(["tint"]));
    expect(looks.some((l) => l.light === "spotlight")).toBe(false);
  });

  it("changes the colours only when the brief asks", () => {
    expect(
      planProductHero({ seed: "d", brief: "a dark, moody night post", product }).look.palette,
    ).toBe("noir");
  });

  it("follows the occasion the brief or campaign names", () => {
    expect(occasionOf("Eid Mubarak from all of us")?.id).toBe("eid");
    expect(occasionOf("Eid gift ideas")?.id).toBe("eid");
    expect(occasionOf("Christmas gifts")?.id).toBe("gift");
    expect(occasionOf("Winter sale: 20% off")?.id).toBe("sale");
    expect(occasionOf("our cleanser")).toBeNull();
    const plan = planProductHero({ seed: "o", brief: "", product, context: "Ramadan nights" });
    expect(plan.occasion?.id).toBe("eid");
    expect(plan.look.palette).toBe("tint");
  });

  it("moves through a product's benefits post by post", () => {
    const all = [
      "One two three",
      "Four five six",
      "Seven eight nine",
      "Ten eleven twelve",
      "Thirteen fourteen fifteen",
    ];
    const first = rotateBenefits(all, [], "a", 3);
    const next = rotateBenefits(all, [{ benefits: first }], "b", 3);
    expect(next.filter((b) => !first.includes(b)).length).toBe(2);
  });

  it("reads a stored look defensively", () => {
    expect(readHeroLook(null)).toBeNull();
    const look = readHeroLook({
      staging: "floating",
      palette: "purple",
      headline: 4,
      benefits: ["a", 2],
    });
    expect(look?.palette).toBeUndefined();
    expect(look?.headline).toBeNull();
    expect(look?.benefits).toEqual(["a"]);
  });

  it("has a set for every staging and colour moods that read as different worlds", () => {
    for (const s of STAGINGS) expect(SETS[s.id].length).toBeGreaterThanOrEqual(2);
    expect(
      hexToHsl(productPalette({ product: "#78afe1", mood: "noir" }).background)!.l,
    ).toBeLessThan(0.15);
    expect(hexToHsl(productPalette({ product: "#78afe1", mood: "deep" }).text)!.l).toBeGreaterThan(
      0.8,
    );
    expect(productPalette({ product: "#78afe1", mood: "duo" }).background2).toBeTruthy();
  });

  it("only stages ingredients the facts name", () => {
    expect(ingredientsOf(product.description)).toEqual(["green tea", "aloe"]);
    expect(ingredientsOf("Made with love for your skin.")).toEqual([]);
    expect(ingredientsOf("A cleanser for skin with acne.")).toEqual([]);
    const none = pickStaging({
      seed: "i",
      brief: "made with natural ingredients",
      texture: null,
      benefits: 0,
      hasText: true,
    });
    expect(none.id).not.toBe("ingredient-world");
  });
});

describe("the concept writer's words are checked", () => {
  const facts = [product.name, product.description, ...product.benefits].join("\n");

  it("keeps a fresh, grounded idea and headline", () => {
    const c = groundConcept(
      {
        scene:
          "The cleanser stands on wet glass at dawn. A woman's hand reaches in. A slow ribbon of gel curls around its cap.",
        headline: "Calm skin, every single morning",
        support: "A gentle gel cleanser for acne-prone skin.",
      },
      { facts, recentHeadlines: ["Clear skin starts gentle"], allowText: true },
    );
    expect(c.scene).toContain("ribbon of gel");
    expect(c.scene).not.toMatch(/hand/);
    expect(c.headline).toBe("Calm skin, every single morning");
    expect(c.support).toBeTruthy();
  });

  it("drops claims, figures and repeats the facts don't support", () => {
    const opts = { facts, recentHeadlines: ["Clear skin starts gentle"], allowText: true };
    expect(
      groundConcept({ headline: "Dermatologist approved clear skin" }, opts).headline,
    ).toBeNull();
    expect(groundConcept({ headline: "Clear skin in 7 days" }, opts).headline).toBeNull();
    expect(groundConcept({ headline: "Clear skin starts so gentle" }, opts).headline).toBeNull();
    expect(
      groundConcept({ headline: "Gentle wins" }, { ...opts, allowText: false }).headline,
    ).toBeNull();
    expect(nearRepeat("Glow starts here", "Your routine, simplified")).toBe(false);
  });

  it("keeps the person's own quoted words", () => {
    expect(quotedHeadline('Post with the line "Back in stock" please')).toBe("Back in stock");
    expect(quotedHeadline("no quotes")).toBeNull();
  });

  it("shows the writer what the brand already said, and names no other company", () => {
    const plan = planProductHero({ seed: "c", brief: "", product });
    const { system, user } = conceptMessages({
      brandName: "Acme",
      product,
      staging: plan.staging,
      look: plan.look,
      occasion: null,
      texture: plan.texture,
      ingredients: plan.ingredients,
      benefits: plan.copy.benefits ?? [],
      brief: "a product post",
      allowText: true,
      recent: [{ concept: "On wet glass at dawn", headline: "Clear skin starts gentle" }],
    });
    expect(user).toContain('headline: "Clear skin starts gentle"');
    for (const brand of BRANDS) expect(system + user).not.toContain(brand);
  });
});

describe("a product its photo cuts off", () => {
  it("rotates through stagings where it can enter from the edge", () => {
    const looks: ReturnType<typeof planProductHero>["look"][] = [];
    for (let i = 0; i < 6; i++) {
      const plan = planProductHero({
        seed: `crop-${i}`,
        brief: "",
        product,
        headline: "Gentle wins",
        cropped: true,
        recentLooks: [...looks].reverse(),
      });
      expect(CROP_SAFE).toContain(plan.staging.id);
      looks.push(plan.look);
    }
    expect(new Set(looks.map((l) => l.staging)).size).toBeGreaterThanOrEqual(3);
    const kept = planProductHero({
      seed: "k",
      brief: "",
      product,
      keepStaging: "glow-sweep",
      cropped: true,
    });
    expect(CROP_SAFE).toContain(kept.staging.id);
  });
});

describe("headlines never open the way the latest ones did", () => {
  it("takes the first option with a fresh opening", () => {
    const c = groundConcept(
      {
        headlines: [
          "Pure calm for oily skin",
          "The calm your skin wants",
          "Cleansing that feels like water",
        ],
      },
      {
        facts: [product.name, product.description].join("\n"),
        recentHeadlines: ["Pure gel clarity", "Calm skin, every morning"],
        allowText: true,
      },
    );
    expect(c.headline).toBe("Cleansing that feels like water");
    expect(sameOpening("The pure glow", "Pure gel clarity")).toBe(true);
    expect(sameOpening("Gentle wins", "Pure gel clarity")).toBe(false);
  });
});
