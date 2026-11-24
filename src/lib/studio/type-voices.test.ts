import { describe, expect, it } from "vitest";
import { catalogFont, googleFontHref, isSingleWeight } from "@/lib/brand-look/fonts";
import {
  TYPE_VOICES,
  isDisplayWorthy,
  pickTypeVoice,
  typeVoiceById,
  typeVoiceFonts,
  typeVoiceLine,
  voicesFor,
} from "./type-voices";

// Stored ids (meta.type_voice, campaign controls): add, never rename.
const STORED = [
  "sturdy-grotesk",
  "workwear-slab",
  "condensed-punch",
  "didone-luxe",
  "garamond-calm",
  "editorial-serif",
  "swiss-grotesk",
  "geometric-tech",
  "dev-mono",
  "humanist-care",
  "classic-trust",
  "warm-serif",
  "chunky-serif",
  "rounded-friendly",
  "multiscript-soft",
  "angular-gaming",
  "arena-condensed",
  "arcade-pixel",
  "expressive-grotesk",
  "studio-pair",
  "festive-pop",
  "deco-elegant",
  "personal-note",
  "quiet-minimal",
  "bold-geo",
  "heritage-slab",
  "luxe-kufi",
];

describe("type voices", () => {
  it("keeps ids add-only", () => {
    expect(TYPE_VOICES.map((v) => v.id)).toEqual(STORED);
  });

  it("every voice draws with real catalogue fonts and names none to the model", () => {
    for (const v of TYPE_VOICES) {
      expect(catalogFont(v.headline)?.family, v.id).toBe(v.headline);
      expect(catalogFont(v.text)?.family, v.id).toBe(v.text);
      const line = typeVoiceLine({ kind: "voice", voice: v });
      expect(line.length, v.id).toBeLessThanOrEqual(220);
      expect(line).not.toContain(v.headline);
      if (v.singleWeight) expect(isSingleWeight(v.headline), v.id).toBe(true);
    }
  });

  it("asks Google for single-weight faces without weights", () => {
    expect(googleFontHref(["DM Serif Display"])).toContain("family=DM+Serif+Display&");
    expect(googleFontHref(["Fraunces"])).toContain("Fraunces:wght@");
  });

  it("fits the business: plumbers, game studios and web agencies differ", () => {
    const plumber = voicesFor("Plumbing and heating. Boiler repair for homes.").map((v) => v.id);
    expect(plumber).toContain("sturdy-grotesk");
    expect(plumber).not.toContain("didone-luxe");
    expect(voicesFor("Indie game studio making console games").map((v) => v.id)).toContain(
      "angular-gaming",
    );
    expect(voicesFor("Web development agency").map((v) => v.id)).toContain("dev-mono");
    expect(voicesFor("Bridal jewellery boutique").map((v) => v.id)[0]).toBe("didone-luxe");
    expect(voicesFor("").length).toBeGreaterThan(0);
  });

  it("is chosen once per brand: stable, own type first, UI sans never a headline", () => {
    const a = pickTypeVoice({ workspaceId: "ws1", business: "Cafe and bakery" });
    const b = pickTypeVoice({ workspaceId: "ws1", business: "Cafe and bakery" });
    expect(a).toEqual(b);
    expect(pickTypeVoice({ workspaceId: "ws1", business: "x", ownHeadline: "Fraunces" })).toEqual({
      kind: "own",
      headline: "Fraunces",
      text: undefined,
    });
    expect(isDisplayWorthy("Inter")).toBe(false);
    expect(pickTypeVoice({ workspaceId: "ws1", business: "Cafe", ownHeadline: "Inter" }).kind).toBe(
      "voice",
    );
    const stored = pickTypeVoice({ workspaceId: "ws1", business: "Cafe", stored: "heritage-slab" });
    expect(stored.kind === "voice" && stored.voice.id).toBe("heritage-slab");
    expect(typeVoiceById("nope")).toBeNull();
  });

  it("gives slides a real pair instead of Inter", () => {
    const voice = typeVoiceById("warm-serif")!;
    expect(typeVoiceFonts({ kind: "voice", voice })).toEqual({
      heading: "Fraunces",
      body: "DM Sans",
    });
  });

  it("spreads different brands across voices", () => {
    const picks = new Set(
      Array.from({ length: 40 }, (_, i) => {
        const c = pickTypeVoice({ workspaceId: `ws-${i}`, business: "A small business" });
        return c.kind === "voice" ? c.voice.id : c.headline;
      }),
    );
    expect(picks.size).toBeGreaterThanOrEqual(3);
  });
});
