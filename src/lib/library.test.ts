import { describe, expect, it } from "vitest";
import { inferLibraryAssetType, normalizeLibraryAsset } from "./library";

describe("library asset normalization", () => {
  it("infers image assets from URLs and metadata", () => {
    const asset = normalizeLibraryAsset({
      id: "asset-1",
      title: "Product launch hero",
      media_url: "https://cdn.example.com/images/launch.png",
      kind: "social-post",
      status: "approved",
      created_at: "2026-01-15T10:00:00Z",
      updated_at: "2026-01-15T11:00:00Z",
      workspace_id: "ws-1",
    });

    expect(inferLibraryAssetType(asset.url)).toBe("image");
    expect(asset.type).toBe("image");
    expect(asset.name).toBe("Product launch hero");
  });

  it("infers video assets from provider video URLs", () => {
    const asset = normalizeLibraryAsset({
      id: "asset-2",
      title: null,
      media_url: "https://cdn.example.com/videos/reel.mp4",
      kind: "video",
      status: "ready",
      created_at: "2026-01-10T12:00:00Z",
      updated_at: "2026-01-12T15:00:00Z",
      workspace_id: "ws-1",
    });

    expect(inferLibraryAssetType(asset.url)).toBe("video");
    expect(asset.type).toBe("video");
    expect(asset.name).toMatch(/reel/i);
  });
});
