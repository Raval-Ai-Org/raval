// wix-seo.ts — read and change one head tag in a Wix item's SEO tag list.
//
// Wix keeps a page's or blog post's own head tags as a list of
// { type, props, children } and replaces the whole list on every write, so a
// change is always: read the list, swap one tag, send the full list back.
// A field is addressed by a key:
//
//   title                         <title>
//   meta:name:description         <meta name="description">
//   meta:name:robots              <meta name="robots"> (boolean: noindex)
//   meta:property:og:title        <meta property="og:title">
//   meta:property:og:description  <meta property="og:description">
//   link:rel:canonical            <link rel="canonical">
//   script:jsonld                 <script type="application/ld+json">
//
// Pure and browser-safe.

export type WixSeoTag = {
  type: string;
  props?: Record<string, string>;
  children?: string;
  custom?: boolean;
  disabled?: boolean;
};

export const WIX_SEO_KEYS = {
  title: "title",
  description: "meta:name:description",
  robots: "meta:name:robots",
  ogTitle: "meta:property:og:title",
  ogDescription: "meta:property:og:description",
  canonical: "link:rel:canonical",
  jsonld: "script:jsonld",
} as const;

export type WixSeoKey = (typeof WIX_SEO_KEYS)[keyof typeof WIX_SEO_KEYS];

const KEYS = new Set<string>(Object.values(WIX_SEO_KEYS));
export const isWixSeoKey = (k: string): k is WixSeoKey => KEYS.has(k);

const JSONLD = "application/ld+json";

function matches(tag: WixSeoTag, key: WixSeoKey): boolean {
  if (tag.disabled) return false;
  const p = tag.props ?? {};
  switch (key) {
    case "title":
      return tag.type === "title";
    case "meta:name:description":
    case "meta:name:robots":
      return tag.type === "meta" && (p.name ?? "").toLowerCase() === key.split(":")[2];
    case "meta:property:og:title":
    case "meta:property:og:description":
      return tag.type === "meta" && (p.property ?? "").toLowerCase() === key.slice(14);
    case "link:rel:canonical":
      return tag.type === "link" && (p.rel ?? "").toLowerCase() === "canonical";
    case "script:jsonld":
      return tag.type === "script" && (p.type ?? "").toLowerCase() === JSONLD;
  }
}

function valueOf(tag: WixSeoTag, key: WixSeoKey): string {
  const p = tag.props ?? {};
  if (key === "title" || key === "script:jsonld") return tag.children ?? "";
  if (key === "link:rel:canonical") return p.href ?? "";
  return p.content ?? "";
}

/** The field's value in a tag list, or null when the list doesn't set it. */
export function readWixTag(tags: readonly WixSeoTag[], key: WixSeoKey): string | boolean | null {
  const tag = tags.find((t) => matches(t, key));
  if (!tag) return null;
  const v = valueOf(tag, key);
  return key === "meta:name:robots" ? /\bnoindex\b/i.test(v) : v;
}

function build(key: WixSeoKey, value: string | boolean): WixSeoTag {
  switch (key) {
    case "title":
      return { type: "title", children: String(value) };
    case "script:jsonld":
      return { type: "script", props: { type: JSONLD }, children: String(value) };
    case "link:rel:canonical":
      return { type: "link", props: { rel: "canonical", href: String(value) } };
    case "meta:name:robots":
      return { type: "meta", props: { name: "robots", content: value ? "noindex" : "index" } };
    case "meta:name:description":
      return { type: "meta", props: { name: "description", content: String(value) } };
    case "meta:property:og:title":
    case "meta:property:og:description":
      return { type: "meta", props: { property: key.slice(14), content: String(value) } };
  }
}

/**
 * The complete list with one field changed. `null` (or "") removes the
 * item's own tag so the page falls back to what Wix would show anyway.
 * Every other tag is kept exactly as it was.
 */
export function writeWixTag(
  tags: readonly WixSeoTag[],
  key: WixSeoKey,
  value: string | boolean | null,
): WixSeoTag[] {
  const rest = tags.filter((t) => !matches(t, key));
  if (value === null || value === "") return rest;
  const at = tags.findIndex((t) => matches(t, key));
  const next = build(key, value);
  if (at < 0) return [...rest, next];
  const out = [...tags];
  out.splice(at, 1, next);
  return out.filter((t, i) => i === at || !matches(t, key));
}

/** JSON-LD text without a surrounding <script> tag (Wix wants the payload only). */
export function jsonLdPayload(value: string): string {
  return value
    .replace(/^\s*<script[^>]*>/i, "")
    .replace(/<\/script>\s*$/i, "")
    .trim();
}

const hostPath = (url: string) => {
  try {
    const u = new URL(url);
    return {
      host: u.hostname.replace(/^www\./, "").toLowerCase(),
      path: u.pathname.replace(/\/+$/, "") || "/",
    };
  } catch {
    return null;
  }
};

/**
 * Which static page a URL is, from the canonical link (or og:url) each page's
 * resolved tags render. Only an exact match counts; anything else is null.
 */
export function matchStaticPage(
  items: readonly {
    itemId?: string;
    resolvedTags?: readonly { tag: WixSeoTag }[];
    tags?: readonly WixSeoTag[];
  }[],
  url: string,
  hosts: readonly string[] = [],
): string | null {
  const want = hostPath(url);
  if (!want) return null;
  // The canonical may name the site's primary domain while the scan used another of its hosts.
  const siteHosts = new Set([
    want.host,
    ...hosts.map((h) => h.replace(/^www\./, "").toLowerCase()),
  ]);
  const hits = new Set<string>();
  for (const item of items) {
    if (!item.itemId) continue;
    const all = [...(item.tags ?? []), ...(item.resolvedTags ?? []).map((r) => r.tag)];
    for (const t of all) {
      const href =
        t.type === "link" && (t.props?.rel ?? "").toLowerCase() === "canonical"
          ? t.props?.href
          : t.type === "meta" && (t.props?.property ?? "").toLowerCase() === "og:url"
            ? t.props?.content
            : null;
      const n = href ? hostPath(href) : null;
      if (n && siteHosts.has(n.host) && n.path === want.path) hits.add(item.itemId);
    }
  }
  return hits.size === 1 ? [...hits][0] : null;
}

/** A Wix Blog post's slug from its live URL (`/post/<slug>`, also under a language prefix). */
export function wixPostSlug(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const i = parts.indexOf("post");
    const slug = i >= 0 ? parts[i + 1] : undefined;
    return slug && i + 2 === parts.length ? decodeURIComponent(slug) : null;
  } catch {
    return null;
  }
}
