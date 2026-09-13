// SocialAPI.ai HTTP client + error taxonomy (docs: guides/authentication, guides/errors).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertSocialApiBaseUrl,
  classifySocialApiError,
  createSocialApiClient,
  SocialApiError,
  socialApiErrorResponse,
} from "@/lib/socialapi/client.server";

const KEY = "sapi_key_0123456789abcdef";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

afterEach(() => vi.restoreAllMocks());

describe("createSocialApiClient", () => {
  it("sends the key as a Bearer token to the documented base URL and builds the query", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(200, { data: [], count: 0 }, { "x-request-id": "r1" }),
    );
    const call = createSocialApiClient({ apiKey: KEY, fetchFn: fetchFn as any });
    const res = await call({ path: "/accounts", query: { brand_id: "b1", empty: "" } });
    expect(res).toMatchObject({ status: 200, requestId: "r1" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.social-api.ai/v1/accounts?brand_id=b1");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
  });

  it("never logs the API key", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...a) => void logs.push(a.join(" ")));
    const call = createSocialApiClient({
      apiKey: KEY,
      fetchFn: (async () => jsonResponse(401, { error: { code: "auth.invalid_key" } })) as any,
    });
    await call({ path: "/users/me" });
    expect(logs.join("\n")).not.toContain(KEY);
  });

  it("retries a repeat-safe call on 503 and returns the eventual success", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { error: { code: "system.internal" } }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const call = createSocialApiClient({ apiKey: KEY, fetchFn, sleep: async () => undefined });
    const res = await call({ path: "/posts/p1", retry: true });
    expect(res.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does not retry quota exhaustion, and never retries without opt-in (publishes)", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(429, { error: { code: "validation.post_limit_exhausted" } }),
    );
    const call = createSocialApiClient({
      apiKey: KEY,
      fetchFn: fetchFn as any,
      sleep: async () => undefined,
    });
    await call({ path: "/posts/p1", retry: true });
    await call({ method: "POST", path: "/posts", body: { text: "x" } });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("raises a timeout as SocialApiError without a response", async () => {
    const fetchFn = (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const call = createSocialApiClient({ apiKey: KEY, fetchFn: fetchFn as any });
    await expect(call({ path: "/accounts", timeoutMs: 5 })).rejects.toMatchObject({
      code: "timeout",
    });
  });

  it("refuses to run without a key or over plain http to a remote host", () => {
    expect(() => createSocialApiClient({ apiKey: "" })).toThrow(SocialApiError);
    expect(() => assertSocialApiBaseUrl("http://api.social-api.ai/v1")).toThrow(/https/);
    expect(assertSocialApiBaseUrl("http://127.0.0.1:9999/v1").hostname).toBe("127.0.0.1");
  });
});

describe("error taxonomy", () => {
  it.each([
    [403, "account.reconnection_required", "ACCOUNT_EXPIRED"],
    [401, "platform.instagram.auth", "ACCOUNT_EXPIRED"],
    [412, "byok.credentials_missing", "BYOK_REQUIRED"],
    [429, "validation.post_limit_exhausted", "QUOTA_EXCEEDED"],
    [402, "billing.past_due", "PROVIDER_BILLING"],
    [429, "platform.tiktok.rate_limit", "RATE_LIMITED"],
    [401, "auth.invalid_key", "PROVIDER_MISCONFIGURED"],
    [501, "resource.not_supported", "UNSUPPORTED"],
    [409, "post.state_invalid", "CONFLICT"],
    [400, "validation.field_invalid", "PLATFORM_VALIDATION"],
    [502, "platform.facebook.api_error", "DISTRIBUTION_UNAVAILABLE"],
  ])("%s %s → %s", (status, code, expected) => {
    expect(classifySocialApiError(status, code)).toBe(expected);
  });

  it("hides provider auth failures from end users and reports them as 503", () => {
    const out = socialApiErrorResponse({
      status: 401,
      data: { error: { code: "auth.invalid_key", message: "invalid or inactive API key" } },
      requestId: "r9",
    });
    expect(out.status).toBe(503);
    expect(out.body.error.code).toBe("PROVIDER_MISCONFIGURED");
    expect(out.body.error.detail).not.toMatch(/inactive API key/);
    expect(out.body.error.requestId).toBe("r9");
  });
});
