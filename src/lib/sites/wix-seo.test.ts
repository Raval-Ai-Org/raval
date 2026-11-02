import { describe, expect, it } from "vitest";
import {
  jsonLdPayload,
  matchStaticPage,
  readWixTag,
  WIX_SEO_KEYS,
  wixPostSlug,
  writeWixTag,
  type WixSeoTag,
} from "./wix-seo";

const tags: WixSeoTag[] = [
  { type: "title", children: "Home | Acme" },
  { type: "meta", props: { name: "description", content: "We make anvils." } },
  { type: "meta", props: { property: "og:title", content: "Acme anvils" } },
  { type: "meta", props: { name: "google-site-verification", content: "abc" }, custom: true },
];

describe("readWixTag", () => {
  it("reads each field from its own tag", () => {
    expect(readWixTag(tags, WIX_SEO_KEYS.title)).toBe("Home | Acme");
    expect(readWixTag(tags, WIX_SEO_KEYS.description)).toBe("We make anvils.");
    expect(readWixTag(tags, WIX_SEO_KEYS.ogTitle)).toBe("Acme anvils");
    expect(readWixTag(tags, WIX_SEO_KEYS.canonical)).toBeNull();
  });

  it("reads robots as noindex true/false and skips disabled tags", () => {
    expect(
      readWixTag(
        [{ type: "meta", props: { name: "robots", content: "noindex, nofollow" } }],
        WIX_SEO_KEYS.robots,
      ),
    ).toBe(true);
    expect(
      readWixTag(
        [{ type: "meta", props: { name: "robots", content: "noindex" }, disabled: true }],
        WIX_SEO_KEYS.robots,
      ),
    ).toBeNull();
  });
});

describe("writeWixTag", () => {
  it("changes one field and keeps every other tag (Wix replaces the whole list)", () => {
    const next = writeWixTag(tags, WIX_SEO_KEYS.description, "Hand-forged anvils since 1902.");
    expect(next).toHaveLength(tags.length);
    expect(readWixTag(next, WIX_SEO_KEYS.description)).toBe("Hand-forged anvils since 1902.");
    expect(next[3]).toEqual(tags[3]);
    expect(next[0]).toEqual(tags[0]);
  });

  it("adds a missing tag and removes one set to empty", () => {
    const added = writeWixTag(tags, WIX_SEO_KEYS.canonical, "https://acme.com/");
    expect(added.at(-1)).toEqual({
      type: "link",
      props: { rel: "canonical", href: "https://acme.com/" },
    });
    const removed = writeWixTag(tags, WIX_SEO_KEYS.title, null);
    expect(readWixTag(removed, WIX_SEO_KEYS.title)).toBeNull();
    expect(removed).toHaveLength(tags.length - 1);
  });

  it("writes robots and JSON-LD in Wix's tag shapes", () => {
    const robots = writeWixTag([], WIX_SEO_KEYS.robots, false);
    expect(robots).toEqual([{ type: "meta", props: { name: "robots", content: "index" } }]);
    const ld = writeWixTag([], WIX_SEO_KEYS.jsonld, '{"@type":"WebPage"}');
    expect(ld).toEqual([
      { type: "script", props: { type: "application/ld+json" }, children: '{"@type":"WebPage"}' },
    ]);
  });

  it("collapses duplicates of the changed field into one tag", () => {
    const dup: WixSeoTag[] = [
      { type: "title", children: "A" },
      { type: "title", children: "B" },
    ];
    expect(writeWixTag(dup, WIX_SEO_KEYS.title, "C")).toEqual([{ type: "title", children: "C" }]);
  });
});

describe("jsonLdPayload", () => {
  it("strips a surrounding script tag", () => {
    expect(jsonLdPayload('<script type="application/ld+json">\n{"a":1}\n</script>')).toBe(
      '{"a":1}',
    );
    expect(jsonLdPayload('{"a":1}')).toBe('{"a":1}');
  });
});

describe("matchStaticPage", () => {
  const pages = [
    {
      itemId: "home",
      resolvedTags: [
        { tag: { type: "link", props: { rel: "canonical", href: "https://www.acme.com" } } },
      ],
    },
    {
      itemId: "about",
      resolvedTags: [
        { tag: { type: "link", props: { rel: "canonical", href: "https://www.acme.com/about" } } },
      ],
    },
  ];

  it("matches a URL to the page whose canonical Wix renders for it", () => {
    expect(matchStaticPage(pages, "https://acme.com/about/")).toBe("about");
    expect(matchStaticPage(pages, "https://acme.com/")).toBe("home");
  });

  it("accepts the site's other hosts but never another site's", () => {
    expect(matchStaticPage(pages, "https://acme.wixsite.com/about", ["acme.com"])).toBe("about");
    expect(matchStaticPage(pages, "https://acme.wixsite.com/about")).toBeNull();
    expect(matchStaticPage(pages, "https://other.com/about")).toBeNull();
  });

  it("refuses an ambiguous match", () => {
    expect(
      matchStaticPage([...pages, { ...pages[1], itemId: "about-copy" }], "https://acme.com/about"),
    ).toBeNull();
  });
});

describe("wixPostSlug", () => {
  it("reads a Wix Blog post slug, also under a language prefix", () => {
    expect(wixPostSlug("https://acme.com/post/how-to-forge")).toBe("how-to-forge");
    expect(wixPostSlug("https://acme.com/fr/post/forger")).toBe("forger");
    expect(wixPostSlug("https://acme.com/blog")).toBeNull();
    expect(wixPostSlug("https://acme.com/post/a/comments")).toBeNull();
  });
});
