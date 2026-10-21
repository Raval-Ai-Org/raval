import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authedFetch } from "./authed-fetch";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), event: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/app-events", () => ({ emitAppEvent: mocks.event }));
const fetcher = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSession.mockResolvedValue({
    data: { session: { access_token: "session" } },
    error: null,
  });
  fetcher.mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("window", { location: { pathname: "/projects" } });
});
afterEach(() => vi.unstubAllGlobals());

describe("authenticated fetch", () => {
  it("preserves a Request's content type and caller headers while merging overrides", async () => {
    const request = new Request("https://mellox.ai/api/test", {
      method: "POST",
      headers: { "content-type": "application/json", "x-custom": "original" },
      body: "{}",
    });
    await authedFetch(request, { headers: { "x-custom": "override" } });
    const headers = fetcher.mock.calls[0][1].headers as Headers;
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-custom")).toBe("override");
    expect(headers.get("authorization")).toBe("Bearer session");
  });
  it("preserves explicitly supplied request authorization", async () => {
    await authedFetch(
      new Request("https://mellox.ai/api/test", { headers: { authorization: "Bearer explicit" } }),
    );
    expect(fetcher.mock.calls[0][1].headers.get("authorization")).toBe("Bearer explicit");
  });
  it("stops before dispatching when the authentication session lookup fails", async () => {
    const error = new Error("session unavailable");
    mocks.getSession.mockResolvedValue({ data: { session: null }, error });
    await expect(authedFetch("/api/test")).rejects.toBe(error);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["", "garbage", "Infinity", "-1", "2.5"])(
    "does not corrupt the displayed credit balance from malformed headers: %s",
    async (balance) => {
      fetcher.mockResolvedValue(new Response("{}", { headers: { "X-Billing-Balance": balance } }));
      await authedFetch("/api/test");
      expect(mocks.event).not.toHaveBeenCalled();
    },
  );
  it("accepts a zero credit balance", async () => {
    fetcher.mockResolvedValue(new Response("{}", { headers: { "X-Billing-Balance": "0" } }));
    await authedFetch("/api/test");
    expect(mocks.event).toHaveBeenCalledWith("billing:changed", { balance: 0 });
  });
});
