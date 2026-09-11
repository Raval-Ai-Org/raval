// Pure HTML/URL helpers shared by every crawler (Brand DNA extraction, GEO
// audit, competitor snapshots). No I/O — fetching goes through
// src/server/safe-fetch.ts. Regex-based by design: these run on untrusted,
// often malformed markup where a DOM parser buys little.

/** Accept "example.com" as well as full URLs; defaults to https. */
export function normalizeUrl(raw: string) {
  const trimmed = raw.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function absoluteUrl(href: string | null | undefined, base: URL): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

export function stripHtml(html: string, max = 8000) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function pickAll(html: string, re: RegExp): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(re)) if (m[1]) out.push(m[1].trim());
  return out;
}

export function extractMeta(html: string) {
  const metas: Record<string, string> = {};
  const re = /<meta[^>]+(?:name|property|itemprop)=["']([^"']+)["'][^>]+content=["']([^"']*)["']/gi;
  for (const m of html.matchAll(re)) metas[m[1].toLowerCase()] = m[2];
  const re2 =
    /<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property|itemprop)=["']([^"']+)["']/gi;
  for (const m of html.matchAll(re2)) metas[m[2].toLowerCase()] = m[1];
  return metas;
}

export function extractJsonLd(html: string): any[] {
  const out: any[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {}
  }
  return out;
}

export function extractColors(html: string): string[] {
  const hexes = new Set<string>();
  for (const m of html.matchAll(/#([0-9a-f]{6})\b/gi)) {
    const hex = `#${m[1].toLowerCase()}`;
    // Skip pure white/black/greys
    if (/^#(fff(fff)?|000(000)?|[0-9a-f])\1{2,5}$/i.test(hex)) continue;
    hexes.add(hex);
  }
  // Frequency count
  const counts: Record<string, number> = {};
  const re = /#([0-9a-f]{6})\b/gi;
  for (const m of html.matchAll(re)) {
    const hex = `#${m[1].toLowerCase()}`;
    counts[hex] = (counts[hex] || 0) + 1;
  }
  return Array.from(hexes)
    .sort((a, b) => (counts[b] || 0) - (counts[a] || 0))
    .slice(0, 12);
}

export function extractFonts(html: string): string[] {
  const fonts = new Set<string>();
  // Google Fonts links
  for (const m of html.matchAll(/fonts\.googleapis\.com\/css2?\?family=([^&"'>]+)/gi)) {
    const fam = decodeURIComponent(m[1]).split(/[:&]/)[0].replace(/\+/g, " ");
    if (fam) fonts.add(fam);
  }
  // font-family CSS declarations
  for (const m of html.matchAll(/font-family\s*:\s*([^;"}<]+)/gi)) {
    const first = m[1].split(",")[0].replace(/['"]/g, "").trim();
    if (
      first &&
      !/^(inherit|initial|unset|sans-serif|serif|monospace|system-ui|-apple-system)$/i.test(first)
    ) {
      fonts.add(first);
    }
  }
  return Array.from(fonts).slice(0, 6);
}

export function extractInternalLinks(html: string, base: URL): string[] {
  const links = new Set<string>();
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)) {
    const abs = absoluteUrl(m[1], base);
    if (!abs) continue;
    try {
      const u = new URL(abs);
      if (u.hostname === base.hostname) links.add(u.toString().split("#")[0]);
    } catch {}
  }
  return Array.from(links);
}

export function parseSitemapUrls(xml: string, base: URL, limit = 30): string[] {
  if (!xml) return [];
  const urls: string[] = [];
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/gi)) {
    try {
      const u = new URL(m[1].trim());
      if (u.hostname === base.hostname) urls.push(u.toString());
    } catch {}
    if (urls.length >= limit) break;
  }
  return urls;
}
