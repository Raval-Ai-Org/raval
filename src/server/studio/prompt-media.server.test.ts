import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("@/server/assets/persist.server", () => ({ signAssetPath: vi.fn() }));
vi.mock("@/server/safe-fetch", () => ({ safeFetch: vi.fn() }));
import { attachedMedia, loadPromptMedia } from "./prompt-media.server";

const workspace = "00000000-0000-4000-8000-000000000001";

describe("attachedMedia", () => {
  it("uses the photos for a picture", () => {
    expect(attachedMedia("image", { referenceAssetIds: ["a", "b"] })).toEqual({
      photoIds: ["a", "b"],
      clipIds: [],
    });
  });

  it("uses only the clips for a video made from clips", () => {
    expect(
      attachedMedia("video", {
        videoMode: "brand",
        sourceVideoAssetIds: ["c"],
        referenceAssetIds: ["a"],
      }),
    ).toEqual({ photoIds: [], clipIds: ["c"] });
  });

  it("uses nothing for a website reel", () => {
    expect(attachedMedia("video", { videoMode: "site", referenceAssetIds: ["shot"] })).toEqual({
      photoIds: [],
      clipIds: [],
    });
  });
});

describe("loadPromptMedia", () => {
  it("reads nothing when nothing is attached", async () => {
    const from = vi.fn();
    const media = await loadPromptMedia({
      client: { from } as unknown as SupabaseClient,
      workspaceId: workspace,
      type: "image",
      controls: {},
    });
    expect(media).toEqual({ images: [], note: "" });
    expect(from).not.toHaveBeenCalled();
  });

  it("writes without the photos when one is not in the workspace", async () => {
    const inIds = vi.fn().mockResolvedValue({ data: [], error: null });
    const client = {
      from: () => ({ select: () => ({ eq: () => ({ in: inIds }) }) }),
    } as unknown as SupabaseClient;
    const media = await loadPromptMedia({
      client,
      workspaceId: workspace,
      type: "image",
      controls: { referenceAssetIds: ["someone-elses"] },
    });
    expect(media).toEqual({ images: [], note: "" });
  });
});
