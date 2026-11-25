// Live check that a site behind a bot wall is still read for Brand DNA (free:
// page fetches only, no model call):
//   npx vitest run --config vitest.live.config.ts tests/live/brand-read-blocked.live.ts
// BRAND_READ_LIVE_URL picks the site (default dove.com, which answers 403).
import { describe, expect, it } from "vitest";

const SITE = process.env.BRAND_READ_LIVE_URL || "https://www.dove.com/";

describe("reading a blocked brand site (live)", () => {
  it("gets real HTML from the site's public archived copy", async () => {
    const { readSitePage } = await import("@/lib/brand-extract.server");
    const read = await readSitePage(SITE, { timeoutMs: 10_000, archive: true });
    console.log(`[brand-read] ${SITE} via ${read.via}, ${read.html.length} chars`);
    expect(read.via).not.toBe("none");
    expect(read.html).toMatch(/<title/i);
  }, 60_000);
});
