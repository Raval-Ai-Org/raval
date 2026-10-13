import { describe, expect, it } from "vitest";
import { PRODUCTION_URL, SITE_URL, resolveSiteUrl, serializeJsonLd } from "./seo";
import robots from "@/app/robots";

describe("public search metadata", () => {
  it("normalizes paths, queries and fragments to one canonical origin", () => {
    expect(resolveSiteUrl(" https://mellox.ai/path?source=test#hero ", true)).toBe(PRODUCTION_URL);
  });
  it.each([
    "invalid",
    "ftp://mellox.ai",
    "https://user:pass@mellox.ai",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://[::1]:8080",
  ])("rejects invalid production origins: %s", (value) => {
    expect(resolveSiteUrl(value, true)).toBe(PRODUCTION_URL);
  });
  it("supports a deployment origin and local development", () => {
    expect(resolveSiteUrl("https://preview.example.com/something", true)).toBe(
      "https://preview.example.com",
    );
    expect(resolveSiteUrl("http://localhost:8080", false)).toBe("http://localhost:8080");
  });
  it("uses the same origin for robots and sitemap discovery", () => {
    expect(robots().sitemap).toBe(SITE_URL + "/sitemap.xml");
    expect(robots().rules).toMatchObject({ userAgent: "*", allow: "/" });
  });
  it("keeps JSON-LD safe when content contains closing script tags", () => {
    expect(serializeJsonLd({ name: "</script>" })).not.toContain("<");
  });
});
