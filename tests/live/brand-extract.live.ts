// Live check of the Brand DNA extraction pipeline: a real crawl of a public
// site and a real Claude synthesis. Opt-in (costs one extraction's tokens):
//   npx vitest run --config vitest.live.config.ts tests/live/brand-extract.live.ts
// BRAND_EXTRACT_LIVE_URL picks the site; BRAND_EXTRACT_LIVE_OUT writes the
// timed event log to a file (useful for replaying the onboarding UI).
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BrandExtractEvent } from "@/lib/brand-extract-events";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const SITE = process.env.BRAND_EXTRACT_LIVE_URL || "https://stripe.com";
const describeLive = process.env.OPENROUTER_API_KEY ? describe : describe.skip;

describeLive("brand extraction (live)", () => {
  it("streams real discoveries, in pipeline order, before the result", async () => {
    const { runBrandExtraction } = await import("@/lib/brand-extract.server");
    const started = Date.now();
    const log: { at: number; event: BrandExtractEvent }[] = [];

    await runBrandExtraction(new URL(SITE), (event) =>
      log.push({ at: Date.now() - started, event }),
    );

    if (process.env.BRAND_EXTRACT_LIVE_OUT)
      writeFileSync(process.env.BRAND_EXTRACT_LIVE_OUT, JSON.stringify(log, null, 2));

    const labels = log.map(({ event }) =>
      event.type === "discovery" ? `discovery:${event.kind}` : event.type,
    );
    const errors = log.flatMap(({ event }) => (event.type === "error" ? [event.error] : []));
    expect(errors).toEqual([]);

    const order = [
      "discovery:site",
      "discovery:pages",
      "discovery:identity",
      "discovery:market",
      "result",
    ];
    const positions = order.map((label) => labels.indexOf(label));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    const site = log.find(
      ({ event }) => event.type === "discovery" && event.kind === "site",
    )?.event;
    expect(
      site && site.type === "discovery" && site.kind === "site" && site.data.hostname,
    ).toBeTruthy();
    const result = log.find(({ event }) => event.type === "result")?.event;
    expect(
      result?.type === "result" && (result.data as { brandName?: string }).brandName,
    ).toBeTruthy();
  }, 240_000);
});
