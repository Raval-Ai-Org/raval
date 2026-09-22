import { afterEach, describe, expect, it, vi } from "vitest";
import { setTavilyTransport } from "@/lib/tavily-gateway.server";
import { setFirecrawlClient } from "@/lib/firecrawl-gateway.server";
import { setUsageSink } from "@/server/ai/metering";
import { webResearchAvailable, webResearchProvider, webSearch } from "./web-search.server";

const originalFetch = globalThis.fetch;

afterEach(() => {
  delete process.env.TAVILY_API_KEY;
  delete process.env.FIRECRAWL_BASE_URL;
  setTavilyTransport(null);
  setFirecrawlClient(null);
  setUsageSink(async () => {});
  globalThis.fetch = originalFetch;
});

function firecrawlClient(urls: string[]) {
  return {
    scrape: vi.fn(),
    crawl: vi.fn(),
    map: vi.fn(),
    search: vi.fn(async () => ({
      web: urls.map((url) => ({ url, title: `FC ${url}`, description: "fc snippet" })),
    })),
  };
}

describe("webResearchAvailable", () => {
  it("is false when neither provider is configured", () => {
    expect(webResearchAvailable()).toBe(false);
    expect(webResearchProvider()).toBe("ddg");
  });

  it("prefers Tavily when both are configured", () => {
    process.env.TAVILY_API_KEY = "tvly-x";
    process.env.FIRECRAWL_BASE_URL = "http://localhost:3002";
    expect(webResearchAvailable()).toBe(true);
    expect(webResearchProvider()).toBe("tavily");
  });
});

describe("webSearch", () => {
  it("uses Tavily and tags the provider on every source", async () => {
    process.env.TAVILY_API_KEY = "tvly-x";
    setTavilyTransport(async () => ({
      results: [{ url: "https://a.com/x", title: "A", content: "snippet a", score: 0.9 }],
    }));

    const sources = await webSearch(`tavily ${Math.random()}`);

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ url: "https://a.com/x", provider: "tavily" });
  });

  it("falls through to Firecrawl when Tavily fails", async () => {
    process.env.TAVILY_API_KEY = "tvly-x";
    process.env.FIRECRAWL_BASE_URL = "http://localhost:3002";
    setTavilyTransport(async () => {
      throw new Error("provider down");
    });
    setFirecrawlClient(firecrawlClient(["https://b.com/x"]));

    const sources = await webSearch(`fallback ${Math.random()}`);

    expect(sources.map((source) => source.provider)).toEqual(["firecrawl"]);
  });

  it("falls through when Tavily returns nothing at all", async () => {
    process.env.TAVILY_API_KEY = "tvly-x";
    process.env.FIRECRAWL_BASE_URL = "http://localhost:3002";
    setTavilyTransport(async () => ({ results: [] }));
    setFirecrawlClient(firecrawlClient(["https://c.com/x"]));

    const sources = await webSearch(`empty ${Math.random()}`);
    expect(sources.map((source) => source.provider)).toEqual(["firecrawl"]);
  });

  it("returns an empty list rather than throwing when every provider fails", async () => {
    process.env.TAVILY_API_KEY = "tvly-x";
    setTavilyTransport(async () => {
      throw new Error("down");
    });
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;

    await expect(webSearch(`dead ${Math.random()}`)).resolves.toEqual([]);
  });

  it("applies source quality rules to whatever a provider returns", async () => {
    process.env.TAVILY_API_KEY = "tvly-x";
    setTavilyTransport(async () => ({
      results: [
        { url: "https://bit.ly/spam", title: "Shortener", content: "x", score: 0.99 },
        { url: "https://good.com/page", title: "Good", content: "y", score: 0.5 },
      ],
    }));

    const sources = await webSearch(`quality ${Math.random()}`);
    expect(sources.map((source) => source.url)).toEqual(["https://good.com/page"]);
  });

  it("caps how many results one host may contribute", async () => {
    process.env.TAVILY_API_KEY = "tvly-x";
    setTavilyTransport(async () => ({
      results: [
        { url: "https://loud.com/1", title: "1", content: "x", score: 0.9 },
        { url: "https://loud.com/2", title: "2", content: "x", score: 0.8 },
        { url: "https://loud.com/3", title: "3", content: "x", score: 0.7 },
        { url: "https://quiet.com/1", title: "4", content: "x", score: 0.6 },
      ],
    }));

    const sources = await webSearch(`perhost ${Math.random()}`, { perHost: 1 });
    expect(sources.map((source) => new URL(source.url).hostname)).toEqual([
      "loud.com",
      "quiet.com",
    ]);
  });

  it("does not search at all for a blank query", async () => {
    process.env.TAVILY_API_KEY = "tvly-x";
    const transport = vi.fn();
    setTavilyTransport(transport);

    await expect(webSearch("   ")).resolves.toEqual([]);
    expect(transport).not.toHaveBeenCalled();
  });
});
