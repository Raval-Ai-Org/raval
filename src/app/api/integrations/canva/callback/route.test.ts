import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("Canva callback boundary", () => {
  it("uses the configured origin rather than the request host and prevents referrer/cache leakage", async () => {
    vi.stubEnv("APP_URL", "https://mellox.ai");
    const response = await GET(
      new Request(
        "https://attacker.example/api/integrations/canva/callback?state=safe-state&code=opaque-code",
      ),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://mellox.ai/integrations/canva/callback?state=safe-state&code=opaque-code",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("does not log provider-controlled descriptions, authorization codes or states", async () => {
    vi.stubEnv("APP_URL", "https://mellox.ai");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await GET(
      new Request(
        "https://mellox.ai/api/integrations/canva/callback?state=secret-state&code=secret-code&error=secret-error&error_description=secret-description",
      ),
    );
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-");
    expect(JSON.stringify(warn.mock.calls)).toContain("authorization_rejected");
  });
  it("fails closed with invalid configuration instead of redirecting on an untrusted host", async () => {
    vi.stubEnv("APP_URL", "https://user:password@mellox.ai");
    const response = await GET(
      new Request("https://attacker.example/api/integrations/canva/callback?code=opaque"),
    );
    expect(response.status).toBe(503);
    expect(response.headers.has("location")).toBe(false);
  });
});
