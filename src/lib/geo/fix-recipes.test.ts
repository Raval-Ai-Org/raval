import { describe, expect, it } from "vitest";
import { fixRecipeFor } from "./fix-recipes";

const ctx = { url: "https://www.acme.io/pricing", brandName: "Acme", description: "Acme ships." };

describe("fixRecipeFor", () => {
  it("fills snippets with the scanned site's origin instead of placeholders", () => {
    for (const id of [
      "llms",
      "bots",
      "sitemap",
      "canonical",
      "ld",
      "og",
      "breadcrumbs",
      "article-schema",
    ]) {
      const code = fixRecipeFor(id, ctx)?.code ?? "";
      expect(code, id).toContain("https://www.acme.io");
      expect(code, id).not.toContain("example.com");
    }
  });

  it("targets the finding's page for page-level fixes", () => {
    const code = fixRecipeFor("canonical", {
      ...ctx,
      pageUrl: "https://www.acme.io/blog/post",
    })!.code!;
    expect(code).toContain('href="https://www.acme.io/blog/post"');
  });

  it("writes llms.txt in the llmstxt.org shape, not robots.txt directives", () => {
    const code = fixRecipeFor("llms", ctx)!.code!;
    expect(code.startsWith("# Acme\n\n> Acme ships.")).toBe(true);
    expect(code).toContain("- [Home](https://www.acme.io/)");
    expect(code).not.toMatch(/^(Allow|Disallow):/m);
  });

  it("emits parseable JSON-LD", () => {
    for (const id of ["org-schema", "faq", "breadcrumbs", "article-schema"]) {
      const code = fixRecipeFor(id, ctx)!.code!;
      expect(() => JSON.parse(code.replace(/<\/?script[^>]*>/g, "")), id).not.toThrow();
    }
    const org = JSON.parse(fixRecipeFor("org-schema", ctx)!.code!.replace(/<\/?script[^>]*>/g, ""));
    expect(org["@graph"][0]).toMatchObject({ "@type": "Organization", name: "Acme" });
  });

  it("falls back to the hostname and escapes brand names in attributes", () => {
    expect(fixRecipeFor("title", { url: "acme.io" })!.code).toContain("acme.io");
    const code = fixRecipeFor("og", { url: "https://a.io", brandName: 'Say "hi"' })!.code!;
    expect(code).toContain('content="Say &quot;hi&quot;"');
  });

  it("gives steps (not invented facts) for editorial fixes and null for unknown ids", () => {
    for (const id of ["https", "cite-sources", "about", "thin-content", "broken-pages"]) {
      expect(fixRecipeFor(id, ctx)?.steps?.length, id).toBeGreaterThan(0);
    }
    expect(fixRecipeFor("nope", ctx)).toBeNull();
  });
});
