// Tracked links (Round 9, flag FEATURE_FLAG_TRACKED_LINKS_ENABLED). Pure.
// A link to the brand's own site in a caption becomes a short Mellox link on
// networks where links can be clicked, so clicks are counted as measured.
// Instagram and TikTok captions can't be clicked: those keep the real link.

/** Networks whose captions carry clickable links. */
export const CLICKABLE_PLATFORMS = new Set([
  "facebook",
  "linkedin",
  "x",
  "twitter",
  "threads",
  "pinterest",
  "youtube",
  "bluesky",
]);

const URL_IN_TEXT = /https:\/\/[^\s<>"')\]]+/g;
/** Sentence punctuation that ends a link in running text. */
const TRAILING = /[.,;:!?]+$/;

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
};

/**
 * The https links in a caption that point at the brand's own site (the host
 * or a subdomain of it), each once, in order.
 */
export function ownLinks(text: string, website: string | null | undefined): string[] {
  const site = website
    ? hostOf(/^https?:\/\//.test(website) ? website : `https://${website}`)
    : null;
  if (!site) return [];
  const out: string[] = [];
  for (const raw of text.match(URL_IN_TEXT) ?? []) {
    const url = raw.replace(TRAILING, "");
    const host = hostOf(url);
    if (!host || (host !== site && !host.endsWith(`.${site}`))) continue;
    if (url.length > 2000 || out.includes(url)) continue;
    out.push(url);
  }
  return out;
}

/** The caption with each tracked link swapped for its short link (exact matches only). */
export function swapLinks(text: string, short: ReadonlyMap<string, string>): string {
  return text.replace(URL_IN_TEXT, (raw) => {
    const url = raw.replace(TRAILING, "");
    const to = short.get(url);
    return to ? to + raw.slice(url.length) : raw;
  });
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** A short random slug (8 characters, no look-alike letters) from the given random bytes. */
export function slugFrom(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[(bytes[i] ?? 0) % ALPHABET.length];
  return out;
}

/** A link preview or crawler: sent on, never counted as a click. */
export function isLinkBot(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? "").toLowerCase();
  if (!ua) return true;
  return /bot|crawl|spider|preview|facebookexternalhit|slurp|embedly|whatsapp|telegram|discord|skype|vkshare|bitly|curl|wget|python|headless/.test(
    ua,
  );
}
