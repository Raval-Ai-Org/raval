import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setUsageSink, type UsageRecord } from "@/server/ai/metering";
import { setBudgetDeps } from "@/server/ai/budget";
import { cache } from "@/server/cache/store";
import { runWithScope } from "@/server/request-context";
import {
  TavilyGatewayError,
  setTavilyTransport,
  tavilyExtract,
  tavilySearch,
} from "./tavily-gateway.server";

const KEY = "tvly-test-key";

function enable() {
  process.env.TAVILY_API_KEY = KEY;
}

beforeEach(() => {
  // A shared cache across tests would make a second call look like a hit.
  process.env.TAVILY_CACHE_BUST = String(Math.random());
});

afterEach(() => {
  delete process.env.TAVILY_API_KEY;
  setTavilyTransport(null);
  setUsageSink(async () => {});
  setBudgetDeps(null);
});

function searchResponse(urls: string[]) {
  return {
    results: urls.map((url, index) => ({
      url,
      title: `Title ${index}`,
      content: `Snippet ${index}`,
      score: 1 - index * 0.1,
      published_date: "2026-09-01T00:00:00Z",
    })),
  };
}

describe("tavilySearch", () => {
  it("throws a 503 when not configured, without calling the transport", async () => {
    const transport = vi.fn();
    setTavilyTransport(transport);

    await expect(tavilySearch("anything")).rejects.toMatchObject({
      status: 503,
      code: "missing_config",
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it("maps provider results into the gateway's shape", async () => {
    enable();
    setTavilyTransport(async () => searchResponse(["https://a.example.com/one"]));

    const result = await tavilySearch(`unique ${Math.random()}`);

    expect(result.results).toEqual([
      {
        url: "https://a.example.com/one",
        title: "Title 0",
        snippet: "Snippet 0",
        publishedDate: "2026-09-01T00:00:00Z",
        score: 1,
      },
    ]);
  });

  it("drops rows that are not usable http results", async () => {
    enable();
    setTavilyTransport(async () => ({
      results: [
        { url: "ftp://nope", title: "x", content: "y", score: 1 },
        { url: "https://ok.example.com", title: "ok", content: "y", score: 1 },
        { title: "no url", content: "y", score: 1 },
      ],
    }));

    const result = await tavilySearch(`unique ${Math.random()}`);
    expect(result.results.map((r) => r.url)).toEqual(["https://ok.example.com"]);
  });

  it("refuses an internal host in includeDomains before it reaches the provider", async () => {
    enable();
    const transport = vi.fn();
    setTavilyTransport(transport);

    await expect(
      tavilySearch("anything", { includeDomains: ["169.254.169.254"] }),
    ).rejects.toMatchObject({ status: 400, code: "blocked_host" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("refuses a localhost include domain", async () => {
    enable();
    const transport = vi.fn();
    setTavilyTransport(transport);

    await expect(tavilySearch("anything", { excludeDomains: ["localhost"] })).rejects.toThrow(
      TavilyGatewayError,
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it("asks for news with a day window only when the topic is news", async () => {
    enable();
    const bodies: Record<string, unknown>[] = [];
    setTavilyTransport(async (_path, body) => {
      bodies.push(body);
      return searchResponse(["https://n.example.com"]);
    });

    await tavilySearch(`news ${Math.random()}`, { topic: "news", days: 9 });
    await tavilySearch(`general ${Math.random()}`, { days: 9 });

    expect(bodies[0]).toMatchObject({ topic: "news", days: 9 });
    expect(bodies[1]).not.toHaveProperty("days");
  });

  it("serves the second identical call from cache without calling the provider again", async () => {
    enable();
    const transport = vi.fn(async () => searchResponse(["https://c.example.com"]));
    setTavilyTransport(transport);
    const query = `cached ${Math.random()}`;

    const first = await tavilySearch(query);
    const second = await tavilySearch(query);

    expect(transport).toHaveBeenCalledTimes(1);
    expect(second.results).toEqual(first.results);
  });

  it("meters a cache hit as cached with the cost it saved", async () => {
    enable();
    const events: UsageRecord[] = [];
    setUsageSink(async (event) => {
      events.push(event);
    });
    setTavilyTransport(async () => searchResponse(["https://m.example.com"]));
    const query = `metered ${Math.random()}`;

    await tavilySearch(query);
    await tavilySearch(query);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ provider: "tavily", kind: "search", cached: false });
    expect(events[1]).toMatchObject({ provider: "tavily", cached: true });
    expect(Number(events[1].saved_usd)).toBeGreaterThan(0);
  });

  it("does not cache an empty result set", async () => {
    enable();
    const transport = vi.fn(async () => ({ results: [] }));
    setTavilyTransport(transport);
    const query = `empty ${Math.random()}`;

    await tavilySearch(query);
    await tavilySearch(query);

    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("refuses to spend when the workspace is over its search budget", async () => {
    enable();
    const transport = vi.fn(async () => searchResponse(["https://b.example.com"]));
    setTavilyTransport(transport);
    setBudgetDeps({
      summary: async () => ({
        todayCostUsd: 1_000,
        monthCostUsd: 1_000,
        monthImages: 0,
        monthVideos: 0,
        monthCalls: 0,
        monthCachedCalls: 0,
        monthSavedUsd: 0,
      }),
      plan: async () => "starter",
    });

    // Budgets are per workspace, so the check only bites inside a scope.
    await expect(
      runWithScope({ workspaceId: "11111111-1111-4111-8111-111111111111" }, () =>
        tavilySearch(`budget ${Math.random()}`),
      ),
    ).rejects.toMatchObject({ status: 429 });
    expect(transport).not.toHaveBeenCalled();
  });

  it("returns an empty result for a blank query without spending anything", async () => {
    enable();
    const transport = vi.fn();
    setTavilyTransport(transport);

    await expect(tavilySearch("   ")).resolves.toEqual({ results: [] });
    expect(transport).not.toHaveBeenCalled();
  });

  it("wraps an unexpected transport failure as a 502 rather than leaking it", async () => {
    enable();
    setTavilyTransport(async () => {
      throw new Error("socket hang up");
    });

    await expect(tavilySearch(`boom ${Math.random()}`)).rejects.toMatchObject({
      status: 502,
      code: "provider_error",
    });
  });
});

describe("tavilyExtract", () => {
  it("drops URLs that fail the SSRF check and keeps the rest", async () => {
    enable();
    const bodies: Record<string, unknown>[] = [];
    setTavilyTransport(async (_path, body) => {
      bodies.push(body);
      return { results: [{ url: "https://good.example.com", raw_content: "# hello" }] };
    });

    const pages = await tavilyExtract([
      "http://127.0.0.1/secret",
      `https://good.example.com/?v=${Math.random()}`,
    ]);

    expect(bodies[0].urls).toHaveLength(1);
    expect(String((bodies[0].urls as string[])[0])).toContain("good.example.com");
    expect(pages).toEqual([{ url: "https://good.example.com", markdown: "# hello" }]);
  });

  it("returns nothing, and calls nothing, when every URL is blocked", async () => {
    enable();
    const transport = vi.fn();
    setTavilyTransport(transport);

    await expect(tavilyExtract(["http://localhost/a", "http://10.0.0.1/b"])).resolves.toEqual([]);
    expect(transport).not.toHaveBeenCalled();
  });

  it("throws a 503 when not configured", async () => {
    await expect(tavilyExtract(["https://example.com"])).rejects.toMatchObject({ status: 503 });
  });
});

describe("cache isolation", () => {
  it("keeps the cache key stable for identical parameters", async () => {
    enable();
    setTavilyTransport(async () => searchResponse(["https://k.example.com"]));
    const query = `key ${Math.random()}`;
    await tavilySearch(query, { maxResults: 3 });
    // A different parameter set must be a different key, so this one misses.
    const transport = vi.fn(async () => searchResponse(["https://k2.example.com"]));
    setTavilyTransport(transport);
    await tavilySearch(query, { maxResults: 4 });
    expect(transport).toHaveBeenCalledTimes(1);
    void cache;
  });
});
