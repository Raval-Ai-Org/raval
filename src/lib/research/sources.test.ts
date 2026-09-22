import { describe, expect, it } from "vitest";
import {
  dedupeSources,
  formatSourcesForPrompt,
  hostOf,
  isAggregatorSource,
  isLowQualitySource,
  normalizeSourceUrl,
  rankSources,
  sourceAuthorityHint,
  type WebSource,
} from "./sources";

function source(url: string, extra: Partial<WebSource> = {}): WebSource {
  return {
    title: extra.title ?? url,
    url,
    snippet: extra.snippet ?? "snippet",
    provider: extra.provider ?? "tavily",
    ...extra,
  };
}

describe("normalizeSourceUrl", () => {
  it("collapses the same page reached different ways to one identity", () => {
    const variants = [
      "https://Example.com/blog/post/",
      "http://www.example.com/blog/post",
      "https://example.com/blog/post#section",
      "https://example.com/blog/post?utm_source=newsletter",
    ];
    const normalized = new Set(variants.map(normalizeSourceUrl));
    expect(normalized.size).toBe(1);
  });

  it("keeps meaningful query parameters", () => {
    expect(normalizeSourceUrl("https://example.com/search?q=pricing")).toContain("q=pricing");
  });

  it("returns the input unchanged when it cannot be parsed", () => {
    expect(normalizeSourceUrl("not a url")).toBe("not a url");
  });
});

describe("isLowQualitySource", () => {
  it("refuses file hosts, shorteners and throwaway TLDs", () => {
    expect(isLowQualitySource("https://drive.google.com/file/d/123")).toBe(true);
    expect(isLowQualitySource("https://bit.ly/abc")).toBe(true);
    expect(isLowQualitySource("https://cheap-deals.xyz/page")).toBe(true);
  });

  it("refuses a link to a downloadable file rather than a page", () => {
    expect(isLowQualitySource("https://example.com/report.pdf")).toBe(true);
    expect(isLowQualitySource("https://example.com/logo.png")).toBe(true);
  });

  it("accepts an ordinary company page", () => {
    expect(isLowQualitySource("https://example.com/pricing")).toBe(false);
  });

  it("refuses anything unparseable", () => {
    expect(isLowQualitySource("javascript:alert(1)")).toBe(true);
  });
});

describe("isAggregatorSource", () => {
  it("treats review and listing sites as writing about companies, not being one", () => {
    expect(isAggregatorSource("https://www.g2.com/products/thing")).toBe(true);
    expect(isAggregatorSource("https://en.wikipedia.org/wiki/Thing")).toBe(true);
    expect(isAggregatorSource("https://acme-software.com")).toBe(false);
  });
});

describe("dedupeSources", () => {
  it("drops duplicates that differ only by tracking parameters", () => {
    const result = dedupeSources([
      source("https://example.com/a"),
      source("https://example.com/a?utm_source=x"),
    ]);
    expect(result).toHaveLength(1);
  });

  it("stops one host dominating the result set", () => {
    const result = dedupeSources(
      [
        source("https://loud.com/1"),
        source("https://loud.com/2"),
        source("https://loud.com/3"),
        source("https://other.com/1"),
      ],
      { perHost: 2 },
    );
    expect(result.map((entry) => hostOf(entry.url))).toEqual(["loud.com", "loud.com", "other.com"]);
  });

  it("removes low-quality sources entirely", () => {
    const result = dedupeSources([source("https://bit.ly/x"), source("https://real.com/x")]);
    expect(result.map((entry) => entry.url)).toEqual(["https://real.com/x"]);
  });

  it("honours a total limit", () => {
    const result = dedupeSources(
      [source("https://a.com/1"), source("https://b.com/1"), source("https://c.com/1")],
      { limit: 2 },
    );
    expect(result).toHaveLength(2);
  });
});

describe("sourceAuthorityHint", () => {
  it("rates government and education domains highest", () => {
    expect(sourceAuthorityHint("https://www.ftc.gov/page")).toBe("high");
  });

  it("rates a deep subdomain chain lowest", () => {
    expect(sourceAuthorityHint("https://a.b.c.d.example.com/page")).toBe("low");
  });

  it("rates an unparseable URL lowest", () => {
    expect(sourceAuthorityHint("nonsense")).toBe("low");
  });
});

describe("rankSources", () => {
  it("puts the higher provider score first", () => {
    const ranked = rankSources([
      source("https://low.com/x", { score: 0.2 }),
      source("https://high.com/x", { score: 0.9 }),
    ]);
    expect(hostOf(ranked[0].url)).toBe("high.com");
  });

  it("keeps the original order for sources it cannot separate", () => {
    const ranked = rankSources([
      source("https://first.com/x", { score: 0.5 }),
      source("https://second.com/x", { score: 0.5 }),
    ]);
    expect(ranked.map((entry) => hostOf(entry.url))).toEqual(["first.com", "second.com"]);
  });
});

describe("formatSourcesForPrompt", () => {
  it("numbers each source and always includes its URL", () => {
    const formatted = formatSourcesForPrompt([
      source("https://a.com/x", { title: "A", snippet: "about a" }),
      source("https://b.com/y", { title: "B", snippet: "about b" }),
    ]);
    expect(formatted).toContain("[1] A");
    expect(formatted).toContain("https://a.com/x");
    expect(formatted).toContain("[2] B");
  });

  it("stops before exceeding the character budget", () => {
    const long = "x".repeat(500);
    const formatted = formatSourcesForPrompt(
      [
        source("https://a.com/x", { snippet: long }),
        source("https://b.com/y", { snippet: long }),
        source("https://c.com/z", { snippet: long }),
      ],
      600,
    );
    expect(formatted).toContain("a.com");
    expect(formatted).not.toContain("c.com");
  });

  it("shows a publication date when the provider reported one", () => {
    const formatted = formatSourcesForPrompt([
      source("https://a.com/x", { publishedDate: "2026-09-01T10:00:00Z" }),
    ]);
    expect(formatted).toContain("(2026-09-01)");
  });
});
