// The brand's own photos and screenshots on carousel slides: which slide shows
// which picture and in what frame. A case study shows the real work, so the
// pictures are placed by code exactly as they are, never redrawn. Pure and
// browser-safe: the runner, the renderer and the preview all read it.
import type { CarouselSlide } from "../jobs";

/** Most pictures one carousel holds. */
export const MAX_SLIDE_PHOTOS = 6;

/**
 * How a picture is framed. Screens always sit in a device, never raw: a tall
 * screenshot in a phone, a wide one in a browser window; a photo is a card,
 * or the whole slide on the cover.
 */
export type PhotoFrame = "phone" | "browser" | "photo";

/** Width / height of a screen's window in its frame; screenshots are cut to it, top first. */
export const SCREEN_ASPECT = { phone: 0.5, browser: 1.6 } as const;

export type SlidePhoto = {
  /** Workspace storage path, checked against the job's workspace. */
  path: string;
  width: number;
  height: number;
  frame: PhotoFrame;
  /** Short-lived signed link for the preview, added on every read. Never stored. */
  url?: string;
};

/** The frame for a picture, from its shape and whether it is a screen capture. */
export function photoFrame(size: { width: number; height: number }, screen: boolean): PhotoFrame {
  const tall = size.height / Math.max(1, size.width);
  if (screen) return tall > 1.25 ? "phone" : "browser";
  // A very tall picture that nobody marked is almost always a phone screenshot.
  return tall > 1.9 ? "phone" : "photo";
}

/**
 * Give the pictures to slides in order: the first to the cover, the rest to
 * the middle slides. The closing slide stays type-only, so the action reads.
 * A picture with no free slide is left out.
 */
export function assignPhotos(slides: CarouselSlide[], photoCount: number): CarouselSlide[] {
  const count = Math.min(photoCount, MAX_SLIDE_PHOTOS);
  let next = 0;
  return slides.map((slide, i) => {
    const { photo: _old, ...rest } = slide;
    const last = i === slides.length - 1 && slides.length > 1;
    if (last || next >= count) return rest;
    return { ...rest, photo: next++ };
  });
}

/** A stored photo list is user-editable meta: only well-formed rows survive. */
export function safePhotos(raw: unknown): SlidePhoto[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_SLIDE_PHOTOS)
    .map((item) => {
      const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      const width = Number(row.width);
      const height = Number(row.height);
      const frame = (["phone", "browser", "photo"] as const).find((f) => f === row.frame);
      if (typeof row.path !== "string" || !row.path || !frame) return null;
      if (!(width > 0 && height > 0 && width < 20_000 && height < 60_000)) return null;
      return { path: row.path, width, height, frame };
    })
    .filter((p): p is SlidePhoto => !!p);
}
