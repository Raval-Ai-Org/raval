import { afterEach, describe, expect, it, vi } from "vitest";
import { notionConfig } from "./config.server";

afterEach(() => vi.unstubAllEnvs());

describe("Notion server configuration", () => {
  it("requires one exact callback URL and a 32-byte encryption key", () => {
    vi.stubEnv("NOTION_CLIENT_ID", "test-client");
    vi.stubEnv("NOTION_CLIENT_SECRET", "test-secret");
    vi.stubEnv("NOTION_TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("NOTION_REDIRECT_URI", "https://mellox.ai/api/integrations/notion/callback");
    expect(notionConfig().redirectUri).toBe("https://mellox.ai/api/integrations/notion/callback");
    vi.stubEnv("NOTION_REDIRECT_URI", "http://localhost:8080/api/integrations/notion/callback");
    expect(notionConfig().redirectUri).toBe(
      "http://localhost:8080/api/integrations/notion/callback",
    );
    vi.stubEnv(
      "NOTION_REDIRECT_URI",
      "https://mellox.ai/api/integrations/notion/callback, http://localhost:8080/api/integrations/notion/callback",
    );
    expect(() => notionConfig()).toThrow("Notion callback URL is invalid.");
    vi.stubEnv("NOTION_REDIRECT_URI", "https://mellox.ai/api/integrations/notion/callback");
    vi.stubEnv(
      "NOTION_REDIRECT_URI",
      "https://mellox.ai/api/integrations/notion/callback?next=other",
    );
    expect(() => notionConfig()).toThrow("Notion callback URL is invalid.");
    vi.stubEnv("NOTION_REDIRECT_URI", "https://mellox.ai/api/integrations/notion/callback");
    vi.stubEnv("NOTION_TOKEN_ENCRYPTION_KEY", "short");
    expect(() => notionConfig()).toThrow("must be a base64-encoded 32-byte key");
  });
});
