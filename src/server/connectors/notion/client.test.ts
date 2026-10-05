import { afterEach, describe, expect, it, vi } from "vitest";
import { notionRequest } from "./client.server";

afterEach(() => vi.unstubAllGlobals());

describe("Notion provider client", () => {
  it("never retries an uncertain page creation", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      notionRequest("server-token", "/pages", { method: "POST", body: "{}" }),
    ).rejects.toThrow("Notion could not complete this action.");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries an idempotent read after rate limiting", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ object: "data_source" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(notionRequest("server-token", "/data_sources/source-one")).resolves.toEqual({
      object: "data_source",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("sanitizes revoked-token errors", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("raw provider token", { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    await expect(notionRequest("server-token", "/search")).rejects.toThrow(
      "Your Notion connection needs to be reconnected.",
    );
  });
});
