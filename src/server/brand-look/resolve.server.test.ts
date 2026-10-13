import { beforeEach, expect, it, vi } from "vitest";
import { resolveLook } from "@/lib/brand-look/resolve";
import { DirectionSchema } from "@/lib/brand-visuals/contracts";
const mock = vi.hoisted(() => ({ visual: vi.fn(), read: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("@/server/workspaces/brand-dna.server", () => ({ readBrandDna: mock.read }));
vi.mock("@/server/brand-visuals/service.server", () => ({
  loadGenerationVisualSnapshot: mock.visual,
}));
import { invalidateLookCache, loadBrandLook } from "./resolve.server";
const dna = {
  voice: "Direct and helpful",
  colors: [{ hex: "#123456" }],
  look: { writing: { emoji: "none" }, visual: { medium: "illustration" } },
};
beforeEach(() => {
  vi.clearAllMocks();
  invalidateLookCache("workspace");
  mock.read.mockResolvedValue({ dna });
});
it("keeps existing writing/chat look resolution and cache independent of visual evidence", async () => {
  expect((await loadBrandLook("workspace")).look).toEqual(resolveLook(dna as never));
  expect((await loadBrandLook("workspace")).look).toEqual(resolveLook(dna as never));
  expect(mock.read).toHaveBeenCalledTimes(1);
  expect(mock.visual).not.toHaveBeenCalled();
});
it("media callers add approved detail while preserving explicit manual style and writing", async () => {
  mock.visual.mockResolvedValue({
    profileId: "approved",
    direction: DirectionSchema.parse({
      name: "Warm editorial",
      summary: "Warm paper and documentary art",
      visual: { medium: "photo", texture: "paper grain" },
    }),
    rules: "Approved editorial identity",
    references: [],
    warnings: [],
  });
  const enriched = await loadBrandLook("workspace", { includeVisualTaste: true });
  expect(enriched.look.visual.medium).toBe("illustration");
  expect(enriched.look.visual.texture).toBe("paper grain");
  expect(enriched.look.writing).toEqual(resolveLook(dna as never).writing);
  expect((await loadBrandLook("workspace")).look.visual.texture).toBeUndefined();
});
it("an absent optional direction produces the original resolved media look", async () => {
  mock.visual.mockResolvedValue(null);
  const loaded = await loadBrandLook("workspace", { dna, includeVisualTaste: true });
  expect(loaded.look).toEqual(resolveLook(dna as never));
});
