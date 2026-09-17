import { afterEach, describe, expect, it } from "vitest";
import { firecrawlEnabled } from "./firecrawl-flags.server";

afterEach(() => {
  delete process.env.FIRECRAWL_BASE_URL;
});

describe("firecrawlEnabled", () => {
  it("is off by default", () => {
    expect(firecrawlEnabled()).toBe(false);
  });

  it("turns on once a base URL is configured", () => {
    process.env.FIRECRAWL_BASE_URL = "http://localhost:3002";
    expect(firecrawlEnabled()).toBe(true);
  });
});
