import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertSafeVideo, setVideoFrameExtractor } from "./video-safety.server";
import { setModerationClassifier } from "./moderation";
import { setGuardrailSink } from "./events";
import { createRoutedVideoProvider } from "@/server/ugc/providers/routed.server";
import { runWithScope } from "@/server/request-context";

vi.mock("@/server/safe-fetch", () => ({ safeFetch: vi.fn() }));
import { safeFetch } from "@/server/safe-fetch";
let restore: () => void;
let serial = 0;
const video = () => `data:video/mp4;base64,${Buffer.from(`video-${++serial}`).toString("base64")}`;
const frame = (name: string) =>
  `data:image/jpeg;base64,${Buffer.from(`${name}-${serial}`).toString("base64")}`;
beforeEach(() => {
  restore = setGuardrailSink(async () => {});
  setModerationClassifier(async () => ({ safe: true, categories: [] }));
  setVideoFrameExtractor(async () => [frame("one"), frame("two")]);
});
afterEach(() => {
  restore();
  setVideoFrameExtractor(null);
  setModerationClassifier(null);
  vi.clearAllMocks();
});

describe("finished video safety", () => {
  it("checks every extracted sample, not just the cover", async () => {
    const source = video();
    const unsafe = frame("unsafe");
    setVideoFrameExtractor(async () => [frame("cover"), unsafe, frame("end")]);
    setModerationClassifier(async (image) => ({
      safe: image !== unsafe,
      categories: image === unsafe ? ["sexual_content"] : [],
    }));
    await expect(assertSafeVideo(source)).rejects.toMatchObject({ status: 422, code: "refusal" });
  });
  it.each([[], Array(91).fill("data:image/jpeg;base64,AA==")])(
    "fails closed on absent or excessive samples",
    async (frames) => {
      setVideoFrameExtractor(async () => frames);
      await expect(assertSafeVideo(video())).rejects.toMatchObject({ code: "safety_unavailable" });
    },
  );
  it("pauses if the decoder or moderation provider is unavailable", async () => {
    setVideoFrameExtractor(async () => {
      throw new Error("decoder unavailable");
    });
    await expect(assertSafeVideo(video())).rejects.toMatchObject({ code: "safety_unavailable" });
    setVideoFrameExtractor(async () => [frame("fresh")]);
    setModerationClassifier(async () => {
      throw new Error("offline");
    });
    await expect(assertSafeVideo(video())).rejects.toMatchObject({ code: "safety_unavailable" });
  });
  it("rejects invalid inline media instead of accepting an editable label", async () => {
    await expect(assertSafeVideo("data:image/png;base64,AA==")).rejects.toMatchObject({
      code: "safety_unavailable",
    });
  });
  it("refetches a mutable URL and reviews changed bytes", async () => {
    const fetch = vi.mocked(safeFetch);
    fetch.mockImplementation(
      async () => ({ ok: true, bytes: new Uint8Array(Buffer.from(`changed-${++serial}`)) }) as any,
    );
    const extract = vi.fn(async () => [frame("new")]);
    setVideoFrameExtractor(extract);
    await assertSafeVideo("https://cdn.example.com/video.mp4");
    await assertSafeVideo("https://cdn.example.com/video.mp4");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(extract).toHaveBeenCalledTimes(2);
  });
  it("reuses an approved byte digest only within the same workspace", async () => {
    const source = video();
    const extract = vi.fn(async () => [frame("cache")]);
    setVideoFrameExtractor(extract);
    for (const workspaceId of ["workspace-one", "workspace-one", "workspace-two"]) {
      await runWithScope({ workspaceId }, () => assertSafeVideo(source));
    }
    expect(extract).toHaveBeenCalledTimes(2);
  });
  it("withholds completed provider output while review is unavailable, and refuses unsafe output", async () => {
    const source = video();
    const provider = createRoutedVideoProvider({
      providers: {
        kie: {
          id: "kie",
          submit: vi.fn(),
          generationType: () => "TEXT",
          check: async () => ({
            state: "success",
            providerState: "success",
            costUsd: null,
            videoUrl: source,
            meta: {},
          }),
        },
      },
      primary: () => "kie",
    });
    setVideoFrameExtractor(async () => {
      throw new Error("offline");
    });
    expect(await provider.check("task", "kie")).toMatchObject({
      state: "pending",
      providerState: "safety_review_pending",
    });
    setVideoFrameExtractor(async () => [frame("blocked")]);
    setModerationClassifier(async () => ({ safe: false, categories: ["sexual_content"] }));
    expect(await provider.check("task", "kie")).toMatchObject({
      state: "failed",
      code: "refusal",
      retryable: false,
    });
  });
});
