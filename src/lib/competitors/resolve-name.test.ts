import { describe, expect, it } from "vitest";
import type { WebSource } from "@/lib/research/sources";
import { siteForNamedCompetitor } from "./resolve-name";

const source = (url: string): WebSource => ({
  url,
  title: url,
  snippet: "Official website",
  provider: "tavily",
});

describe("scan competitor name resolution", () => {
  it("uses the company's own site even when a directory ranks first", () => {
    const result = siteForNamedCompetitor(
      "Buffer",
      [source("https://g2.com/products/buffer"), source("https://buffer.com")],
      "example.com",
    );
    expect(result?.url).toBe("https://buffer.com");
  });

  it("does not resolve the brand's own domain or an unrelated namesake", () => {
    expect(siteForNamedCompetitor("Acme", [source("https://acme.com")], "acme.com")).toBeNull();
    expect(
      siteForNamedCompetitor("Buffer", [source("https://unrelated.com")], "example.com"),
    ).toBeNull();
  });

  it("supports short distinct names without accepting generic words", () => {
    expect(siteForNamedCompetitor("SAP", [source("https://sap.com")], "example.com")?.url).toBe(
      "https://sap.com",
    );
    expect(
      siteForNamedCompetitor("The AI Company", [source("https://company.com")], "example.com"),
    ).toBeNull();
  });
});
