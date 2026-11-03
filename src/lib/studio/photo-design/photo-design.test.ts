import { describe, expect, it } from "vitest";
import {
  compositeLayers,
  findRegions,
  fitPhoto,
  KEY_GREEN,
  KEY_MAGENTA,
  mapToCanvas,
  photoMask,
  visibleShare,
} from "./geometry";
import { groundRead, NEUTRAL_READING, type PhotoReading } from "./read";
import { photoDesignCopy, pickKeyColour, planPhotoDesign } from "./plan";
import { judgeFaces, judgeLayer } from "./checks";
import { blendPrompt, designLayerPrompt } from "./prompt";

/** An RGBA canvas filled with one colour. */
function canvas(width: number, height: number, rgba: [number, number, number, number]) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return data;
}

function paintRect(
  data: Uint8Array,
  width: number,
  rect: { x: number; y: number; w: number; h: number },
  rgba: [number, number, number, number],
) {
  for (let y = rect.y; y < rect.y + rect.h; y++)
    for (let x = rect.x; x < rect.x + rect.w; x++) data.set(rgba, (y * width + x) * 4);
}

/** A filled rectangle turned by `angle` radians around (cx, cy). */
function paintTilted(
  data: Uint8Array,
  width: number,
  height: number,
  r: { cx: number; cy: number; w: number; h: number; angle: number },
  rgba: [number, number, number, number],
) {
  const cos = Math.cos(r.angle);
  const sin = Math.sin(r.angle);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const dx = x + 0.5 - r.cx;
      const dy = y + 0.5 - r.cy;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      if (Math.abs(u) <= r.w / 2 && Math.abs(v) <= r.h / 2) data.set(rgba, (y * width + x) * 4);
    }
}

const reading = (patch: Partial<PhotoReading> = {}): PhotoReading => ({
  ...NEUTRAL_READING,
  ...patch,
});

describe("groundRead", () => {
  it("keeps one reading per photo and clamps boxes", () => {
    const read = groundRead(
      {
        occasion: "  a product launch  evening ",
        photos: [
          {
            index: 1,
            scene: "Team on stage",
            faces: [
              { x: 0.9, y: 0.1, w: 0.4, h: 0.2 },
              { x: 0.2, y: 0.2, w: 0.001, h: 0.1 },
            ],
            colours: ["#AABBCC", "red"],
            quality: 9,
          },
          { index: 7, scene: "ignored" },
        ],
      },
      2,
    );
    expect(read.occasion).toBe("a product launch evening");
    expect(read.photos).toHaveLength(2);
    expect(read.photos[0]).toEqual(NEUTRAL_READING);
    expect(read.photos[1].faces).toEqual([{ x: 0.9, y: 0.1, w: expect.closeTo(0.1, 5), h: 0.2 }]);
    expect(read.photos[1].colours).toEqual(["#aabbcc"]);
    expect(read.photos[1].focus.x).toBeCloseTo(0.95);
  });

  it("falls back to neutral readings when the model answer is malformed", () => {
    expect(groundRead("nope", 3).photos).toEqual([
      NEUTRAL_READING,
      NEUTRAL_READING,
      NEUTRAL_READING,
    ]);
  });
});

describe("pickKeyColour", () => {
  it("uses green unless the brand or photos are green", () => {
    expect(pickKeyColour(["#1e40af", "#ffffff"])).toBe(KEY_GREEN);
    expect(pickKeyColour(["#c6ff00", "#16a34a"])).toBe(KEY_MAGENTA);
    expect(pickKeyColour(["#c6ff00", "#d946ef", "#a21caf"])).toBe(KEY_GREEN);
  });
});

describe("photoDesignCopy", () => {
  it("uses the person's quoted words exactly", () => {
    expect(
      photoDesignCopy({
        brief: 'add "Same-day plumbing" and “Call 0300 1234567” to it',
        onImageText: "Fast fixes",
      }),
    ).toEqual([
      { label: "Headline", text: "Same-day plumbing" },
      { label: "Support line", text: "Call 0300 1234567" },
    ]);
  });

  it("falls back to the on-image line, and writes nothing when the look forbids words", () => {
    expect(photoDesignCopy({ brief: "make a post", onImageText: "Launch night" })).toEqual([
      { label: "Headline", text: "Launch night" },
    ]);
    expect(photoDesignCopy({ brief: 'add "Hi"', maxWords: 0 })).toEqual([]);
  });
});

describe("planPhotoDesign", () => {
  it("puts one well-fitting photo full-bleed and maps its faces onto the canvas", () => {
    const plan = planPhotoDesign({
      readings: [
        reading({ faces: [{ x: 0.4, y: 0.2, w: 0.2, h: 0.2 }], focus: { x: 0.5, y: 0.3 } }),
      ],
      sizes: [{ width: 1080, height: 1350 }],
      ratio: "4:5",
      copy: [],
      brief: "add our headline",
    });
    expect(plan.layout).toBe("overlay");
    expect(plan.avoid[0].x).toBeCloseTo(0.4);
  });

  it("frames a photo whose shape doesn't fit, or when the person asks for a frame", () => {
    const base = { readings: [reading()], copy: [], ratio: "4:5" as const };
    expect(
      planPhotoDesign({ ...base, sizes: [{ width: 1920, height: 1080 }], brief: "post it" }).layout,
    ).toBe("windows");
    expect(
      planPhotoDesign({ ...base, sizes: [{ width: 1080, height: 1350 }], brief: "polaroid frame" })
        .layout,
    ).toBe("windows");
  });

  it("leads with the strongest photo", () => {
    const plan = planPhotoDesign({
      readings: [reading({ quality: 4 }), reading({ quality: 9 }), reading({ quality: 6 })],
      sizes: [
        { width: 100, height: 100 },
        { width: 150, height: 100 },
        { width: 100, height: 150 },
      ],
      ratio: "1:1",
      copy: [],
      brief: "event recap",
    });
    expect(plan.order).toEqual([1, 2, 0]);
    expect(plan.shapes).toEqual(["landscape", "portrait", "square"]);
  });
});

describe("photoMask and findRegions", () => {
  it("finds key-coloured and transparent windows and measures them", () => {
    const w = 200;
    const h = 100;
    const data = canvas(w, h, [20, 30, 120, 255]);
    paintRect(data, w, { x: 10, y: 10, w: 80, h: 60 }, [0, 255, 0, 255]);
    paintRect(data, w, { x: 120, y: 20, w: 40, h: 40 }, [0, 0, 0, 0]);
    paintRect(data, w, { x: 190, y: 90, w: 1, h: 1 }, [0, 255, 0, 255]);
    const mask = photoMask(data, w, h, KEY_GREEN);
    const { regions } = findRegions(mask, w, h);
    expect(regions).toHaveLength(3);
    expect(regions[0]).toMatchObject({
      area: 4800,
      cx: 50,
      cy: 40,
      angle: 0,
      width: 80,
      height: 60,
    });
    expect(regions[1]).toMatchObject({ area: 1600, cx: 140, cy: 40 });
  });

  it("does not mistake a lime brand colour for a green window", () => {
    const data = canvas(4, 4, [198, 255, 0, 255]);
    expect(Math.max(...photoMask(data, 4, 4, KEY_GREEN))).toBeLessThan(0.05);
  });

  it("measures a tilted window's angle and size", () => {
    const w = 300;
    const h = 300;
    const data = canvas(w, h, [255, 255, 255, 255]);
    const angle = (12 * Math.PI) / 180;
    paintTilted(data, w, h, { cx: 150, cy: 150, w: 160, h: 100, angle }, [255, 0, 255, 255]);
    const mask = photoMask(data, w, h, KEY_MAGENTA);
    const [region] = findRegions(mask, w, h).regions;
    expect(region.angle).toBeCloseTo(angle, 1);
    expect(region.width).toBeGreaterThan(158);
    expect(region.width).toBeLessThan(164);
    expect(region.height).toBeGreaterThan(98);
    expect(region.height).toBeLessThan(104);
  });

  it("keeps a portrait window upright instead of turning it a quarter", () => {
    const w = 100;
    const h = 200;
    const data = canvas(w, h, [255, 255, 255, 255]);
    paintRect(data, w, { x: 20, y: 20, w: 40, h: 150 }, [0, 255, 0, 255]);
    const [region] = findRegions(photoMask(data, w, h, KEY_GREEN), w, h).regions;
    expect(region.angle).toBe(0);
    expect(region.width).toBe(40);
    expect(region.height).toBe(150);
  });
});

describe("fitPhoto and mapToCanvas", () => {
  it("cover-fits around the focus point without stretching", () => {
    const t = fitPhoto(
      { width: 2000, height: 1000 },
      { cx: 100, cy: 100, angle: 0, width: 100, height: 100 },
      { x: 0.9, y: 0.5 },
    );
    expect(t.crop).toEqual({ left: 1000, top: 0, width: 1000, height: 1000 });
    expect(mapToCanvas(t, 0.75, 0.5)).toEqual({ x: 100, y: 100 });
    expect(mapToCanvas(t, 1, 0)).toEqual({ x: 150, y: 50 });
  });
});

describe("compositeLayers", () => {
  it("shows the real photo unchanged inside a window and the design outside it", () => {
    const w = 10;
    const h = 1;
    const design = canvas(w, h, [200, 10, 10, 255]);
    paintRect(design, w, { x: 3, y: 0, w: 4, h: 1 }, [0, 255, 0, 255]);
    const photos = new Uint8Array(w * h * 4);
    for (let x = 3; x < 7; x++) photos.set([x * 10, 100, 50, 255], x * 4);
    const fill = canvas(w, h, [0, 0, 0, 255]);
    const mask = photoMask(design, w, h, KEY_GREEN);
    const out = compositeLayers({
      width: w,
      height: h,
      design,
      photos,
      fill,
      fillChannels: 4,
      mask,
      key: KEY_GREEN,
    });
    expect([...out.slice(0, 3)]).toEqual([200, 10, 10]);
    for (let x = 3; x < 7; x++) expect([...out.slice(x * 3, x * 3 + 3)]).toEqual([x * 10, 100, 50]);
  });

  it("uses the fill, never the key colour, for a speck no photo covers", () => {
    const design = canvas(1, 1, [0, 255, 0, 255]);
    const out = compositeLayers({
      width: 1,
      height: 1,
      design,
      photos: new Uint8Array(4),
      fill: new Uint8Array([9, 8, 7]),
      fillChannels: 3,
      mask: photoMask(design, 1, 1, KEY_GREEN),
      key: KEY_GREEN,
    });
    expect([...out]).toEqual([9, 8, 7]);
  });
});

describe("judgeLayer", () => {
  const region = (area: number, width: number, height: number, id = 1) => ({
    id,
    area,
    cx: 0,
    cy: 0,
    angle: 0,
    width,
    height,
  });
  const plan = {
    layout: "windows" as const,
    order: [0, 1, 2],
    shapes: ["landscape", "portrait", "square"] as const,
    key: KEY_GREEN,
  };
  const size = { width: 100, height: 100 };

  it("assigns the hero to the largest window and others by shape", () => {
    const verdict = judgeLayer(
      { ...plan, shapes: [...plan.shapes] },
      [
        region(3000, 75, 40, 1),
        region(900, 30, 30, 2),
        region(800, 30, 40, 3),
        region(10, 3, 3, 4),
      ],
      size,
    );
    expect(verdict).toEqual({ ok: true, windows: [0, 2, 1] });
  });

  it("asks again for the right number of windows", () => {
    const verdict = judgeLayer({ ...plan, shapes: [...plan.shapes] }, [region(3000, 60, 50)], size);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.feedback).toContain("exactly 3 separate photo windows");
  });

  it("rejects an overlay design that hides most of the photo", () => {
    const verdict = judgeLayer(
      { layout: "overlay", order: [0], shapes: ["square"], key: KEY_GREEN },
      [region(3000, 60, 50)],
      size,
    );
    expect(verdict.ok).toBe(false);
  });

  it("flags a covered face", () => {
    expect(judgeFaces([1, 0.9]).ok).toBe(true);
    expect(judgeFaces([1, 0.2]).ok).toBe(false);
  });
});

describe("visibleShare", () => {
  it("ignores points cropped off the canvas", () => {
    const mask = new Float32Array([1, 0, 1, 1]);
    expect(
      visibleShare(mask, 2, 2, [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 5, y: 5 },
      ]),
    ).toBe(0.5);
  });
});

describe("prompts", () => {
  const plan = planPhotoDesign({
    readings: [reading({ scene: "Speaker on stage" }), reading()],
    sizes: [
      { width: 1600, height: 1000 },
      { width: 1000, height: 1000 },
    ],
    ratio: "4:5",
    copy: [{ label: "Headline", text: "Launch night" }],
    brief: "event recap",
    occasion: "a product launch",
  });
  const brand = {
    brandName: "Acme",
    colours: ["#112233"],
    fonts: ["Inter"],
    logoCorner: "top-right",
  };

  it("asks for exactly the windows, the exact words and no drawn people or logo", () => {
    const prompt = designLayerPrompt({ plan, brand, brief: "event recap" });
    expect(prompt).toContain("exactly 2 separate windows");
    expect(prompt).toContain('Headline: "Launch night"');
    expect(prompt).toContain("never draw people");
    expect(prompt).toContain("Do not draw any logo");
    expect(prompt).toContain("Speaker on stage");
    expect(prompt).toContain(plan.key.hex);
  });

  it("lets the model repaint only in blend mode, keeping people recognisable", () => {
    const prompt = blendPrompt({ plan, brand, brief: "event recap" });
    expect(prompt).toContain("recognisably the same");
    expect(prompt).not.toContain(plan.key.hex);
  });
});
