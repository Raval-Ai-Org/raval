// site-screenshot.ts — public screenshot services for a website preview.
//
// Screenshots, not iframes: most sites refuse embedding via X-Frame-Options or
// frame-ancestors. Each service is tried in order; callers fall through to the
// next on an image error.

export function screenshotProviders(siteUrl: string): string[] {
  const enc = encodeURIComponent(siteUrl);
  return [
    `https://api.microlink.io/?url=${enc}&screenshot=true&meta=false&embed=screenshot.url&viewport.width=1280&viewport.height=800&waitUntil=networkidle0`,
    `https://image.thum.io/get/width/1280/crop/800/noanimate/${siteUrl}`,
    `https://s.wordpress.com/mshots/v1/${enc}?w=1280&h=800`,
  ];
}

/** A favicon-sized mark for a domain; the last-resort preview. */
export function faviconFor(siteUrl: string, size = 256): string {
  const bare = siteUrl.replace(/^https?:\/\//i, "").split("/")[0];
  return `https://www.google.com/s2/favicons?domain=${bare}&sz=${size}`;
}
