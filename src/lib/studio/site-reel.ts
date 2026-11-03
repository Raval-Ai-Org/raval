// "From my website": a short, silent reel of the brand's own site scrolling
// inside a device, the way agencies show a website they built. Pure and
// browser-safe: the render (clip-edit/render.server.ts) and the tests read
// it. The capture is never redrawn; code frames it and FFmpeg scrolls it.
//
// Measured on the reference reels: 4:5 at 720×900, no cuts, a hold → move →
// hold beat every 1.5 to 2 seconds, and the last frame is the first, so the
// feed's loop is seamless.

export type SiteCapture = { assetId: string; label: string; mobile: boolean; thumb: string | null };

/** Full-page captures of the brand's site (Inspo → Media), newest first, one per page and device. */
export function siteCaptures(
  sources: {
    asset_id: string;
    kind: string;
    status: string;
    label: string;
    region: Record<string, unknown>;
    created_at: string;
    asset?: { mime_type: string; url?: string; thumbnailUrl?: string };
  }[],
): SiteCapture[] {
  const seen = new Set<string>();
  return sources
    .filter(
      (s) =>
        s.kind === "website" &&
        s.status !== "removed" &&
        s.region.type === "full" &&
        !!s.asset?.mime_type.startsWith("image/"),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .filter((s) => {
      const key = `${s.label}|${!!s.region.mobile}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((s) => ({
      assetId: s.asset_id,
      label: s.label,
      mobile: !!s.region.mobile,
      thumb: s.asset?.thumbnailUrl || s.asset?.url || null,
    }));
}

export type SiteDevice = "phone" | "browser";
export type Rect = { x: number; y: number; w: number; h: number };

/** How long the reel rests on each part of the page. */
export const SITE_HOLD_SECONDS = 1;
/** How long one eased scroll between two parts takes. */
export const SITE_EASE_SECONDS = 1.2;
export const MIN_SITE_STOPS = 3;
export const MAX_SITE_STOPS = 5;
/** Only the first few screens are shown: a reel is a taste, not the whole page. */
export const MAX_SITE_SCREENS = 6;

/** A capture taken on a phone (or any narrow page) shows in a phone. */
export function siteDevice(captureWidth: number): SiteDevice {
  return captureWidth < 900 ? "phone" : "browser";
}

/**
 * Where the device and its screen sit on the canvas, centred, with room
 * around it for the brand's background. Whole pixels and even sizes, so the
 * FFmpeg crop matches exactly.
 */
export function siteFrame(
  canvas: { width: number; height: number },
  device: SiteDevice,
): { device: Rect; screen: Rect; radius: number; bar: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  if (device === "phone") {
    const h = even(canvas.height * 0.84);
    const w = even(Math.min(canvas.width * 0.62, h * 0.49));
    const bezel = even(w * 0.035);
    const x = even((canvas.width - w) / 2);
    const y = even((canvas.height - h) / 2);
    return {
      device: { x, y, w, h },
      screen: { x: x + bezel, y: y + bezel, w: w - bezel * 2, h: h - bezel * 2 },
      radius: Math.round(w * 0.12),
      bar: 0,
    };
  }
  const w = even(canvas.width * 0.88);
  const h = even(Math.min(canvas.height * 0.8, w * 1.15));
  const bar = even(w * 0.06);
  const x = even((canvas.width - w) / 2);
  const y = even((canvas.height - h) / 2);
  return {
    device: { x, y, w, h },
    screen: { x, y: y + bar, w, h: h - bar },
    radius: Math.round(w * 0.025),
    bar,
  };
}

/**
 * Where the reel stops, as offsets from the top of the page (in the page's
 * pixels once scaled to the screen width). The top first, then evenly down
 * the first few screens. Empty when the page is too short to scroll.
 */
export function siteStops(pageHeight: number, screenHeight: number): number[] {
  const usable = Math.min(pageHeight, screenHeight * MAX_SITE_SCREENS);
  const travel = Math.floor(usable - screenHeight);
  if (travel < screenHeight * 0.5) return [];
  const count = Math.max(
    MIN_SITE_STOPS,
    Math.min(MAX_SITE_STOPS, Math.round(travel / screenHeight) + 1),
  );
  return Array.from({ length: count }, (_, i) => Math.round((travel * i) / (count - 1)));
}

export type ScrollSegment = { start: number; end: number; from: number; to: number };

/**
 * Hold, ease, hold... then ease back to the top, so the reel ends on its
 * first frame. Every segment either holds (`from === to`) or eases.
 */
export function siteTimeline(stops: number[]): { segments: ScrollSegment[]; total: number } {
  const segments: ScrollSegment[] = [];
  let t = 0;
  const add = (seconds: number, from: number, to: number) => {
    segments.push({ start: round(t), end: round(t + seconds), from, to });
    t += seconds;
  };
  const path = [...stops, ...(stops.length > 1 ? [stops[0]] : [])];
  path.forEach((y, i) => {
    if (i > 0) add(SITE_EASE_SECONDS, path[i - 1], y);
    if (i < path.length - 1) add(SITE_HOLD_SECONDS, y, y);
  });
  return { segments, total: round(t) };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** The page offset at a time: the same numbers FFmpeg gets as an expression. */
export function scrollAt(segments: ScrollSegment[], t: number): number {
  const segment = segments.find((s) => t < s.end) ?? segments[segments.length - 1];
  if (!segment) return 0;
  const p = Math.min(1, Math.max(0, (t - segment.start) / (segment.end - segment.start)));
  return segment.from + (segment.to - segment.from) * p * p * (3 - 2 * p);
}

/**
 * The scroll as an FFmpeg expression of `t` (for crop's y): one eased
 * (smoothstep) piece per segment, nested so each applies until it ends.
 */
export function scrollExpression(segments: ScrollSegment[]): string {
  if (!segments.length) return "0";
  const piece = (s: ScrollSegment) => {
    if (s.from === s.to) return String(s.from);
    const p = `clip((t-${s.start})/${round(s.end - s.start)},0,1)`;
    return `${s.from}+(${s.to - s.from})*${p}*${p}*(3-2*${p})`;
  };
  return segments
    .slice(0, -1)
    .reduceRight(
      (rest, s) => `if(lt(t,${s.end}),${piece(s)},${rest})`,
      piece(segments[segments.length - 1]),
    );
}
