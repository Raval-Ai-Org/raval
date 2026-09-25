import { describe, expect, it } from "vitest";
import { fingerprintPage, hostOf, wordpressObjectFromHtml } from "./fingerprint";

describe("fingerprintPage", () => {
  it("reads Webflow site, page and CMS item ids from the html tag", () => {
    const html = `<!DOCTYPE html><html data-wf-domain="www.acme.com" data-wf-page="65a1b2c3d4e5f6a7b8c9d0e1" data-wf-site="65a1b2c3d4e5f6a7b8c9d0ff" data-wf-collection="65a1b2c3d4e5f6a7b8c9d011" data-wf-item-slug="hello-world" lang="en"><head><meta content="Webflow" name="generator"></head></html>`;
    const f = fingerprintPage(html);
    expect(f.platform).toBe("webflow");
    expect(f.webflow).toEqual({
      siteId: "65a1b2c3d4e5f6a7b8c9d0ff",
      pageId: "65a1b2c3d4e5f6a7b8c9d0e1",
      collectionId: "65a1b2c3d4e5f6a7b8c9d011",
      itemSlug: "hello-world",
    });
  });

  it("ignores a malformed Webflow id", () => {
    expect(fingerprintPage(`<html data-wf-site="not-an-id">`).platform).toBeNull();
  });

  it("reads the WordPress REST root and the post behind the page", () => {
    const html = `<html><head>
      <link rel="https://api.w.org/" href="https://blog.acme.com/wp-json/" />
      <link rel="alternate" title="JSON" type="application/json" href="https://blog.acme.com/wp-json/wp/v2/posts/412" />
      <meta name="generator" content="WordPress 6.6.2" />
    </head><body class="post-template-default single postid-412"></body></html>`;
    const f = fingerprintPage(html);
    expect(f.platform).toBe("wordpress");
    expect(f.wordpress?.apiRoot).toBe("https://blog.acme.com/wp-json/");
    expect(f.wordpress?.object).toEqual({ type: "post", id: 412 });
    expect(f.wordpress?.generator).toBe("WordPress 6.6.2");
  });

  it("returns no platform for plain HTML", () => {
    expect(fingerprintPage("<html><head><title>x</title></head></html>")).toEqual({
      platform: null,
      placeholder: false,
      webflow: null,
      wordpress: null,
    });
  });

  it("flags a WordPress.com Coming Soon placeholder", () => {
    const f = fingerprintPage(
      `<html><head><meta name="generator" content="WordPress.com" /></head><body class="wpcom-coming-soon-body">`,
    );
    expect(f.platform).toBe("wordpress");
    expect(f.placeholder).toBe(true);
  });
});

describe("wordpressObjectFromHtml", () => {
  it("falls back to the shortlink, then the body class", () => {
    expect(
      wordpressObjectFromHtml(`<link rel='shortlink' href='https://acme.com/?page_id=7' />`),
    ).toEqual({ type: "page", id: 7 });
    expect(wordpressObjectFromHtml(`<link rel="shortlink" href="https://acme.com/?p=19">`)).toEqual(
      { type: "post", id: 19 },
    );
    expect(
      wordpressObjectFromHtml(`<body class="page-template page page-id-88 logged-out">`),
    ).toEqual({ type: "page", id: 88 });
    expect(wordpressObjectFromHtml(`<body class="home blog">`)).toBeNull();
  });

  it("reads WordPress pages from the REST alternate link", () => {
    expect(
      wordpressObjectFromHtml(
        `<link rel="alternate" type="application/json" href="https://acme.com/wp-json/wp/v2/pages/21">`,
      ),
    ).toEqual({ type: "page", id: 21 });
  });
});

describe("hostOf", () => {
  it("normalises hosts from URLs and bare domains", () => {
    expect(hostOf("https://www.Acme.com/wp-json/")).toBe("acme.com");
    expect(hostOf("acme.webflow.io")).toBe("acme.webflow.io");
    expect(hostOf("")).toBeNull();
  });
});
