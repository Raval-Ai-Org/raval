import { afterEach, describe, expect, it, vi } from "vitest";
import { SlackApiError, slackApi } from "./client.server";

afterEach(() => vi.unstubAllGlobals());
describe("Slack API reliability", () => {
  it("honors 429 Retry-After", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("", {
          status: 429,
          headers: { "Retry-After": "12" },
        }),
      ),
    );
    await expect(
      slackApi("test-token", "chat.postMessage", { channel: "C123" }),
    ).rejects.toMatchObject({ code: "rate_limited", retryAfter: 12 });
  });
  it("treats revoked tokens as provider errors without returning raw responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ ok: false, error: "token_revoked" })),
    );
    await expect(slackApi("test-token", "chat.postMessage")).rejects.toMatchObject({
      code: "token_revoked",
    } satisfies Partial<SlackApiError>);
  });
  it("passes only the requested method and bearer token", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true, ts: "123.456" }));
    vi.stubGlobal("fetch", fetcher);
    expect(
      (await slackApi<{ ts: string }>("test-token", "chat.postMessage", { channel: "C123" })).ts,
    ).toBe("123.456");
    expect(fetcher.mock.calls[0][0]).toBe("https://slack.com/api/chat.postMessage");
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer test-token");
  });
});
