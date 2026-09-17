import { afterEach, describe, expect, it, vi } from "vitest";
import { setUsageSink } from "@/server/ai/metering";
import {
  FirecrawlGatewayError,
  firecrawlCrawl,
  firecrawlMap,
  firecrawlScrape,
  firecrawlSearch,
  setFirecrawlClient,
  type FirecrawlClientLike,
} from "./firecrawl-gateway.server";

afterEach(() => {
  delete process.env.FIRECRAWL_BASE_URL;
  setFirecrawlClient(null);
  setUsageSink(async () => {});
});

function enable() {
  process.env.FIRECRAWL_BASE_URL = "http://localhost:3002";
}

describe("firecrawlScrape", () => {
  it("throws a 503 FirecrawlGatewayError when not configured, without calling the client", async () => {
    const scrape = vi.fn();
    setFirecrawlClient({ scrape, crawl: vi.fn(), map: vi.fn(), search: vi.fn() });

    await expect(firecrawlScrape("https://example.com")).rejects.toMatchObject({
      status: 503,
      code: "missing_config",
    });
    expect(scrape).not.toHaveBeenCalled();
  });

  it("rejects a non-public URL before ever calling the client", async () => {
    enable();
    const scrape = vi.fn();
    setFirecrawlClient({ scrape, crawl: vi.fn(), map: vi.fn(), search: vi.fn() });

    await expect(firecrawlScrape("http://169.254.169.254/latest/meta-data")).rejects.toThrow();
    expect(scrape).not.toHaveBeenCalled();
  });

  it("returns markdown/links/metadata from the client's document", async () => {
    enable();
    const scrape = vi.fn().mockResolvedValue({
      markdown: "# Hello",
      links: ["https://example.com/about"],
      metadata: {
        title: "Example",
        description: "An example site",
        sourceURL: "https://example.com",
      },
    });
    setFirecrawlClient({ scrape, crawl: vi.fn(), map: vi.fn(), search: vi.fn() });

    const page = await firecrawlScrape("https://example.com");

    expect(page).toEqual({
      url: "https://example.com",
      markdown: "# Hello",
      links: ["https://example.com/about"],
      title: "Example",
      description: "An example site",
    });
  });

  it("wraps a client failure as a FirecrawlGatewayError", async () => {
    enable();
    setFirecrawlClient({
      scrape: vi.fn().mockRejectedValue(new Error("connection refused")),
      crawl: vi.fn(),
      map: vi.fn(),
      search: vi.fn(),
    });

    const error = await firecrawlScrape("https://example.com").catch((e) => e);
    expect(error).toBeInstanceOf(FirecrawlGatewayError);
    expect(error.message).toContain("connection refused");
  });
});

describe("firecrawlCrawl", () => {
  it("maps every crawled document to a page, falling back to the requested URL", async () => {
    enable();
    const crawl: FirecrawlClientLike["crawl"] = vi.fn().mockResolvedValue({
      data: [
        { markdown: "home", links: [], metadata: { sourceURL: "https://example.com" } },
        { markdown: "about", links: [], metadata: {} },
      ],
    });
    setFirecrawlClient({ scrape: vi.fn(), crawl, map: vi.fn(), search: vi.fn() });

    const pages = await firecrawlCrawl("https://example.com", { limit: 5 });

    expect(pages).toEqual([
      {
        url: "https://example.com",
        markdown: "home",
        links: [],
        title: undefined,
        description: undefined,
      },
      {
        url: "https://example.com",
        markdown: "about",
        links: [],
        title: undefined,
        description: undefined,
      },
    ]);
    expect(crawl).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({ limit: 5, scrapeOptions: { formats: ["markdown", "links"] } }),
    );
  });
});

describe("firecrawlMap", () => {
  it("returns just the discovered URLs", async () => {
    enable();
    setFirecrawlClient({
      scrape: vi.fn(),
      crawl: vi.fn(),
      map: vi.fn().mockResolvedValue({
        links: [{ url: "https://example.com/a" }, { url: "https://example.com/b" }],
      }),
      search: vi.fn(),
    });

    await expect(firecrawlMap("https://example.com")).resolves.toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });
});

describe("firecrawlSearch", () => {
  it("does not require a URL and returns web results", async () => {
    enable();
    setFirecrawlClient({
      scrape: vi.fn(),
      crawl: vi.fn(),
      map: vi.fn(),
      search: vi.fn().mockResolvedValue({
        web: [{ url: "https://competitor.com", title: "Competitor", description: "A rival" }],
      }),
    });

    await expect(firecrawlSearch("mellox competitors")).resolves.toEqual([
      { url: "https://competitor.com", title: "Competitor", description: "A rival" },
    ]);
  });
});
