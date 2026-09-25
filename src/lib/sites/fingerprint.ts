// fingerprint.ts — what platform serves a live page, read from its own HTML.
//
// Webflow and WordPress both stamp identifiers into every page they render:
//
//   Webflow    <html data-wf-site="<siteId>" data-wf-page="<pageId>">, plus
//              data-wf-collection / data-wf-item-slug on CMS template pages
//   WordPress  <link rel="https://api.w.org/" href="<site>/wp-json/"> and
//              <link rel="alternate" type="application/json"
//                    href="<site>/wp-json/wp/v2/posts/123">
//
// Those ids are the proof that a connected CMS site really is the scanned
// host (a site id from the provider's API must equal the one the live page
// carries), and they map a page URL to the object Mellox would change.
// Pure; browser-safe.

export type WordPressObjectRef = { type: "post" | "page"; id: number };

export type PageFingerprint = {
  platform: "webflow" | "wordpress" | null;
  /**
   * The site shows visitors a placeholder (WordPress.com "Coming soon",
   * a maintenance page): crawlers and AI engines can't see its content.
   */
  placeholder: boolean;
  webflow: {
    siteId: string | null;
    pageId: string | null;
    collectionId: string | null;
    itemSlug: string | null;
  } | null;
  wordpress: {
    /** Absolute REST root the page advertises (…/wp-json/). */
    apiRoot: string | null;
    object: WordPressObjectRef | null;
    generator: string | null;
  } | null;
};

const WF_ID = /^[a-f0-9]{24}$/i;

function htmlTag(html: string): string {
  return /<html\b[^>]*>/i.exec(html)?.[0] ?? "";
}

function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\s${name}\\s*=\\s*(["'])([^"']*)\\1`, "i");
  return re.exec(tag)?.[2]?.trim() || null;
}

function linkTags(html: string): string[] {
  return (html.match(/<link\b[^>]*>/gi) ?? []).slice(0, 200);
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#0?38;/g, "&")
    .replace(/&#x2F;/gi, "/");
}

/** The WordPress object a page represents, from its REST alternate link, shortlink or body class. */
export function wordpressObjectFromHtml(html: string): WordPressObjectRef | null {
  for (const tag of linkTags(html)) {
    if (!/rel\s*=\s*["']alternate["']/i.test(tag)) continue;
    if (!/application\/json/i.test(tag)) continue;
    const href = decodeEntities(attr(tag, "href") ?? "");
    const m = /\/wp\/v2\/(posts|pages)\/(\d{1,12})(?:[/?#]|$)/.exec(href);
    if (m) return { type: m[1] === "posts" ? "post" : "page", id: Number(m[2]) };
  }
  for (const tag of linkTags(html)) {
    if (!/rel\s*=\s*["']shortlink["']/i.test(tag)) continue;
    const href = decodeEntities(attr(tag, "href") ?? "");
    const page = /[?&]page_id=(\d{1,12})/.exec(href);
    if (page) return { type: "page", id: Number(page[1]) };
    const post = /[?&]p=(\d{1,12})/.exec(href);
    if (post) return { type: "post", id: Number(post[1]) };
  }
  const body = /<body\b[^>]*\bclass\s*=\s*(["'])([^"']*)\1/i.exec(html)?.[2] ?? "";
  const pageId = /(?:^|\s)page-id-(\d{1,12})(?:\s|$)/.exec(body);
  if (pageId) return { type: "page", id: Number(pageId[1]) };
  const postId = /(?:^|\s)postid-(\d{1,12})(?:\s|$)/.exec(body);
  if (postId) return { type: "post", id: Number(postId[1]) };
  return null;
}

const PLACEHOLDER =
  /<body\b[^>]*class\s*=\s*["'][^"']*\b(wpcom-coming-soon-body|coming-soon|maintenance-mode)\b/i;

export function fingerprintPage(html: string): PageFingerprint {
  const tag = htmlTag(html);
  const placeholder = PLACEHOLDER.test(html);
  const wfSite = attr(tag, "data-wf-site");
  const wfPage = attr(tag, "data-wf-page");
  if (wfSite && WF_ID.test(wfSite)) {
    const collection = attr(tag, "data-wf-collection");
    return {
      platform: "webflow",
      placeholder,
      webflow: {
        siteId: wfSite.toLowerCase(),
        pageId: wfPage && WF_ID.test(wfPage) ? wfPage.toLowerCase() : null,
        collectionId: collection && WF_ID.test(collection) ? collection.toLowerCase() : null,
        itemSlug: attr(tag, "data-wf-item-slug"),
      },
      wordpress: null,
    };
  }
  let apiRoot: string | null = null;
  for (const t of linkTags(html)) {
    if (/rel\s*=\s*["']https:\/\/api\.w\.org\/["']/i.test(t)) {
      apiRoot = decodeEntities(attr(t, "href") ?? "") || null;
      break;
    }
  }
  const generatorTag = (html.match(/<meta\b[^>]*name\s*=\s*["']generator["'][^>]*>/gi) ?? []).find(
    (m) => /wordpress/i.test(m),
  );
  const generator = generatorTag ? attr(generatorTag, "content") : null;
  if (apiRoot || generator) {
    return {
      platform: "wordpress",
      placeholder,
      webflow: null,
      wordpress: { apiRoot, object: wordpressObjectFromHtml(html), generator },
    };
  }
  return { platform: null, placeholder, webflow: null, wordpress: null };
}

/** Host of a REST root / site URL without `www.`, or null. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const value = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(value).hostname
      .toLowerCase()
      .replace(/^www\./, "")
      .replace(/\.$/, "");
  } catch {
    return null;
  }
}
