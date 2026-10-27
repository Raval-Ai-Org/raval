import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({ sign: vi.fn() }));
vi.mock("@/server/assets/persist.server", () => ({ signAssetPath: mocks.sign }));
import { resolveStudioReferences } from "./references.server";

const workspace = "00000000-0000-4000-8000-000000000001";
const owned = {
  id: "photo",
  filename: "product.png",
  status: "ready",
  asset_type: "image",
  mime_type: "image/png",
  storage_path: `workspace/${workspace}/assets/photo/original.png`,
};
function client(rows: Record<string, unknown>[]) {
  const eq = vi.fn().mockReturnThis();
  const inIds = vi.fn().mockResolvedValue({ data: rows, error: null });
  return {
    db: { from: () => ({ select: () => ({ eq, in: inIds }) }) } as unknown as SupabaseClient,
    eq,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.sign.mockResolvedValue("https://owned.test/signed-product.png");
});
describe("Studio source photo isolation", () => {
  it("scopes the query to the job workspace and returns only authorized photo URLs", async () => {
    const { db, eq } = client([owned]);
    expect(await resolveStudioReferences(db, workspace, ["photo", "photo"])).toEqual([
      {
        id: "photo",
        filename: "product.png",
        mimeType: "image/png",
        storagePath: owned.storage_path,
        url: "https://owned.test/signed-product.png",
      },
    ]);
    expect(eq).toHaveBeenCalledWith("workspace_id", workspace);
  });
  it.each([
    { rows: [] },
    { rows: [{ ...owned, asset_type: "video" }] },
    { rows: [{ ...owned, status: "failed" }] },
    { rows: [{ ...owned, storage_path: "workspace/other-brand/assets/photo/original.png" }] },
  ])("rejects missing, invalid or foreign media before signing", async ({ rows }) => {
    await expect(resolveStudioReferences(client(rows).db, workspace, ["photo"])).rejects.toThrow(
      "unavailable",
    );
    expect(mocks.sign).not.toHaveBeenCalled();
  });
});
