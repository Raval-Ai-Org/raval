import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, dynamic } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("Google runtime public configuration", () => {
  it("reads a server client ID at request time and returns only that public identifier", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "123-signin.apps.googleusercontent.com");
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "456-legacy.apps.googleusercontent.com");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "never-expose-this-secret");
    const response = await GET();
    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ clientId: "123-signin.apps.googleusercontent.com" });
  });

  it("uses an existing public variable at runtime even if it was absent at build/import", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "123-first.apps.googleusercontent.com");
    expect(await (await GET()).json()).toEqual({
      clientId: "123-first.apps.googleusercontent.com",
    });
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "456-updated.apps.googleusercontent.com");
    expect(await (await GET()).json()).toEqual({
      clientId: "456-updated.apps.googleusercontent.com",
    });
  });

  it.each(["", "client-secret", "https://attacker.example", "123.apps.googleusercontent.com"])(
    "fails safely for missing/invalid config %s and never uses the Analytics client",
    async (value) => {
      vi.stubEnv("GOOGLE_CLIENT_ID", value);
      vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "");
      vi.stubEnv("GOOGLE_ANALYTICS_CLIENT_ID", "123-analytics.apps.googleusercontent.com");
      const response = await GET();
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "GOOGLE_SIGN_IN_NOT_CONFIGURED" });
    },
  );
});
