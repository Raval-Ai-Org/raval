import { describe, expect, it, vi } from "vitest";
import {
  CLIP_RETRIES,
  redoComposedClips,
  withVideoComposition,
  type CompositionRow,
  type CompositionStore,
} from "./composition.server";
import type { VideoProvider, VideoRenderRequest } from "./types";
import { UGC_MODELS } from "@/lib/ugc/models";

function fixture() {
  let row: CompositionRow | null = null;
  const store: CompositionStore = {
    async create(value) {
      row = structuredClone(value);
    },
    async get() {
      return structuredClone(row);
    },
    async save(value, lease_until) {
      if (!row || row.revision !== value.revision) return null;
      row = structuredClone({ ...value, revision: value.revision + 1, lease_until });
      return structuredClone(row);
    },
  };
  let count = 0;
  const base: VideoProvider = {
    id: "fake",
    generationType: () => "TEXT",
    submit: vi.fn<VideoProvider["submit"]>(async (request) => ({
      ok: true,
      taskId: `clip-${++count}`,
      provider: "kie",
      providerModel: request.model.providerModel,
      request: {},
    })),
    check: vi.fn<VideoProvider["check"]>(async (id) => ({
      state: "success",
      providerState: "done",
      videoUrl: `https://videos.example/${id}.mp4`,
      costUsd: 0.5,
      meta: {},
    })),
    download: vi.fn(async () => ({ dataUrl: "data:video/mp4;base64,YQ==", bytes: 1 })),
  };
  const assemble = vi.fn(async () => ({ dataUrl: "data:video/mp4;base64,YWI=", bytes: 2 }));
  const request: VideoRenderRequest = {
    model: UGC_MODELS.premium,
    durationSec: 40,
    prompt: "A product demonstration",
    aspectRatio: "9:16",
    resolution: "720p",
    imageUrls: [],
  };
  return {
    store,
    base,
    assemble,
    request,
    current: () => row!,
    provider: withVideoComposition(base, { store, assemble }),
  };
}

describe("durable video composition", () => {
  it("leaves native ten-second generation on its existing path", async () => {
    const f = fixture();
    const result = await f.provider.submit({ ...f.request, durationSec: 10 });
    expect(result).toMatchObject({ ok: true, taskId: "clip-1" });
    expect(f.current()).toBeNull();
  });

  it("survives a new worker, records every clip, sums cost and assembles one output", async () => {
    const f = fixture();
    const submitted = await f.provider.submit(f.request);
    if (!submitted.ok) throw new Error("Submit failed");
    expect(f.base.submit).not.toHaveBeenCalled();
    const otherWorker = withVideoComposition(f.base, { store: f.store, assemble: f.assemble });
    const result = await otherWorker.check(submitted.taskId);
    expect(result).toMatchObject({
      state: "success",
      videoUrl: submitted.taskId,
      costUsd: 2,
      meta: { clips: 4, duration: 40 },
    });
    expect(f.base.submit).toHaveBeenCalledTimes(4);
    await otherWorker.check(submitted.taskId);
    expect(f.base.submit).toHaveBeenCalledTimes(4);
    expect(await otherWorker.download!(submitted.taskId)).toMatchObject({ bytes: 2 });
    expect(f.assemble).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ seconds: 10 })]),
      true,
      { dissolve: undefined },
    );
    expect(f.current().state.clips.every((clip) => clip.taskId && clip.videoUrl)).toBe(true);
  });

  it("does not duplicate provider submissions when two polls race", async () => {
    const f = fixture();
    const submitted = await f.provider.submit(f.request);
    if (!submitted.ok) throw new Error("Submit failed");
    await Promise.all([f.provider.check(submitted.taskId), f.provider.check(submitted.taskId)]);
    expect(f.base.submit).toHaveBeenCalledTimes(4);
  });

  it("never resubmits an interrupted or uncertain provider submission", async () => {
    const f = fixture();
    const submitted = await f.provider.submit(f.request);
    if (!submitted.ok) throw new Error("Submit failed");
    vi.mocked(f.base.submit).mockRejectedValueOnce(new Error("Connection dropped"));
    await expect(f.provider.check(submitted.taskId)).rejects.toThrow("Connection dropped");
    expect(await f.provider.check(submitted.taskId)).toMatchObject({
      state: "failed",
      message: expect.stringContaining("interrupted"),
    });
    expect(f.base.submit).toHaveBeenCalledTimes(1);
  });

  it("retains accepted clips when a later submission is definitely rate limited", async () => {
    const f = fixture();
    const submitted = await f.provider.submit(f.request);
    if (!submitted.ok) throw new Error("Submit failed");
    vi.mocked(f.base.submit)
      .mockResolvedValueOnce({
        ok: true,
        taskId: "first",
        provider: "kie",
        providerModel: "model",
        request: {},
      })
      .mockResolvedValueOnce({
        ok: false,
        code: "rate_limit",
        message: "Wait",
        retryable: true,
        definite: true,
      });
    expect(await f.provider.check(submitted.taskId)).toMatchObject({ state: "pending" });
    expect(f.current().state.clips[0].taskId).toBe("first");
    expect(await f.provider.check(submitted.taskId)).toMatchObject({ state: "success" });
    expect(f.base.submit).toHaveBeenCalledTimes(5);
  });

  it("makes a clip again after an outage, then finishes the video", async () => {
    const f = fixture();
    const submitted = await f.provider.submit(f.request);
    if (!submitted.ok) throw new Error("Submit failed");
    vi.mocked(f.base.check).mockResolvedValueOnce({
      state: "failed",
      providerState: "failed",
      code: "render_failed",
      message: "Internal server error",
      retryable: true,
      meta: {},
    });
    expect(await f.provider.check(submitted.taskId)).toMatchObject({ state: "pending" });
    expect(f.current().state.clips[0]).toMatchObject({ retries: 1, taskId: undefined });
    expect(await f.provider.check(submitted.taskId)).toMatchObject({ state: "success" });
    expect(f.base.submit).toHaveBeenCalledTimes(5);
  });

  it("stops making a clip again after CLIP_RETRIES outages", async () => {
    const f = fixture();
    const submitted = await f.provider.submit(f.request);
    if (!submitted.ok) throw new Error("Submit failed");
    vi.mocked(f.base.check).mockResolvedValue({
      state: "failed",
      providerState: "failed",
      code: "render_failed",
      message: "Service busy",
      retryable: true,
      meta: {},
    });
    for (let i = 0; i < CLIP_RETRIES; i++)
      expect(await f.provider.check(submitted.taskId)).toMatchObject({ state: "pending" });
    expect(await f.provider.check(submitted.taskId)).toMatchObject({
      state: "failed",
      message: "Service busy",
    });
  });

  it("sends each storyboard clip its own prompt at its whole length", async () => {
    const f = fixture();
    const submitted = await f.provider.submit({
      ...f.request,
      durationSec: 20,
      clips: [
        { seconds: 10, prompt: "Clip one: the hook" },
        { seconds: 10, prompt: "Clip two: the ending" },
      ],
      dissolve: true,
    });
    if (!submitted.ok) throw new Error("Submit failed");
    expect(await f.provider.check(submitted.taskId)).toMatchObject({ state: "success" });
    const sent = vi.mocked(f.base.submit).mock.calls.map(([request]) => request);
    expect(sent.map((request) => request.prompt)).toEqual([
      "Clip one: the hook",
      "Clip two: the ending",
    ]);
    expect(sent.every((request) => request.durationSec === 10)).toBe(true);
    await f.provider.download!(submitted.taskId);
    expect(f.assemble).toHaveBeenCalledWith(expect.any(Array), true, { dissolve: true });
  });

  it("chains clips: each waits for the one before and opens on its last frame", async () => {
    const f = fixture();
    const chainFrame = vi.fn(
      async ({ index }: { index: number }) => `https://frames.example/${index}.jpg`,
    );
    const provider = withVideoComposition(f.base, {
      store: f.store,
      assemble: f.assemble,
      chainFrame,
    });
    vi.mocked(f.base.check).mockResolvedValueOnce({
      state: "pending",
      providerState: "running",
    });
    const submitted = await provider.submit({
      ...f.request,
      durationSec: 20,
      imageUrls: ["https://picture.example/post.jpg", "https://picture.example/style.jpg"],
      clips: [
        { seconds: 10, prompt: "First" },
        { seconds: 10, prompt: "Second" },
      ],
      chain: { workspaceId: "ws", key: "job-1", leadImages: 1 },
    });
    if (!submitted.ok) throw new Error("Submit failed");
    expect(await provider.check(submitted.taskId)).toMatchObject({ state: "pending" });
    // The second clip is not sent while the first is still rendering.
    expect(f.base.submit).toHaveBeenCalledTimes(1);
    // The poll that sees the first clip finish; the next one sends the second.
    expect(await provider.check(submitted.taskId)).toMatchObject({ state: "pending" });
    expect(f.base.submit).toHaveBeenCalledTimes(1);
    expect(await provider.check(submitted.taskId)).toMatchObject({ state: "success" });
    expect(f.base.submit).toHaveBeenCalledTimes(2);
    const second = vi.mocked(f.base.submit).mock.calls[1][0];
    expect(second.imageUrls).toEqual([
      "https://frames.example/1.jpg",
      "https://picture.example/style.jpg",
    ]);
    expect(second.requiredReferenceCount).toBe(1);
  });

  it("makes a clip again with the reason after the checks fail it, counting both costs", async () => {
    const f = fixture();
    const submitted = await f.provider.submit({
      ...f.request,
      durationSec: 20,
      clips: [
        { seconds: 10, prompt: "First" },
        { seconds: 10, prompt: "Second" },
      ],
    });
    if (!submitted.ok) throw new Error("Submit failed");
    expect(await f.provider.check(submitted.taskId)).toMatchObject({
      state: "success",
      costUsd: 1,
    });
    expect(
      await redoComposedClips(submitted.taskId, [1], { 1: "The cup changed colour" }, f.store),
    ).toBe(true);
    expect(await f.provider.check(submitted.taskId)).toMatchObject({
      state: "success",
      costUsd: 1.5,
    });
    expect(f.base.submit).toHaveBeenCalledTimes(3);
    expect(vi.mocked(f.base.submit).mock.calls[2][0].prompt).toContain(
      "FIX FROM THE LAST TRY: The cup changed colour",
    );
  });

  it("propagates a failed clip and prevents downloading an incomplete video", async () => {
    const f = fixture();
    const submitted = await f.provider.submit(f.request);
    if (!submitted.ok) throw new Error("Submit failed");
    vi.mocked(f.base.check).mockResolvedValueOnce({
      state: "failed",
      providerState: "failed",
      code: "refusal",
      message: "Clip failed",
      retryable: false,
      meta: {},
    });
    expect(await f.provider.check(submitted.taskId)).toMatchObject({
      state: "failed",
      message: "Clip failed",
    });
    await expect(f.provider.download!(submitted.taskId)).rejects.toThrow("not ready");
    expect(f.assemble).not.toHaveBeenCalled();
  });
});
