// Live check of "Write it for me": real model calls through the metered
// gateway, with a realistic stubbed workspace context (no customer data read).
// Verifies each format's prompt is long, sectioned per its blueprint, within
// the description limit, and different on a second click; and that creator
// video ad notes stay grounded in the product facts. Opt-in (a few cents):
//   npx vitest run --config vitest.live.config.ts tests/live/studio-prompt.live.ts
import { describe, expect, it, vi } from "vitest";
import { emptyContext } from "@/lib/studio/prompts";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

vi.mock("@/server/studio/context.server", () => ({
  loadStudioContext: async () => ({
    ...emptyContext("Huila Roasters"),
    brandText:
      "Brand: Huila Roasters\nOne-liner: Small-batch specialty coffee sourced directly from a farmer co-op in Huila, Colombia.\nVoice: warm, curious, down-to-earth\nAudience: home coffee lovers aged 25-45\nProducts: single-origin beans, cold brew concentrate, pour-over kits",
    industry: "Specialty coffee",
    audience: "Home coffee lovers",
    website: "https://example.com",
    opportunities: ["Searches for 'cold brew at home' are rising quickly this month"],
    risingQueries: ["how to make cold brew concentrate"],
    competitorMoves: ["A large chain launched a seasonal pumpkin cold foam"],
    recent: [
      {
        title: "Meet the farmers behind our Huila beans",
        type: "social",
        channel: "instagram",
        angle: null,
        createdAt: "2026-09-01",
      },
    ],
  }),
}));

const describeLive = process.env.OPENROUTER_API_KEY ? describe : describe.skip;

const WS = "00000000-0000-0000-0000-000000000001";

describeLive("Write it for me (live)", () => {
  it("writes a detailed, sectioned prompt for every kind of creation", async () => {
    const { writeStudioPrompt } = await import("@/server/studio/prompt-writer.server");
    const { PROMPT_BLUEPRINTS, PROMPT_MAX_CHARS } = await import("@/lib/studio/prompt-writer");

    for (const type of ["social", "image", "video", "article"] as const) {
      const out = await writeStudioPrompt({
        client: {},
        workspaceId: WS,
        brand: null,
        type,
        controls: type === "video" ? { platforms: ["tiktok"], durationSec: 8 } : undefined,
      });
      const words = out.prompt.split(/\s+/).length;
      const missing = PROMPT_BLUEPRINTS[type].sections.filter(
        (label) => !out.prompt.toLowerCase().includes(`${label.toLowerCase()}:`),
      );
      console.info(`[live] ${type}: "${out.title}" — ${words} words — ${out.basedOn}: ${out.why}`);
      expect(words).toBeGreaterThan(180);
      expect(out.prompt.length).toBeLessThanOrEqual(PROMPT_MAX_CHARS);
      expect(missing.length).toBeLessThanOrEqual(1);
      expect(out.prompt).not.toMatch(/^#|\*\*/m);
    }
  }, 240_000);

  it("gives a different idea on the next click and expands a person's own idea", async () => {
    const { writeStudioPrompt } = await import("@/server/studio/prompt-writer.server");
    const first = await writeStudioPrompt({
      client: {},
      workspaceId: WS,
      brand: null,
      type: "image",
    });
    const second = await writeStudioPrompt({
      client: {},
      workspaceId: WS,
      brand: null,
      type: "image",
      avoid: [first.title, first.signal ?? ""].filter(Boolean),
    });
    console.info(`[live] image #1 "${first.title}" / #2 "${second.title}"`);
    expect(second.title).not.toBe(first.title);
    expect(second.prompt).not.toBe(first.prompt);

    const expanded = await writeStudioPrompt({
      client: {},
      workspaceId: WS,
      brand: null,
      type: "social",
      current: "Our pour-over kit as a thoughtful gift for a friend's new flat",
    });
    console.info(`[live] expanded: "${expanded.title}"`);
    expect(expanded.prompt.toLowerCase()).toMatch(/pour-over|pour over/);
    expect(expanded.prompt.toLowerCase()).toMatch(/gift/);
  }, 240_000);

  it("writes grounded creative notes for a creator video ad", async () => {
    const { writeCreativeNotes, NOTES_MAX_CHARS } =
      await import("@/server/ugc/notes-writer.server");
    const { BriefSchema, ProductSchema } = await import("@/lib/ugc/schemas");
    const { notes } = await writeCreativeNotes({
      product: ProductSchema.parse({
        name: "Cold Brew Concentrate",
        brand: "Huila Roasters",
        description: "A ready-to-mix cold brew concentrate made from single-origin Huila beans.",
        facts: [
          { id: "f1", text: "Makes 12 drinks per bottle", source: "user" },
          { id: "f2", text: "Mix 1 part concentrate with 2 parts water or milk", source: "user" },
        ],
      }),
      brief: BriefSchema.parse({ platform: "tiktok", format: "demo" }),
      brand: { brandName: "Huila Roasters", voice: "warm, down-to-earth" },
      workspace: { industry: "Specialty coffee" },
    });
    console.info(`[live] notes (${notes.length} chars):\n${notes}`);
    expect(notes.length).toBeGreaterThan(200);
    expect(notes.length).toBeLessThanOrEqual(NOTES_MAX_CHARS);
    expect(notes).toMatch(/Opening hook:/i);
    expect(notes).not.toMatch(/\d+\s?%/);
  }, 120_000);
});
