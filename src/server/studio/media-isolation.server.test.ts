import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ sign: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("@/server/assets/persist.server", () => ({
  signAssetPath: mocks.sign,
  persistAsset: vi.fn(),
  linkAssetToContent: vi.fn(),
}));
import { presentJob } from "./runner.server";

describe("Studio stored media isolation", () => {
  it("never signs a forged path or presents its stale URL", async () => {
    const row = {
      workspace_id: "00000000-0000-4000-8000-000000000001",
      output: {
        media: [
          {
            status: "ready",
            storagePath: "workspace/00000000-0000-4000-8000-000000000002/assets/r2/a/original.png",
            url: "https://example.com/stale",
          },
        ],
      },
    } as unknown as Parameters<typeof presentJob>[0];
    const job = await presentJob(row);
    expect(job.output?.media?.[0].url).toBeUndefined();
    expect(mocks.sign).not.toHaveBeenCalled();
  });
});
