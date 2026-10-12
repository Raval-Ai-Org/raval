import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb, type MemoryDb } from "../fixtures/memory-supabase";

const mocks = vi.hoisted(() => ({
  db: null as MemoryDb | null,
  upload: vi.fn(),
  sign: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => mocks.db!.from(table) },
}));
vi.mock("@/lib/feature-flags", () => ({ isAssetMetadataFinalizeEnabled: () => false }));
vi.mock("@/server/assets/storage.server", () => ({
  ASSET_BUCKET: "generated-assets",
  isR2StorageEnabled: () => true,
  r2AssetPath: (ws: string, id: string, name: string) => `workspace/${ws}/assets/r2/${id}/${name}`,
  uploadAssetObject: mocks.upload,
  signStoragePath: mocks.sign,
  removeAssetObjects: mocks.remove,
}));
import { persistAsset } from "@/server/assets/persist.server";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const input = {
  workspaceId,
  idempotencyKey: "generated-image",
  assetType: "image" as const,
  dataUrl: "data:image/png;base64,AQID",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.db = createMemoryDb({}, { unique: { assets: [["workspace_id", "idempotency_key"]] } });
  mocks.upload.mockResolvedValue(undefined);
  mocks.sign.mockResolvedValue("https://r2.example/signed");
  mocks.remove.mockResolvedValue(undefined);
});

describe("generated media persistence", () => {
  it("stores durable paths while keeping signed URLs out of database rows", async () => {
    const result = await persistAsset(input);
    expect(result.ok).toBe(true);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    const stored = await mocks.db!.from("assets").select("*").single();
    expect(stored.data).toMatchObject({ status: "ready", public_url: null });
    expect(stored.data.storage_path).toContain("/assets/r2/");
    const again = await persistAsset(input);
    expect(again).toMatchObject({ ok: true, deduplicated: true });
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });

  it("prevents concurrent retries from overwriting or deleting the winning upload", async () => {
    let release!: () => void;
    const uploading = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const start = new Promise<void>((resolve) => {
      started = resolve;
    });
    mocks.upload.mockImplementationOnce(() => {
      started();
      return uploading;
    });
    const first = persistAsset(input);
    await start;
    expect(await persistAsset(input)).toMatchObject({ ok: false, status: 409 });
    release();
    expect((await first).ok).toBe(true);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("does not resurrect deleted media", async () => {
    await mocks.db!.from("assets").insert({
      ...input,
      workspace_id: workspaceId,
      idempotency_key: input.idempotencyKey,
      status: "ready",
      deleted_at: new Date().toISOString(),
    });
    expect(await persistAsset(input)).toMatchObject({ ok: false, status: 410 });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("can retry after signing and cleanup both fail", async () => {
    mocks.sign.mockRejectedValueOnce(new Error("signing failed"));
    mocks.remove.mockRejectedValueOnce(new Error("cleanup unavailable"));
    expect(await persistAsset(input)).toMatchObject({ ok: false, status: 502 });
    expect(mocks.db!.rows("assets")[0].status).toBe("persistence_failed");
    expect((await persistAsset(input)).ok).toBe(true);
  });

  it("reclaims an expired persistence lease without creating a second row", async () => {
    await mocks.db!.from("assets").insert({
      id: "stale-asset",
      workspace_id: workspaceId,
      idempotency_key: input.idempotencyKey,
      status: "persisting",
      updated_at: new Date(Date.now() - 16 * 60_000).toISOString(),
    });
    expect((await persistAsset(input)).ok).toBe(true);
    expect(mocks.db!.rows("assets")).toHaveLength(1);
  });

  it("rejects executable and mismatched media types before creating an asset", async () => {
    expect(await persistAsset({ ...input, dataUrl: "data:text/html;base64,AQID" })).toMatchObject({
      ok: false,
      status: 415,
    });
    expect(await persistAsset({ ...input, assetType: "video" })).toMatchObject({
      ok: false,
      status: 415,
    });
    expect(mocks.db!.writes).toHaveLength(0);
  });
});
