// Pixel maths for "design with my photos": find the photo windows the image
// model left in its design layer, measure each one, fit a real photo into it
// and lay the design back over the photos. Pure (typed arrays in, typed arrays
// out) so the compositor is tested without an image library or a model.

export type KeyColour = { name: "green" | "magenta"; hex: string; rgb: [number, number, number] };

export const KEY_GREEN: KeyColour = { name: "green", hex: "#00ff00", rgb: [0, 255, 0] };
export const KEY_MAGENTA: KeyColour = { name: "magenta", hex: "#ff00ff", rgb: [255, 0, 255] };

/** How far a pixel leans towards the key colour (0..255). */
function keyness(r: number, g: number, b: number, key: KeyColour): number {
  return key.name === "green" ? g - Math.max(r, b) : Math.min(r, b) - g;
}

/** Below this the pixel is design; above KEY_HIGH it is all photo. */
const KEY_LOW = 50;
const KEY_HIGH = 140;

function smoothstep(low: number, high: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}

/**
 * How much of each pixel is "photo" (0 = design, 1 = photo): transparent
 * pixels and key-coloured pixels both count, so the layer works whether the
 * model honoured a transparent background or painted the key colour.
 */
export function photoMask(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  key: KeyColour,
): Float32Array {
  const mask = new Float32Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    const o = i * 4;
    const alpha = rgba[o + 3];
    const clear = alpha < 250 ? 1 - alpha / 255 : 0;
    const keyed = smoothstep(KEY_LOW, KEY_HIGH, keyness(rgba[o], rgba[o + 1], rgba[o + 2], key));
    mask[i] = Math.max(clear, keyed);
  }
  return mask;
}

export type Region = {
  id: number;
  /** Pixel count. */
  area: number;
  /** Centre of the oriented rectangle that holds the whole region. */
  cx: number;
  cy: number;
  /** Radians, within (-π/4, π/4]; 0 for an upright or round window. */
  angle: number;
  /** Size of that rectangle along and across the angle. */
  width: number;
  height: number;
};

/**
 * Label the connected photo areas (4-connected, mask >= threshold). Returns
 * a label per pixel (0 = none) and each region's oriented rectangle, largest
 * first.
 */
export function findRegions(
  mask: Float32Array,
  width: number,
  height: number,
  threshold = 0.5,
): { labels: Int32Array; regions: Region[] } {
  const labels = new Int32Array(width * height);
  const stack: number[] = [];
  let next = 0;
  for (let start = 0; start < labels.length; start++) {
    if (labels[start] || mask[start] < threshold) continue;
    next += 1;
    labels[start] = next;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      const visit = (j: number) => {
        if (!labels[j] && mask[j] >= threshold) {
          labels[j] = next;
          stack.push(j);
        }
      };
      if (x > 0) visit(i - 1);
      if (x < width - 1) visit(i + 1);
      if (y > 0) visit(i - width);
      if (y < height - 1) visit(i + width);
    }
  }
  return { labels, regions: measureRegions(labels, next, width) };
}

function measureRegions(labels: Int32Array, count: number, width: number): Region[] {
  const n = new Float64Array(count + 1);
  const sx = new Float64Array(count + 1);
  const sy = new Float64Array(count + 1);
  for (let i = 0; i < labels.length; i++) {
    const id = labels[i];
    if (!id) continue;
    const x = (i % width) + 0.5;
    const y = Math.floor(i / width) + 0.5;
    n[id] += 1;
    sx[id] += x;
    sy[id] += y;
  }
  const mx = new Float64Array(count + 1);
  const my = new Float64Array(count + 1);
  for (let id = 1; id <= count; id++) {
    mx[id] = sx[id] / n[id];
    my[id] = sy[id] / n[id];
  }
  const cxx = new Float64Array(count + 1);
  const cyy = new Float64Array(count + 1);
  const cxy = new Float64Array(count + 1);
  for (let i = 0; i < labels.length; i++) {
    const id = labels[i];
    if (!id) continue;
    const dx = (i % width) + 0.5 - mx[id];
    const dy = Math.floor(i / width) + 0.5 - my[id];
    cxx[id] += dx * dx;
    cyy[id] += dy * dy;
    cxy[id] += dx * dy;
  }
  const angle = new Float64Array(count + 1);
  for (let id = 1; id <= count; id++) {
    const a = cxx[id] / n[id];
    const b = cyy[id] / n[id];
    const c = cxy[id] / n[id];
    const spread = Math.sqrt(((a - b) / 2) ** 2 + c * c);
    const major = (a + b) / 2 + spread;
    const minor = Math.max(1e-6, (a + b) / 2 - spread);
    let theta = 0.5 * Math.atan2(2 * c, a - b);
    while (theta > Math.PI / 4) theta -= Math.PI / 2;
    while (theta <= -Math.PI / 4) theta += Math.PI / 2;
    // Round or square windows, and a tilt too small to see, stay upright.
    if (major / minor < 1.15 && Math.abs(c) < 1e-6) theta = 0;
    if (Math.abs(theta) < (2 * Math.PI) / 180) theta = 0;
    angle[id] = theta;
  }
  const umin = new Float64Array(count + 1).fill(Infinity);
  const umax = new Float64Array(count + 1).fill(-Infinity);
  const vmin = new Float64Array(count + 1).fill(Infinity);
  const vmax = new Float64Array(count + 1).fill(-Infinity);
  for (let i = 0; i < labels.length; i++) {
    const id = labels[i];
    if (!id) continue;
    const dx = (i % width) + 0.5 - mx[id];
    const dy = Math.floor(i / width) + 0.5 - my[id];
    const cos = Math.cos(angle[id]);
    const sin = Math.sin(angle[id]);
    const u = dx * cos + dy * sin;
    const v = -dx * sin + dy * cos;
    if (u < umin[id]) umin[id] = u;
    if (u > umax[id]) umax[id] = u;
    if (v < vmin[id]) vmin[id] = v;
    if (v > vmax[id]) vmax[id] = v;
  }
  const regions: Region[] = [];
  for (let id = 1; id <= count; id++) {
    const cos = Math.cos(angle[id]);
    const sin = Math.sin(angle[id]);
    const mu = (umax[id] + umin[id]) / 2;
    const mv = (vmax[id] + vmin[id]) / 2;
    regions.push({
      id,
      area: n[id],
      cx: mx[id] + mu * cos - mv * sin,
      cy: my[id] + mu * sin + mv * cos,
      angle: angle[id],
      // Half a pixel either side, so the photo always reaches the edge.
      width: umax[id] - umin[id] + 1,
      height: vmax[id] - vmin[id] + 1,
    });
  }
  return regions.sort((a, b) => b.area - a.area);
}

export type PhotoTransform = {
  /** The part of the source photo that is shown, in source pixels. */
  crop: { left: number; top: number; width: number; height: number };
  /** Size the crop is drawn at before it is turned. */
  drawWidth: number;
  drawHeight: number;
  angle: number;
  /** Where the crop's centre lands on the canvas. */
  cx: number;
  cy: number;
  sourceWidth: number;
  sourceHeight: number;
};

/**
 * Cover-fit a photo to a window's rectangle, keeping its focus point in
 * view: the whole window is filled and nothing is stretched.
 */
export function fitPhoto(
  photo: { width: number; height: number },
  region: Pick<Region, "cx" | "cy" | "angle" | "width" | "height">,
  focus: { x: number; y: number },
): PhotoTransform {
  const drawWidth = Math.max(1, Math.ceil(region.width));
  const drawHeight = Math.max(1, Math.ceil(region.height));
  const scale = Math.max(drawWidth / photo.width, drawHeight / photo.height);
  const cropWidth = Math.min(photo.width, drawWidth / scale);
  const cropHeight = Math.min(photo.height, drawHeight / scale);
  const centreX = Math.min(
    photo.width - cropWidth / 2,
    Math.max(cropWidth / 2, focus.x * photo.width),
  );
  const centreY = Math.min(
    photo.height - cropHeight / 2,
    Math.max(cropHeight / 2, focus.y * photo.height),
  );
  return {
    crop: {
      left: Math.max(0, Math.round(centreX - cropWidth / 2)),
      top: Math.max(0, Math.round(centreY - cropHeight / 2)),
      width: Math.max(1, Math.min(photo.width, Math.round(cropWidth))),
      height: Math.max(1, Math.min(photo.height, Math.round(cropHeight))),
    },
    drawWidth,
    drawHeight,
    angle: region.angle,
    cx: region.cx,
    cy: region.cy,
    sourceWidth: photo.width,
    sourceHeight: photo.height,
  };
}

/** Where a point of the source photo (fractions 0..1) lands on the canvas. */
export function mapToCanvas(t: PhotoTransform, u: number, v: number): { x: number; y: number } {
  const sx = t.drawWidth / t.crop.width;
  const sy = t.drawHeight / t.crop.height;
  const dx = (u * t.sourceWidth - (t.crop.left + t.crop.width / 2)) * sx;
  const dy = (v * t.sourceHeight - (t.crop.top + t.crop.height / 2)) * sy;
  const cos = Math.cos(t.angle);
  const sin = Math.sin(t.angle);
  return { x: t.cx + dx * cos - dy * sin, y: t.cy + dx * sin + dy * cos };
}

/**
 * One window's area grown by `radius` pixels (0 or 255 per pixel), so its
 * photo also covers the soft edge the model drew around it, without
 * reaching into a neighbouring window.
 */
export function windowAlpha(
  labels: Int32Array,
  id: number,
  width: number,
  height: number,
  radius = 3,
): Uint8Array {
  const across = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let last = -Infinity;
    for (let x = 0; x < width; x++) {
      if (labels[row + x] === id) last = x;
      if (x - last <= radius) across[row + x] = 1;
    }
    last = Infinity;
    for (let x = width - 1; x >= 0; x--) {
      if (labels[row + x] === id) last = x;
      if (last - x <= radius) across[row + x] = 1;
    }
  }
  const out = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    let last = -Infinity;
    for (let y = 0; y < height; y++) {
      if (across[y * width + x]) last = y;
      if (y - last <= radius) out[y * width + x] = 255;
    }
    last = Infinity;
    for (let y = height - 1; y >= 0; y--) {
      if (across[y * width + x]) last = y;
      if (last - y <= radius) out[y * width + x] = 255;
    }
  }
  return out;
}

/** Pull key-colour fringe out of a design pixel that is partly see-through. */
function despill(r: number, g: number, b: number, key: KeyColour): [number, number, number] {
  if (key.name === "green") return [r, Math.min(g, Math.max(r, b)), b];
  const spill = Math.max(0, Math.min(r, b) - g);
  return [r - spill, g, b - spill];
}

/**
 * The design layer alone, see-through wherever the photo (or video) shows:
 * for laying over moving footage, where nothing can be composited by pixel.
 */
export function layerOverlay(
  design: Uint8Array | Uint8ClampedArray,
  mask: Float32Array,
  key: KeyColour,
): Uint8Array {
  const out = new Uint8Array(mask.length * 4);
  for (let i = 0; i < mask.length; i++) {
    const d = i * 4;
    let [r, g, b] = [design[d], design[d + 1], design[d + 2]];
    if (mask[i] > 0 && mask[i] < 1) [r, g, b] = despill(r, g, b, key);
    out[d] = r;
    out[d + 1] = g;
    out[d + 2] = b;
    out[d + 3] = Math.round((1 - mask[i]) * Math.min(255, design[d + 3]));
  }
  return out;
}

/**
 * The finished picture: the design layer over the real photos, over a soft
 * fill made from the design itself (for stray key-coloured specks no photo
 * covers). Inside a window the person's photo shows through unchanged.
 */
export function compositeLayers(args: {
  width: number;
  height: number;
  design: Uint8Array | Uint8ClampedArray;
  /** The placed photos, RGBA at canvas size; alpha 0 where no photo is. */
  photos: Uint8Array | Uint8ClampedArray;
  /** RGB(A) fill at canvas size, used where neither covers a pixel. */
  fill: Uint8Array | Uint8ClampedArray;
  fillChannels: 3 | 4;
  mask: Float32Array;
  key: KeyColour;
}): Uint8Array {
  const { width, height, design, photos, fill, mask, key } = args;
  const out = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const d = i * 4;
    const f = i * args.fillChannels;
    const photoAlpha = photos[d + 3] / 255;
    const under = [0, 1, 2].map((c) => photos[d + c] * photoAlpha + fill[f + c] * (1 - photoAlpha));
    const show = mask[i];
    let [r, g, b] = [design[d], design[d + 1], design[d + 2]];
    if (show > 0 && show < 1) [r, g, b] = despill(r, g, b, key);
    const o = i * 3;
    out[o] = Math.round(r * (1 - show) + under[0] * show);
    out[o + 1] = Math.round(g * (1 - show) + under[1] * show);
    out[o + 2] = Math.round(b * (1 - show) + under[2] * show);
  }
  return out;
}

/**
 * Fraction of sample points (canvas pixels) that still show photo. Points off
 * the canvas were cropped away, not covered, so they don't count.
 */
export function visibleShare(
  mask: Float32Array,
  width: number,
  height: number,
  points: { x: number; y: number }[],
): number {
  let seen = 0;
  let counted = 0;
  for (const point of points) {
    const x = Math.floor(point.x);
    const y = Math.floor(point.y);
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    counted += 1;
    if (mask[y * width + x] >= 0.5) seen += 1;
  }
  return counted ? seen / counted : 1;
}
