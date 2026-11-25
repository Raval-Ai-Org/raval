// Live: run the real Brand DNA scan on several sites and write a timed log.
//   SITES=a.com,b.com OUT=log.txt npx vitest run --config vitest.live.config.ts tests/live/brand-multi.live.ts
import { appendFileSync } from "node:fs";
import { describe, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env.
}

const SITES = (process.env.SITES ?? "").split(",").filter(Boolean);
const describeLive = SITES.length ? describe : describe.skip;

describeLive("brand extraction across sites (live)", () => {
  it.each(SITES)(
    "%s",
    async (site) => {
      const { runBrandExtraction } = await import("@/lib/brand-extract.server");
      const { setUsageSink } = await import("@/server/ai/metering");
      const usage: string[] = [];
      const restore = setUsageSink(async (r) => {
        usage.push(`   usage ${r.route} ${r.model} ${r.status} ${r.latencyMs ?? ""}ms`);
      });
      const started = Date.now();
      const lines: string[] = [];
      await runBrandExtraction(new URL(`https://${site}`), (e) => {
        const at = Math.round((Date.now() - started) / 1000);
        if (e.type === "error") lines.push(`${at}s ERROR ${e.stage} ${e.code} ${e.error}`);
        else if (e.type === "result")
          lines.push(`${at}s RESULT ${(e.data as { brandName?: string })?.brandName}`);
        else if (e.type === "progress") lines.push(`${at}s ${e.stage} ${e.message}`);
      });
      appendFileSync(process.env.OUT ?? "brand-multi.txt", `== ${site}\n${lines.join("\n")}\n`);
    },
    400_000,
  );
});
