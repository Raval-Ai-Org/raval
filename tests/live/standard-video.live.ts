// One real Standard video (Grok Imagine 1.5 on KIE) made through the app's
// own code: the typed-script builder, the Creator format prompt, the prompt
// fitting and the KIE request. About $0.18 (36 KIE credits); runs only behind
// STANDARD_VIDEO_LIVE=yes and stores nothing in the database. The video and
// the prompt sent are written to STANDARD_VIDEO_LIVE_OUT (default: OS temp).
//   STANDARD_VIDEO_LIVE=yes npx vitest run --config vitest.live.config.ts tests/live/standard-video.live.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const live =
  process.env.KIE_API_KEY && process.env.STANDARD_VIDEO_LIVE === "yes" ? describe : describe.skip;

live("Standard video on Grok Imagine 1.5 (live)", () => {
  it("renders an 8 s Creator video from a typed script", async () => {
    const out = process.env.STANDARD_VIDEO_LIVE_OUT || join(tmpdir(), "standard-video-live");
    mkdirSync(out, { recursive: true });
    const { BriefSchema, ProductSchema } = await import("@/lib/ugc/schemas");
    const { scriptFromText } = await import("@/lib/ugc/script-text");
    const { ugcFormat } = await import("@/lib/ugc/formats");
    const { buildModelPrompt } = await import("@/lib/ugc/prompt-adapters");
    const { UGC_MODELS } = await import("@/lib/ugc/models");
    const { buildKieInput, kieModelId } = await import("@/server/ugc/providers/kie.server");
    const { createKieTask, getKieTask } = await import("@/lib/kie-gateway.server");

    const model = UGC_MODELS.standard;
    const product = ProductSchema.parse({
      name: "Northwind Cold Brew",
      brand: "Northwind",
      description: "Ready-to-drink oat-milk cold brew coffee in a 330 ml can, no sugar added.",
      category: "Coffee",
      facts: [
        { id: "f1", text: "No sugar added", source: "user" },
        { id: "f2", text: "330 ml can", source: "user" },
      ],
    });
    const format = ugcFormat("car-confessional")!;
    const brief = BriefSchema.parse({ format: format.id, objective: "awareness", durationSec: 8 });
    const script = scriptFromText(
      "Okay, confession: I stopped buying café coffee. This oat-milk cold brew has no sugar added and it's honestly better.",
      8,
      { format },
    );
    expect(script).not.toBeNull();
    const prompt = buildModelPrompt({
      product,
      brief,
      script: script!,
      model,
      durationSec: 8,
      aspectRatio: "9:16",
      imageCount: 0,
      seed: "live:standard",
    });
    const input = buildKieInput({
      model,
      prompt,
      imageUrls: [],
      durationSec: 8,
      aspectRatio: "9:16",
      resolution: "720p",
    } as never);
    writeFileSync(
      join(out, "prompt.txt"),
      `${prompt.length} chars built\n\n${String(input.prompt)}`,
    );
    expect(String(input.prompt).length).toBeLessThanOrEqual(4096);

    const { taskId } = await createKieTask({ model: kieModelId(model, 0), input });
    const started = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 10_000));
      const task = await getKieTask(taskId);
      if (task.state === "pending" && Date.now() - started < 15 * 60_000) continue;
      expect(task.state, task.failMessage ?? "").toBe("success");
      const video = Buffer.from(await (await fetch(task.urls[0])).arrayBuffer());
      writeFileSync(join(out, "standard.mp4"), video);
      console.info(
        `standard: ${task.creditsConsumed} credits, ${Math.round((Date.now() - started) / 1000)} s, prompt ${prompt.length} → ${String(input.prompt).length} chars, ${out}`,
      );
      break;
    }
  }, 1_000_000);
});
