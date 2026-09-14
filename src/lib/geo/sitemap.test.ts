import { describe, expect, it } from "vitest";
import { looksLikeLlmsTxt, looksLikeRobotsTxt, parseSitemap } from "./sitemap";

describe("parseSitemap", () => {
  it("reads urlset locations, decoding entities and CDATA", () => {
    const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://a.io/</loc></url>
      <url><loc> https://a.io/?a=1&amp;b=2 </loc></url>
      <url><loc><![CDATA[https://a.io/c]]></loc></url></urlset>`;
    expect(parseSitemap(xml)).toEqual({
      kind: "urlset",
      locs: ["https://a.io/", "https://a.io/?a=1&b=2", "https://a.io/c"],
    });
  });

  it("recognises sitemap indexes", () => {
    const xml = "<sitemapindex><sitemap><loc>https://a.io/s1.xml</loc></sitemap></sitemapindex>";
    expect(parseSitemap(xml)).toEqual({ kind: "index", locs: ["https://a.io/s1.xml"] });
  });

  it("rejects an HTML shell served at /sitemap.xml", () => {
    expect(parseSitemap("<!doctype html><html><body><loc>x</loc></body></html>").kind).toBe(
      "invalid",
    );
    expect(parseSitemap("").kind).toBe("invalid");
  });
});

describe("shape checks", () => {
  it("accepts llms.txt markdown and rejects HTML or empty bodies", () => {
    expect(looksLikeLlmsTxt("# Acme\n\n> What we do\n", "text/plain")).toBe(true);
    expect(looksLikeLlmsTxt("- [Home](https://a.io/): start here", null)).toBe(true);
    expect(looksLikeLlmsTxt("<!DOCTYPE html><html>…", "text/html")).toBe(false);
    expect(looksLikeLlmsTxt("# Acme", "text/html; charset=utf-8")).toBe(false);
    expect(looksLikeLlmsTxt("   ", "text/plain")).toBe(false);
  });

  it("accepts robots.txt directives and rejects an SPA shell", () => {
    expect(looksLikeRobotsTxt("User-agent: *\nDisallow:", "text/plain")).toBe(true);
    expect(looksLikeRobotsTxt("<html><body>app</body></html>", "text/html")).toBe(false);
    expect(looksLikeRobotsTxt("hello world", "text/plain")).toBe(false);
  });
});
