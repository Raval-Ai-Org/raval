// tavily.live.ts — opt-in checks against the real Tavily API, using the key in
// .env. Every call here is a read: it searches and extracts, and spends only
// the handful of API credits those cost. Nothing is written anywhere.
//
//   npx vitest run --config vitest.live.config.ts tests/live/tavily.live.ts
import { beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { tavilyEnabled } from "@/lib/tavily-flags.server";

config({ path: ".env", quiet: true });
config({ path: ".env.local", override: true, quiet: true });

const configured = Boolean(process.env.TAVILY_API_KEY?.trim());
const describeLive = configured ? describe : describe.skip;

describeLive("Tavily, against the real API", () => {
  let gateway: typeof import("@/lib/tavily-gateway.server");
  let research: typeof import("@/server/research/web-search.server");

  beforeAll(async () => {
    gateway = await import("@/lib/tavily-gateway.server");
    research = await import("@/server/research/web-search.server");
  });

  it("reports itself configured", () => {
    expect(tavilyEnabled()).toBe(true);
    expect(research.webResearchProvider()).toBe("tavily");
  });

  it("returns real, usable results for a general search", async () => {
    const result = await gateway.tavilySearch("Anthropic Claude developer documentation", {
      maxResults: 5,
      cacheTtlSeconds: 0,
    });
    expect(result.results.length).toBeGreaterThan(0);
    for (const row of result.results) {
      expect(row.url.startsWith("http")).toBe(true);
      expect(row.title.length).toBeGreaterThan(0);
    }
  });

  it("returns recent items for a news search with a day window", async () => {
    const result = await gateway.tavilySearch("artificial intelligence industry news", {
      topic: "news",
      days: 14,
      maxResults: 5,
      cacheTtlSeconds: 0,
    });
    expect(result.results.length).toBeGreaterThan(0);
    // Most news rows carry a date; at least one should, or the recency
    // controls are not doing what the product claims they do.
    const dated = result.results.filter((row) => Boolean(row.publishedDate));
    expect(dated.length).toBeGreaterThan(0);
    const cutoff = Date.now() - 60 * 86_400_000;
    for (const row of dated) {
      expect(new Date(row.publishedDate as string).getTime()).toBeGreaterThan(cutoff);
    }
  });

  it("returns a grounded answer when one is asked for", async () => {
    const result = await gateway.tavilySearch("What is retrieval augmented generation?", {
      includeAnswer: true,
      maxResults: 4,
      cacheTtlSeconds: 0,
    });
    expect(result.answer && result.answer.length > 20).toBe(true);
    expect(result.results.length).toBeGreaterThan(0);
  });

  it("extracts readable text from a public page", async () => {
    const pages = await gateway.tavilyExtract(["https://example.com"], { cacheTtlSeconds: 0 });
    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0].markdown.length).toBeGreaterThan(10);
  });

  it("serves an identical repeat from cache without a second provider call", async () => {
    const query = `Mellox cache probe ${new Date().toISOString().slice(0, 10)}`;
    const first = await gateway.tavilySearch(query, { maxResults: 3 });
    const startedAt = Date.now();
    const second = await gateway.tavilySearch(query, { maxResults: 3 });
    // A cache hit is local; a real round trip is not this fast.
    expect(Date.now() - startedAt).toBeLessThan(150);
    expect(second.results.map((r) => r.url)).toEqual(first.results.map((r) => r.url));
  });

  it("degrades to a clean 503 when the key is missing, rather than crashing", async () => {
    const key = process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY;
    try {
      await expect(gateway.tavilySearch("anything")).rejects.toMatchObject({
        status: 503,
        code: "missing_config",
      });
      // And the shared entry point simply returns nothing rather than throwing.
      await expect(research.webSearch("")).resolves.toEqual([]);
    } finally {
      process.env.TAVILY_API_KEY = key;
    }
  });

  it("refuses an internal host before it can reach the provider", async () => {
    await expect(
      gateway.tavilySearch("anything", { includeDomains: ["169.254.169.254"] }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("applies Mellox's own source rules to real results", async () => {
    const sources = await research.webSearch("best project management software", {
      limit: 8,
      perHost: 1,
      cacheTtlSeconds: 0,
    });
    expect(sources.length).toBeGreaterThan(0);
    const hosts = sources.map((source) => new URL(source.url).hostname);
    expect(new Set(hosts).size).toBe(hosts.length);
  });
});
