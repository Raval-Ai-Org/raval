import { describe, expect, it } from "vitest";
import { extractLinks, matchLink } from "./verify";

const BASE = "https://blog.example.com/post";

function outcome(html: string, target = "mellox.ai") {
  return matchLink(extractLinks(html, BASE), target);
}

describe("extractLinks", () => {
  it("reads href, anchor text and rel", () => {
    const links = extractLinks(
      `<a href="https://mellox.ai/" rel="NOFOLLOW noopener"><span>Mellox</span> AI</a>`,
      BASE,
    );
    expect(links).toHaveLength(1);
    expect(links[0].resolved).toBe("https://mellox.ai/");
    expect(links[0].anchor).toBe("Mellox AI");
    expect(links[0].rel).toEqual(["nofollow", "noopener"]);
  });

  it("resolves relative and protocol-relative hrefs against the page", () => {
    const links = extractLinks(`<a href="/about">a</a><a href="//mellox.ai/x">b</a>`, BASE);
    expect(links[0].resolved).toBe("https://blog.example.com/about");
    expect(links[1].resolved).toBe("https://mellox.ai/x");
  });

  it("decodes entities in hrefs and anchors", () => {
    const links = extractLinks(
      `<a href="https://mellox.ai/?a=1&amp;b=2">Tools &amp; tips</a>`,
      BASE,
    );
    expect(links[0].resolved).toBe("https://mellox.ai/?a=1&b=2");
    expect(links[0].anchor).toBe("Tools & tips");
  });

  it("handles single quotes, unquoted attributes and uppercase tags", () => {
    const links = extractLinks(`<A HREF='https://mellox.ai/' REL=nofollow>x</A>`, BASE);
    expect(links[0].resolved).toBe("https://mellox.ai/");
    expect(links[0].rel).toEqual(["nofollow"]);
  });

  it("ignores anchors without an href and unparseable urls", () => {
    const links = extractLinks(`<a name="top">x</a><a href="javascript:void(0)">y</a>`, BASE);
    expect(links.every((l) => l.href !== "")).toBe(true);
    expect(links.find((l) => l.href.startsWith("javascript"))?.resolved).toBeNull();
  });
});

describe("matchLink", () => {
  it("confirms a followed link", () => {
    const result = outcome(`<a href="https://mellox.ai/pricing">Mellox</a>`);
    expect(result.result).toBe("live");
    expect(result.linkFound).toBe(true);
    expect(result.anchorFound).toBe("Mellox");
    expect(result.isNofollow).toBe(false);
  });

  it("separates a link that passes no authority", () => {
    expect(outcome(`<a href="https://mellox.ai/" rel="nofollow">x</a>`).result).toBe("nofollow");
    expect(outcome(`<a href="https://mellox.ai/" rel="sponsored">x</a>`).result).toBe("nofollow");
    expect(outcome(`<a href="https://mellox.ai/" rel="ugc">x</a>`).result).toBe("nofollow");
  });

  it("matches subdomains and www of the expected host", () => {
    expect(outcome(`<a href="https://www.mellox.ai/">x</a>`).result).toBe("live");
    expect(outcome(`<a href="https://blog.mellox.ai/">x</a>`).result).toBe("live");
  });

  it("reports no link when the page links elsewhere", () => {
    const result = outcome(`<a href="https://someone-else.com/">x</a>`);
    expect(result.result).toBe("missing");
    expect(result.linkFound).toBe(false);
  });

  it("does not count a link to another page of the same site", () => {
    const result = outcome(`<a href="https://mellox.ai/blog">x</a>`, "https://mellox.ai/pricing");
    expect(result.result).toBe("missing");
    expect(result.linkFound).toBe(true);
    expect(result.targetMatches).toBe(false);
  });

  it("accepts the exact page ignoring a trailing slash", () => {
    const result = outcome(
      `<a href="https://mellox.ai/pricing/">x</a>`,
      "https://mellox.ai/pricing",
    );
    expect(result.result).toBe("live");
  });

  it("prefers a real match over an earlier wrong-page link", () => {
    const result = outcome(
      `<a href="https://mellox.ai/blog">a</a><a href="https://mellox.ai/pricing">b</a>`,
      "https://mellox.ai/pricing",
    );
    expect(result.result).toBe("live");
    expect(result.anchorFound).toBe("b");
  });

  it("returns missing for an empty page rather than throwing", () => {
    expect(outcome("").result).toBe("missing");
  });
});
