import { beforeEach, expect, it, vi } from "vitest";
import { DirectionSchema } from "@/lib/brand-visuals/contracts";
const mock = vi.hoisted(() => ({ from: vi.fn(), sign: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: mock.from } }));
vi.mock("@/server/assets/storage.server", () => ({ signStoragePath: mock.sign }));
import {
  compileVisualSnapshot,
  loadGenerationVisualSnapshot,
  resolveVisualReferenceUrls,
} from "./service.server";
beforeEach(() => {
  vi.clearAllMocks();
  mock.from.mockImplementation(() => {
    throw new Error("Evidence database unavailable");
  });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
it("generation can use the original flow when evidence storage fails while strict editing still reports the error", async () => {
  expect(await loadGenerationVisualSnapshot("workspace", "image")).toBeNull();
  await expect(compileVisualSnapshot("workspace", "image")).rejects.toThrow(
    "Evidence database unavailable",
  );
});
it("unavailable optional references cannot fail a paid render or sign an unverified asset", async () => {
  const urls = await resolveVisualReferenceUrls("workspace", {
    profileId: "profile",
    direction: DirectionSchema.parse({ name: "Editorial", summary: "Warm paper", visual: {} }),
    rules: "Keep the approved identity",
    warnings: [],
    references: [
      { sourceId: "source", assetId: "asset", storagePath: "unverified", purpose: "style" },
    ],
  });
  expect(urls).toEqual([]);
  expect(mock.sign).not.toHaveBeenCalled();
});
