import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ send: vi.fn(), sign: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: mocks.rpc } }));
vi.mock("@aws-sdk/client-s3", async (original) => ({
  ...(await original<typeof import("@aws-sdk/client-s3")>()),
  S3Client: class {
    send = mocks.send;
    destroy() {}
  },
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: mocks.sign }));

import {
  isR2StorageEnabled,
  listR2WorkspaceAssetPaths,
  removeAssetObjects,
  signStoragePaths,
  uploadAssetObject,
} from "./storage.server";

const workspace = "00000000-0000-4000-8000-000000000001";
const r2 = `workspace/${workspace}/assets/r2/asset/original.mp4`;
const legacy = `workspace/${workspace}/assets/asset/original.png`;
const from = vi.fn();
const db = { storage: { from } } as unknown as SupabaseClient;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("R2_ACCOUNT_ID", "test-account");
  vi.stubEnv("R2_ACCESS_KEY_ID", "test-access");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret");
  vi.stubEnv("R2_BUCKET_NAME", "private-media");
  vi.stubEnv("R2_ENDPOINT", "");
  mocks.rpc.mockResolvedValue({ data: [], error: null });
  mocks.send.mockResolvedValue({});
  mocks.sign.mockResolvedValue("https://r2.example/signed");
});
afterEach(() => vi.unstubAllEnvs());

describe("private R2 and legacy Supabase storage", () => {
  it("tombstones pending copies and refuses fresh URLs for deleted migration destinations", async () => {
    const target = legacy.replace("/assets/", "/assets/r2/migrated/");
    mocks.rpc.mockImplementation(async (name) => ({
      data:
        name === "resolve_media_storage_paths"
          ? [{ source_path: legacy, target_path: target, status: "verified" }]
          : null,
      error: null,
    }));
    await removeAssetObjects([legacy], db);
    expect(mocks.rpc).toHaveBeenCalledWith("tombstone_migrated_media", { paths: [target] });
    expect(from).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({
      data: [{ source_path: legacy, target_path: target, status: "deleted" }],
      error: null,
    });
    expect((await signStoragePaths(db, [target])).size).toBe(0);
  });

  it("routes cached migration destination paths back to Supabase after rollback", async () => {
    const target = legacy.replace("/assets/", "/assets/r2/migrated/");
    mocks.rpc.mockResolvedValue({
      data: [{ source_path: legacy, target_path: target, status: "rolled_back" }],
      error: null,
    });
    from.mockReturnValue({
      createSignedUrls: vi.fn().mockResolvedValue({
        data: [{ path: legacy, signedUrl: "https://supabase.example/restored" }],
        error: null,
      }),
    });
    expect((await signStoragePaths(db, [target])).get(target)).toBe(
      "https://supabase.example/restored",
    );
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("protects migration originals when production R2 credentials are missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("R2_ACCESS_KEY_ID", "");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "");
    mocks.rpc.mockResolvedValue({
      data: [{ source_path: legacy, target_path: r2, status: "active" }],
      error: null,
    });
    await expect(removeAssetObjects([legacy], db)).rejects.toThrow("not configured");
    expect(from).not.toHaveBeenCalled();
  });
  it("resolves stale migration aliases without exposing or deleting originals", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ source_path: legacy, target_path: r2, status: "active" }],
      error: null,
    });
    const signed = await signStoragePaths(db, [legacy]);
    expect(signed.get(legacy)).toBe("https://r2.example/signed");
    expect(mocks.sign.mock.calls[0][1].input.Key).toBe(r2);
    await removeAssetObjects([legacy], db);
    expect(from).not.toHaveBeenCalled();
    expect(mocks.send.mock.calls[0][0].input.Delete.Objects).toEqual([{ Key: r2 }]);
  });

  it("refuses cross-workspace aliases, deleted objects and lookup outages", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          source_path: legacy,
          target_path: r2.replace(workspace, "00000000-0000-4000-8000-000000000002"),
          status: "active",
        },
      ],
      error: null,
    });
    await expect(signStoragePaths(db, [legacy])).rejects.toThrow("Invalid migrated workspace");
    mocks.rpc.mockResolvedValueOnce({
      data: [{ source_path: legacy, target_path: r2, status: "deleted" }],
      error: null,
    });
    expect((await signStoragePaths(db, [legacy])).size).toBe(0);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "08006" } });
    await expect(signStoragePaths(db, [legacy])).rejects.toThrow("Could not resolve");
    expect(from).not.toHaveBeenCalled();
  });

  it("signs mixed paths through their original backends and deduplicates", async () => {
    const createSignedUrls = vi.fn().mockResolvedValue({
      data: [{ path: legacy, signedUrl: "https://supabase.example/signed" }],
      error: null,
    });
    from.mockReturnValue({ createSignedUrls });
    const signed = await signStoragePaths(db, [r2, legacy, r2]);
    expect(signed.size).toBe(2);
    expect(createSignedUrls).toHaveBeenCalledWith([legacy], 3600);
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    expect(mocks.sign.mock.calls[0][1].input.Key).toBe(r2);
  });

  it("rejects malformed marked paths before signing or deleting any legacy data", async () => {
    const malformed = `workspace/${workspace}/assets/r2/../other/original.mp4`;
    await expect(signStoragePaths(db, [legacy, malformed])).rejects.toThrow("Invalid R2");
    await expect(removeAssetObjects([legacy, malformed], db)).rejects.toThrow("Invalid R2");
    expect(from).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("keeps R2 writes private and uses the supplied media MIME type", async () => {
    await uploadAssetObject(r2, new Uint8Array([1, 2]), "video/mp4");
    expect(mocks.send.mock.calls[0][0].input).toMatchObject({
      Bucket: "private-media",
      Key: r2,
      ContentType: "video/mp4",
    });
    expect(mocks.send.mock.calls[0][0].input.ACL).toBeUndefined();
  });

  it("batches R2 deletion and surfaces per-object failures", async () => {
    const paths = Array.from({ length: 1001 }, (_, i) => r2.replace("asset/", `${i}/`));
    await removeAssetObjects(paths, db);
    expect(mocks.send.mock.calls.map(([command]) => command.input.Delete.Objects.length)).toEqual([
      1000, 1,
    ]);
    mocks.send.mockResolvedValueOnce({ Errors: [{ Code: "AccessDenied" }] });
    await expect(removeAssetObjects([r2], db)).rejects.toThrow("Could not delete 1 R2");
  });

  it("lists every page under the exact workspace prefix", async () => {
    mocks.send
      .mockResolvedValueOnce({
        Contents: [{ Key: r2 }],
        IsTruncated: true,
        NextContinuationToken: "next",
      })
      .mockResolvedValueOnce({ Contents: [{ Key: r2.replace("asset/", "second/") }] });
    expect(await listR2WorkspaceAssetPaths(workspace)).toHaveLength(2);
    expect(mocks.send.mock.calls[1][0].input).toMatchObject({
      Prefix: `workspace/${workspace}/assets/r2/`,
      ContinuationToken: "next",
    });
    await expect(listR2WorkspaceAssetPaths("../")).rejects.toThrow("Invalid workspace");
  });

  it("fails closed for incomplete credentials and untrusted endpoints", () => {
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "");
    expect(() => isR2StorageEnabled()).toThrow("incomplete");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret");
    vi.stubEnv("R2_ENDPOINT", "https://test-account.r2.cloudflarestorage.com:8443");
    expect(() => isR2StorageEnabled()).toThrow("match");
    vi.stubEnv("R2_ENDPOINT", "https://attacker.example");
    expect(() => isR2StorageEnabled()).toThrow("match");
  });
});
