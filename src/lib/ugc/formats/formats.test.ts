import { describe, expect, it } from "vitest";
import { planVideoSegments } from "../duration";
import { HOOK_TEXT_PRESET_IDS, hookCues } from "../hook-text";
import { UGC_MODELS } from "../models";
import { BriefSchema, ProductSchema, ScriptSchema } from "../schemas";
import { scriptFromText, scriptToText } from "../script-text";
import {
  FORMAT_EXAMPLES,
  LEGACY_FORMAT_ALIASES,
  UGC_FORMATS,
  UGC_FORMAT_GROUPS,
  buildFormatVideoPrompt,
  creatorFormatSettings,
  formatForRender,
  formatScriptIssues,
  leadRole,
  pickPartner,
  pickVariant,
  pickVariants,
  suggestFormats,
  ugcFormat,
} from ".";

const product = ProductSchema.parse({
  name: "GlowSerum",
  brand: "Lumen",
  description: "A lightweight vitamin C face serum.",
  category: "Skincare",
  facts: [{ id: "f1", text: "Contains 15% vitamin C", source: "page" }],
});

describe("format library", () => {
  it("has 30 complete formats with unique ids", () => {
    expect(UGC_FORMATS).toHaveLength(30);
    expect(new Set(UGC_FORMATS.map((f) => f.id)).size).toBe(30);
    const groups = new Set(UGC_FORMAT_GROUPS.map((g) => g.id));
    for (const f of UGC_FORMATS) {
      expect(groups.has(f.group), f.id).toBe(true);
      expect(f.places.length, f.id).toBeGreaterThanOrEqual(3);
      expect(f.twists.length, f.id).toBeGreaterThanOrEqual(3);
      expect(f.hookPatterns.length, f.id).toBeGreaterThanOrEqual(3);
      expect(HOOK_TEXT_PRESET_IDS).toContain(f.hookText.preset);
      expect(f.hookText.example.split(/\s+/).length, f.id).toBeLessThanOrEqual(8);
      expect(UGC_MODELS[f.defaultModel], f.id).toBeTruthy();
      const share = f.beats.reduce((sum, b) => sum + b.share, 0);
      expect(share, f.id).toBeCloseTo(1, 2);
      expect(
        f.beats.some((b) => b.role === "hook"),
        f.id,
      ).toBe(true);
    }
  });

  it("gives every format a gold example", () => {
    for (const f of UGC_FORMATS) expect(FORMAT_EXAMPLES[f.id]?.length, f.id).toBeGreaterThan(200);
  });

  it("keeps old brief formats working through aliases", () => {
    for (const [old, id] of Object.entries(LEGACY_FORMAT_ALIASES)) {
      expect(ugcFormat(old)?.id, old).toBe(id);
    }
    expect(ugcFormat("auto")).toBeNull();
    expect(ugcFormat("nope")).toBeNull();
  });
});

describe("variants", () => {
  const format = ugcFormat("subway-interview")!;

  it("is stable for a seed and skips the brand's last two", () => {
    expect(pickVariant(format, "p1")).toEqual(pickVariant(format, "p1"));
    const recent = [pickVariant(format, "a"), pickVariant(format, "b")];
    for (let i = 0; i < 20; i++) {
      const v = pickVariant(format, `seed-${i}`, recent);
      if (new Set(recent.map((r) => r.place)).size < format.places.length) {
        expect(recent.map((r) => r.place)).not.toContain(v.place);
      }
    }
  });

  it("gives three ideas three different variants", () => {
    const vs = pickVariants(format, "p1", [], 3);
    expect(new Set(vs.map((v) => `${v.place}:${v.twist}:${v.hook}`)).size).toBe(3);
  });
});

describe("suggestFormats", () => {
  it("matches a brand and spreads the first picks across groups", () => {
    const ids = suggestFormats({ industry: "Skincare", product: ["serum"], objective: "sales" }, 3);
    expect(ids).toHaveLength(3);
    const groups = ids.map((id) => ugcFormat(id)!.group);
    expect(new Set(groups).size).toBe(3);
  });

  it("always answers, even with nothing to go on", () => {
    expect(suggestFormats({}, 3)).toHaveLength(3);
  });
});

describe("cast", () => {
  it("never makes an off-camera interviewer the lead", () => {
    for (const f of UGC_FORMATS) {
      const off = f.roles.find((r) => /off-camera/i.test(r.position));
      if (off) expect(leadRole(f), f.id).not.toBe(off.key);
    }
  });

  it("picks a second person who is not the lead", () => {
    for (let i = 0; i < 10; i++) expect(pickPartner("maya", `s${i}`).id).not.toBe("maya");
  });
});

describe("script checks", () => {
  const format = ugcFormat("honest-review")!;
  const script = scriptFromText(
    [
      "I didn't want to like this.",
      "First try, it felt a bit sticky.",
      "Three days later my skin looks awake.",
      "Eight out of ten, and I don't give tens.",
    ].join("\n"),
    12,
    { format: format, onScreen: "I didn't want to like this" },
  )!;

  it("passes a natural script", () => {
    expect(formatScriptIssues(script, format, { productName: "GlowSerum" })).toEqual([]);
  });

  it("refuses an ad opener, a repeated hook and too many product names", () => {
    const bad = ScriptSchema.parse({
      ...script,
      hook: "Hey guys, introducing GlowSerum",
      scenes: script.scenes.map((s) => ({ ...s, dialogue: `GlowSerum ${s.dialogue}` })),
    });
    const issues = formatScriptIssues(bad, format, {
      productName: "GlowSerum",
      recentHooks: ["Hey guys, introducing GlowSerum"],
    });
    expect(issues.length).toBeGreaterThanOrEqual(3);
  });

  it("asks for people to be named by role, not A or B", () => {
    const lettered = ScriptSchema.parse({
      ...script,
      scenes: script.scenes.map((s, i) =>
        i === 1 ? { ...s, action: "A squints at the lens." } : s,
      ),
    });
    const issues = formatScriptIssues(lettered, format, { productName: "GlowSerum" });
    expect(issues.some((i) => i.includes("by their role"))).toBe(true);
    const article = ScriptSchema.parse({
      ...script,
      scenes: script.scenes.map((s, i) =>
        i === 1 ? { ...s, action: "A kid's backpack sits on the seat." } : s,
      ),
    });
    expect(formatScriptIssues(article, format, { productName: "GlowSerum" })).toEqual([]);
  });

  it("round-trips a two-person script with the speakers named", () => {
    const two = ugcFormat("subway-interview")!;
    const s = scriptFromText("Host: Hot take?\nGuest: No.\nHost: Why?\nGuest: Because.", 10, {
      format: two,
    })!;
    expect(new Set(s.scenes.map((x) => x.speaker))).toEqual(new Set(["A", "B"]));
    expect(scriptToText(s, two)).toMatch(/^Host: /);
  });
});

describe("format video prompt", () => {
  const format = ugcFormat("subway-interview")!;
  const brief = BriefSchema.parse({ format: "subway-interview" });
  const script = scriptFromText(
    "Host: Hot take about mornings?\nGuest: Coffee is a personality now.\nHost: And you?\nGuest: I just use this.",
    10,
    { format: format, onScreen: "she ended him in 9 seconds" },
  )!;
  const prompt = buildFormatVideoPrompt(
    {
      product,
      brief,
      script,
      model: UGC_MODELS.long,
      durationSec: 10,
      aspectRatio: "9:16",
      imageCount: 2,
      creatorImage: true,
      partnerImage: true,
      seed: "p1",
    },
    format,
  );

  it("reads as real phone footage, never as an ad", () => {
    expect(prompt).toMatch(/^Real vertical 9:16 smartphone video/);
    expect(prompt).toMatch(/not an advertisement/);
    expect(prompt).not.toMatch(/UGC video ad/i);
  });

  it("allows the split screen this format opens on and quotes the lines", () => {
    expect(prompt).toMatch(/SPLIT SCREEN/);
    expect(prompt).not.toMatch(/no split.?screens?/i);
    expect(prompt).toContain('"Coffee is a personality now."');
  });

  it("is only used for a library format, never for a Studio script", () => {
    expect(formatForRender(brief, script)?.id).toBe("subway-interview");
    expect(formatForRender({ ...brief, scriptSource: "studio" }, script)).toBeNull();
    expect(
      formatForRender(BriefSchema.parse({ format: "auto" }), { ...script, format: undefined }),
    ).toBeNull();
  });

  it("stores cuts, the join and the hook cues for the render", () => {
    const settings = creatorFormatSettings({ brief, script, format, durationSec: 10, seed: "p1" });
    expect(settings.ugcFormat).toBe("subway-interview");
    expect(settings.cutAt?.every((t) => t > 0 && t < 10)).toBe(true);
    expect(settings.hookText?.cues[0].text).toBe("she ended him in 9 seconds");
    const off = creatorFormatSettings({
      brief: { ...brief, hookText: { enabled: false } },
      script,
      format,
      durationSec: 10,
      seed: "p1",
    });
    expect(off.hookText).toBeUndefined();
  });
});

describe("hook cues", () => {
  it("times every preset inside the first seconds", () => {
    for (const id of HOOK_TEXT_PRESET_IDS) {
      for (const cue of hookCues("me / my bank account and more words here", id, 10)) {
        expect(cue.start).toBeGreaterThanOrEqual(0);
        expect(cue.end).toBeGreaterThan(cue.start);
        expect(cue.end).toBeLessThanOrEqual(3);
      }
    }
  });

  it("splits two labels and lower-cases pov", () => {
    expect(hookCues("me / my mom", "split-label", 10).map((c) => c.side)).toEqual([
      "left",
      "right",
    ]);
    expect(hookCues("POV: You Found It", "pov", 10)[0].text).toBe("pov: you found it");
  });

  it("keeps a long word-by-word line readable", () => {
    const cues = hookCues(
      "one two three four five six seven eight nine ten eleven twelve",
      "word-pop",
      10,
    );
    for (const c of cues) expect(c.end).toBeGreaterThan(c.start);
  });

  it("draws nothing on a very short video or with no words", () => {
    expect(hookCues("", "classic", 10)).toEqual([]);
    expect(hookCues("hello", "classic", 1)).toEqual([]);
  });
});

describe("clips split at beats", () => {
  it("snaps a join to the nearest beat boundary", () => {
    const segments = planVideoSegments(20, [5, 10, 15], [7, 11.2]);
    expect(segments.map((s) => s.start)).toEqual([0, 11]);
    expect(segments.reduce((sum, s) => sum + s.seconds, 0)).toBe(20);
  });

  it("keeps the even split when no beat is near", () => {
    expect(planVideoSegments(20, [5, 10, 15]).map((s) => s.seconds)).toEqual([10, 10]);
  });
});
