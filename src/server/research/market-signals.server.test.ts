import { beforeEach, describe, expect, it, vi } from "vitest";

const webSearchMany = vi.hoisted(() => vi.fn());

vi.mock("@/server/research/web-search.server", () => ({ webSearchMany }));

import { collectMarketSignals, hasMarketSignal } from "./market-signals.server";

describe("collectMarketSignals", () => {
  beforeEach(() => vi.clearAllMocks());

  it("builds one query per keyword, appending the location", async () => {
    webSearchMany.mockResolvedValue([]);
    await collectMarketSignals({
      keywords: ["AI marketing", "growth hacking"],
      location: "Canada",
    });

    expect(webSearchMany).toHaveBeenCalledWith(
      ["AI marketing Canada", "growth hacking Canada"],
      expect.objectContaining({ topic: "news" }),
    );
  });

  it("drops the location suffix when none is given", async () => {
    webSearchMany.mockResolvedValue([]);
    await collectMarketSignals({ keywords: ["AI marketing"] });

    expect(webSearchMany).toHaveBeenCalledWith(["AI marketing"], expect.any(Object));
  });

  it("caps at 5 keywords and trims blanks", async () => {
    webSearchMany.mockResolvedValue([]);
    await collectMarketSignals({
      keywords: ["a", "  ", "b", "c", "d", "e", "f"],
    });

    expect(webSearchMany).toHaveBeenCalledWith(["a", "b", "c", "d", "e"], expect.any(Object));
  });

  it("normalizes web sources into MarketSignalSource, deriving the domain", async () => {
    webSearchMany.mockResolvedValue([
      {
        title: "AI marketing tools are having a moment",
        url: "https://www.example.com/post",
        snippet: "A roundup of tools.",
        publishedDate: "2026-09-01",
        provider: "tavily",
      },
    ]);

    const data = await collectMarketSignals({ keywords: ["AI marketing"] });

    expect(data).toEqual({
      keywords: ["AI marketing"],
      location: null,
      sources: [
        {
          title: "AI marketing tools are having a moment",
          url: "https://www.example.com/post",
          snippet: "A roundup of tools.",
          domain: "example.com",
          publishedDate: "2026-09-01",
        },
      ],
    });
  });

  it("returns no sources without throwing when nothing is found", async () => {
    webSearchMany.mockResolvedValue([]);
    const data = await collectMarketSignals({ keywords: ["a very obscure niche term"] });
    expect(data.sources).toEqual([]);
    expect(hasMarketSignal(data)).toBe(false);
  });

  it("returns an empty collection without calling the search at all for no keywords", async () => {
    const data = await collectMarketSignals({ keywords: [] });
    expect(webSearchMany).not.toHaveBeenCalled();
    expect(data.sources).toEqual([]);
  });

  it("reports a real signal once at least one source came back", async () => {
    webSearchMany.mockResolvedValue([
      { title: "t", url: "https://example.com", snippet: "s", provider: "tavily" },
    ]);
    const data = await collectMarketSignals({ keywords: ["AI marketing"] });
    expect(hasMarketSignal(data)).toBe(true);
  });
});
