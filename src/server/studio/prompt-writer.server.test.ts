import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyContext } from "@/lib/studio/prompts";

const run = vi.fn();
vi.mock("@/lib/ai", () => ({ runStructuredPrompt: (opts: unknown) => run(opts) }));
vi.mock("@/server/guardrails/events", () => ({ logGuardrailEvent: vi.fn() }));
vi.mock("./context.server", () => ({
  loadStudioContext: async () => ({
    ...emptyContext("Huila Coffee"),
    brandText: "Brand: Huila Coffee\nVoice: warm",
    opportunities: ["Cold brew searches are rising fast this week"],
    recent: [
      {
        title: "Meet our farmers",
        type: "social",
        channel: "instagram",
        angle: null,
        createdAt: "2026-09-01",
      },
    ],
  }),
}));

const { writeStudioPrompt } = await import("./prompt-writer.server");

const longPrompt = `Idea: ${"A vivid, specific idea. ".repeat(30)}`;

beforeEach(() => {
  run.mockReset();
  run.mockResolvedValue({
    title: "Cold brew season, the Huila way",
    prompt: `## ${longPrompt}`,
    why: "Cold brew searches are rising this week",
    goal: "engagement",
  });
});

describe("writeStudioPrompt", () => {
  it("writes a fresh, uncached, sectioned prompt anchored on a live signal", async () => {
    const out = await writeStudioPrompt({
      client: {},
      workspaceId: "00000000-0000-0000-0000-000000000001",
      brand: null,
      type: "image",
      controls: { platforms: ["instagram"], ratio: "4:5" },
      avoid: ["Old idea"],
    });

    const call = run.mock.calls[0][0];
    expect(call.route).toBe("studio.prompt");
    expect(call.noCache).toBe(true);
    expect(call.regenerate).toBe(true);
    expect(call.system).toContain("Camera and composition");
    expect(call.system).toContain("Invent one fresh");
    expect(call.user).toContain("Cold brew searches are rising");
    expect(call.user).toContain("Meet our farmers");
    expect(call.user).toContain("Old idea");
    expect(call.user).toContain("Size: 4:5");

    expect(out.prompt.startsWith("Idea:")).toBe(true);
    expect(out.basedOn).toBeTruthy();
    expect(out.goal).toBe("engagement");
  });

  it("expands the person's own idea instead of replacing it", async () => {
    await writeStudioPrompt({
      client: {},
      workspaceId: "00000000-0000-0000-0000-000000000001",
      brand: null,
      type: "social",
      current: "Post about our new oat milk latte for rainy mornings",
    });
    const call = run.mock.calls[0][0];
    expect(call.system).toContain("Keep their idea");
    expect(call.user).toContain("new oat milk latte for rainy mornings");
  });

  it("treats an untouched template starter as a structure to fill", async () => {
    await writeStudioPrompt({
      client: {},
      workspaceId: "00000000-0000-0000-0000-000000000001",
      brand: null,
      type: "carousel",
      template: "carousel-myth-fact",
      current: "Bust [number] common myths about [topic] that [audience] still believe.",
    });
    const call = run.mock.calls[0][0];
    expect(call.system).toContain("Invent one fresh");
    expect(call.user).toContain("Myths vs facts");
  });
});
