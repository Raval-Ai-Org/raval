// site-elements.ts — the pictures a brand's own website really shows (a
// mascot, an anime character, an astronaut, a hero illustration or object),
// kept as Inspo → Media "Site art" so posts, carousels, ads and videos can
// use them. Pure and browser-safe: which page pictures count, what they are
// called and where they live. The website read downloads them (only through
// the SSRF-guarded fetcher) and saves them once.

/** The Media folder site art is filed in by itself. A person may move it. */
export const SITE_ART_FOLDER = "From your website";
/** At most this many pictures are kept from one website read. */
export const MAX_SITE_ELEMENTS = 10;
/** Smallest side, in real pixels, worth designing with. */
export const MIN_ELEMENT_SIDE = 320;

export type PageElement = {
  url: string;
  alt?: string;
  /** Size on the page (CSS pixels). */
  width: number;
  height: number;
};

// Logos, icons, payment marks, trackers and loaders are never artwork.
const NOT_ART =
  /(logo|icon|favicon|sprite|avatar|badge|flag|payment|visa|mastercard|paypal|amex|placeholder|spinner|loader|loading|pixel|tracking|analytics|emoji|arrow|chevron|star-rating|rating|qr[-_]?code|apple-touch)/i;

/** A page picture big enough and plain enough to be the brand's artwork. */
export function isElementCandidate(el: PageElement): boolean {
  if (!/^https?:\/\//i.test(el.url)) return false;
  if (/\.(svg|gif|ico)(\?|#|$)/i.test(el.url)) return false;
  if (NOT_ART.test(el.url) || NOT_ART.test(el.alt ?? "")) return false;
  if (el.width < 220 || el.height < 220) return false;
  const ratio = el.width / el.height;
  return ratio >= 0.3 && ratio <= 3.4;
}

/** The picture's real pixels are big enough and not a thin banner. */
export function elementFits(meta: { width?: number; height?: number }): boolean {
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (Math.min(w, h) < MIN_ELEMENT_SIDE) return false;
  const ratio = w / h;
  return ratio >= 0.3 && ratio <= 3.4;
}

/** Same picture at another size (`hero-800.jpg`, `?w=1200`): one key. */
export function elementKey(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname
      .toLowerCase()
      .replace(/[-_@](\d{2,4}w?|\d{2,4}x\d{2,4}|[123]x)(?=\.[a-z0-9]+$)/, "")
      .replace(/\.(jpe?g|png|webp|avif)$/, "");
    return `${u.hostname.replace(/^www\./, "")}${path}`;
  } catch {
    return url;
  }
}

/**
 * The pictures to keep from one page, biggest first, one per picture,
 * skipping keys already kept (`seen`).
 */
export function pickSiteElements(
  elements: readonly PageElement[],
  opts: { seen?: ReadonlySet<string>; max?: number } = {},
): PageElement[] {
  const max = Math.max(0, opts.max ?? MAX_SITE_ELEMENTS);
  const keys = new Set(opts.seen ?? []);
  const out: PageElement[] = [];
  for (const el of [...elements].sort((a, b) => b.width * b.height - a.width * a.height)) {
    if (out.length >= max) break;
    if (!isElementCandidate(el)) continue;
    const key = elementKey(el.url);
    if (keys.has(key)) continue;
    keys.add(key);
    out.push(el);
  }
  return out;
}

/** The person-readable name: the alt text, else a tidy file name. */
export function elementLabel(el: PageElement): string {
  const alt = (el.alt ?? "").replace(/\s+/g, " ").trim();
  if (alt.length >= 3) return alt.slice(0, 100);
  try {
    const file = decodeURIComponent(new URL(el.url).pathname.split("/").pop() ?? "");
    const name = file
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\b[0-9a-f]{8,}\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (name.length >= 3 && /[a-z]/i.test(name)) return `Site art · ${name.slice(0, 80)}`;
  } catch {
    /* A broken URL still gets a name. */
  }
  return "Site art";
}
