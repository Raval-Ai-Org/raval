// whatsapp.ts — the brand's own WhatsApp chat link (Round 9, context pack).
// Pure and browser-safe. The number only ever comes from the brand's profile
// (Brand DNA socials, filled by the scan or the person); nothing is added for
// a brand without one, and the number is never invented or reformatted into
// another person's.

const WA =
  /^(?:https?:\/\/)?(?:wa\.me\/|(?:api\.|web\.)?whatsapp\.com\/(?:send\/?\?(?:[^#]*&)?phone=|message\/))([+\d][\d\s-]{6,20}|[A-Z0-9]{6,20})/i;

/** The brand's WhatsApp chat link, normalised to https://wa.me/…, or null. */
export function whatsAppLink(socials: unknown): string | null {
  if (!Array.isArray(socials)) return null;
  for (const s of socials) {
    const url = typeof s?.url === "string" ? s.url.trim() : "";
    const platform = typeof s?.platform === "string" ? s.platform.toLowerCase() : "";
    const m = WA.exec(url);
    if (m) {
      const id = m[1].replace(/[\s+-]/g, "");
      return /^\d{7,15}$/.test(id)
        ? `https://wa.me/${id}`
        : /^[A-Z0-9]{6,20}$/i.test(id)
          ? `https://wa.me/message/${id}`
          : null;
    }
    if (platform === "whatsapp") {
      const digits = url.replace(/[^\d]/g, "");
      if (/^\d{7,15}$/.test(digits)) return `https://wa.me/${digits}`;
    }
  }
  return null;
}

/** Networks where a link in the caption can't be tapped. */
const NO_CAPTION_LINKS = new Set(["instagram", "tiktok"]);

/** One line for a writer: how people reach the brand on WhatsApp, per network. */
export function whatsAppLine(link: string | null, platforms: readonly string[]): string | null {
  if (!link) return null;
  const tappable = platforms.filter((p) => !NO_CAPTION_LINKS.has(p));
  return tappable.length
    ? `When the post asks people to get in touch, the easiest step is a WhatsApp chat: ${link} (use this exact link; on Instagram and TikTok say "message us on WhatsApp, link in bio").`
    : `When the post asks people to get in touch, say "message us on WhatsApp (link in bio)"; never paste the number.`;
}
