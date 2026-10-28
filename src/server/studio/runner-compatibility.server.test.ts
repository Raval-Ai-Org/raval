import { beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";
const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  start: vi.fn(),
  review: vi.fn(),
  logo: vi.fn(),
  save: vi.fn(),
  events: [] as string[],
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
// Job writes go through the same authorized fixture the test passes in.
vi.mock("./job-writer.server", () => ({ studioJobWriter: (client: unknown) => client }));
vi.mock("@/lib/feature-flags", () => ({ isAudienceAutoScoreEnabled: () => false }));
vi.mock("@/lib/openrouter-image.server", () => ({
  isImageTask: () => true,
  checkImageTask: mocks.check,
  startImageTask: mocks.start,
}));
vi.mock("./image-review.server", () => ({ reviewGeneratedImage: mocks.review }));
vi.mock("./logo-overlay.server", () => ({ overlayBrandLogo: mocks.logo }));
vi.mock("@/server/assets/persist.server", () => ({
  persistAsset: mocks.save,
  signAssetPath: vi.fn(),
  linkAssetToContent: vi.fn(),
}));
import { advanceStudioJob } from "./runner.server";
type Row = Parameters<typeof advanceStudioJob>[1];
const workspace = "00000000-0000-4000-8000-000000000001";
function fixture(reviewAttempts = 1) {
  const references = ["https://owned.test/original-reference.png"];
  const row = {
    id: "job",
    workspace_id: workspace,
    type: "image",
    status: "running",
    stage: "render",
    title: "Original title",
    input: { approve: true, controls: {} },
    content_item_ids: ["post"],
    asset_ids: [],
    output: {
      concept: "Original concept",
      media: [{ slot: "main", kind: "image", ratio: "1:1", status: "pending" }],
    },
    provider_tasks: [
      {
        slot: "main",
        kind: "image",
        taskId: "original-task",
        model: "original-model",
        fallbacks: ["next-model"],
        ratio: "1:1",
        prompt: "Original artwork prompt",
        referenceAssets: references,
        reviewAttempts,
        logo: { url: "https://owned.test/logo.png", corner: "bottom-right" },
        startedAt: Date.now(),
        state: "pending",
      },
    ],
  } as unknown as Row;
  const contentWrites: Record<string, unknown>[] = [];
  const client = {
    from(table: string) {
      let patch: Record<string, unknown> | null = null;
      const builder = {
        update(value: Record<string, unknown>) {
          patch = value;
          return this;
        },
        select() {
          return this;
        },
        eq() {
          return this;
        },
        in() {
          return this;
        },
        or() {
          return this;
        },
        maybeSingle: async () => ({ data: row, error: null }),
        then(resolve: (value: unknown) => void) {
          if (patch) {
            if (table === "studio_jobs") Object.assign(row, patch);
            else contentWrites.push(patch);
          }
          resolve({
            data:
              table === "studio_jobs"
                ? [{ id: "job" }]
                : [{ id: "post", status: "pending", meta: {} }],
            error: null,
          });
        },
      };
      return builder;
    },
  };
  return { row, client, references, contentWrites };
}
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.events.length = 0;
  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#123456" } })
    .png()
    .toBuffer();
  mocks.check.mockResolvedValue({
    state: "success",
    dataUrl: `data:image/png;base64,${png.toString("base64")}`,
  });
  mocks.review.mockImplementation(async () => {
    mocks.events.push("review");
    return { status: "warn", issues: ["Headline could be clearer."] };
  });
  mocks.logo.mockImplementation(async (image: string) => {
    mocks.events.push("logo");
    return image;
  });
  mocks.save.mockImplementation(async () => {
    mocks.events.push("save");
    return {
      ok: true,
      asset: { id: "asset", storage_path: `workspace/${workspace}/assets/asset/original.png` },
    };
  });
  mocks.start.mockResolvedValue({ taskId: "next-task", model: "next-model", fallbacks: [] });
});
it("retains legacy review, logo placement, saving and requested approval with advisory warnings", async () => {
  const { row, client, contentWrites } = fixture();
  const result = await advanceStudioJob(client, row);
  expect(result.status).toBe("succeeded");
  expect(mocks.events).toEqual(["review", "logo", "save"]);
  expect(contentWrites).toContainEqual(expect.objectContaining({ status: "approved" }));
  expect(result.output?.warnings).toContain("Visual review: Headline could be clearer.");
  expect(mocks.start).not.toHaveBeenCalled();
});
it("retains the original bounded repair prompt and the exact reference packet without a taste profile", async () => {
  const { row, client, references } = fixture(0);
  await advanceStudioJob(client, row);
  expect(mocks.start).toHaveBeenCalledTimes(1);
  expect(mocks.start.mock.calls[0][0].referenceAssets).toBe(references);
  expect(mocks.start.mock.calls[0][0].prompt).toContain(
    "Original artwork prompt\nThe previous render was rejected",
  );
  expect(mocks.logo).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(row.provider_tasks[0].reviewAttempts).toBe(1);
});
it("retains existing model fallback and references when the original image provider fails", async () => {
  const { row, client, references } = fixture();
  mocks.check.mockResolvedValue({ state: "failed", message: "Provider unavailable" });
  await advanceStudioJob(client, row);
  expect(mocks.start.mock.calls[0][0]).toEqual({
    prompt: "Original artwork prompt",
    size: "1024x1024",
    model: "next-model",
    referenceAssets: references,
  });
  expect(mocks.review).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});
it.each([
  {
    code: "refusal",
    retryable: false,
    message: "This request is blocked by Mellox's AI safety policy.",
  },
  {
    code: "safety_unavailable",
    retryable: true,
    message: "Safety review could not complete. Generation is paused; try again later.",
  },
])("preserves $code and never switches models for safety decisions", async (failure) => {
  const { row, client } = fixture();
  mocks.check.mockResolvedValue({ state: "failed", ...failure });
  const result = await advanceStudioJob(client, row);
  expect(result.status).toBe("failed");
  expect(result.error).toEqual({
    category: "safety",
    message: failure.message,
    retryable: failure.retryable,
  });
  expect(mocks.start).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});

it("saves new versions without touching the post, and a missed one is only a warning", async () => {
  const { row, client } = fixture();
  const task = row.provider_tasks[0];
  Object.assign(row, {
    parent_job_id: "parent",
    input: {
      controls: { variationCount: 2 },
      refine: { instruction: "More versions", target: "variations" },
    },
    output: {
      media: [
        { slot: "main", kind: "image", ratio: "1:1", status: "ready", assetId: "kept" },
        { slot: "option:0", kind: "image", ratio: "1:1", status: "pending" },
        { slot: "option:1", kind: "image", ratio: "1:1", status: "pending" },
      ],
    },
    provider_tasks: [
      { ...task, slot: "option:0", taskId: "v0" },
      { ...task, slot: "option:1", taskId: "v1", fallbacks: [] },
    ],
  });
  mocks.review.mockResolvedValue({ status: "pass", issues: [] });
  // The first version renders like any picture; the second fails.
  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#123456" } })
    .png()
    .toBuffer();
  mocks.check.mockReset();
  mocks.check
    .mockResolvedValueOnce({
      state: "success",
      dataUrl: `data:image/png;base64,${png.toString("base64")}`,
    })
    .mockResolvedValueOnce({ state: "failed", message: "Provider unavailable", retryable: false });
  const result = await advanceStudioJob(client, row);
  expect(result.status).toBe("succeeded");
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(mocks.save.mock.calls[0][0].contentItemIds).toEqual([]);
  const media = result.output?.media ?? [];
  expect(media.find((m) => m.slot === "main")?.assetId).toBe("kept");
  expect(media.find((m) => m.slot === "option:0")?.status).toBe("ready");
  expect(result.output?.warnings).toContain(
    "1 of 2 versions couldn't be made. You weren't charged for them.",
  );
});
