import { describe, expect, it } from "vitest";
import { config } from "dotenv";
import { siteForNamedCompetitor } from "@/lib/competitors/resolve-name";

config({ path: ".env", quiet: true });
config({ path: ".env.local", override: true, quiet: true });

const describeLive = process.env.TAVILY_API_KEY?.trim() ? describe : describe.skip;

describeLive("Brand DNA name resolution (live)", () => {
  it("finds an official competitor site from a scan-supplied name", async () => {
    const { webSearch } = await import("@/server/research/web-search.server");
    const sources = await webSearch('"Buffer" official website social media management', {
      limit: 6,
      perHost: 1,
      route: "competitors.resolve-name.live",
    });
    expect(siteForNamedCompetitor("Buffer", sources, "example.com")?.url).toContain("buffer.com");
  }, 60_000);
});
