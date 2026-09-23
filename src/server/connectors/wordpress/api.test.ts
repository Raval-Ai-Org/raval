import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { normalizeWordPressUrl, WordPressApiError, createPost } from "./api.server";
import {
  decryptWithKey,
  encryptWithKey,
  readEncryptionKey,
} from "@/server/crypto/secret-box.server";
import { buildWordPressOAuthUrl } from "./service.server";

describe("WordPress API boundary", () => {
  const originalKey = process.env.WORDPRESS_TOKEN_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.WORDPRESS_TOKEN_ENCRYPTION_KEY = Buffer.from(
      "12345678901234567890123456789012",
      "utf8",
    ).toString("base64");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalKey === undefined) delete process.env.WORDPRESS_TOKEN_ENCRYPTION_KEY;
    else process.env.WORDPRESS_TOKEN_ENCRYPTION_KEY = originalKey;
  });

  it("normalizes a public HTTPS site and rejects unsafe or non-HTTPS URLs", () => {
    expect(normalizeWordPressUrl("https://example.com///?x=1")).toBe("https://example.com");
    expect(() => normalizeWordPressUrl("http://example.com")).toThrow("HTTPS");
    expect(() => normalizeWordPressUrl("https://localhost")).toThrow();
  });

  it("maps provider errors without exposing credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: "rest_cannot_create", message: "secret detail" }), {
          status: 403,
        }),
      ),
    );
    await expect(
      createPost("https://example.com", "alice", "app-password", { title: "x" }),
    ).rejects.toMatchObject({
      status: 403,
      message: "WordPress denied this operation for the connected account.",
    });
    try {
      await createPost("https://example.com", "alice", "app-password", { title: "x" });
    } catch (error) {
      expect(error).toBeInstanceOf(WordPressApiError);
      expect(String(error)).not.toContain("app-password");
    }
  });

  it("round-trips a secret with the configured WordPress encryption key", () => {
    const key = readEncryptionKey("WORDPRESS_TOKEN_ENCRYPTION_KEY");
    const encrypted = encryptWithKey("application-password-test", key);
    expect(encrypted).not.toContain("application-password-test");
    expect(decryptWithKey(encrypted, key)).toBe("application-password-test");
  });

  it("builds the WordPress.com OAuth URL with the exact callback and no client secret", () => {
    const url = new URL(
      buildWordPressOAuthUrl({
        state: "state-value",
        clientId: "client-id",
        redirectUri: "https://mellox.ai/api/integrations/wordpress/callback",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://public-api.wordpress.com/oauth2/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://mellox.ai/api/integrations/wordpress/callback",
    );
    expect(url.searchParams.get("client_secret")).toBeNull();
  });
});
