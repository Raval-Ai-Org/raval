// A Story or carousel whose pictures are partly refused by the image provider
// (low balance, rate limit) is finished, not failed: the refused pictures are
// sent again one at a time. All providers are mocked; nothing is paid.
import { beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  start: vi.fn(),
  review: vi.fn(),
  save: vi.fn(),
  linkStory: vi.fn(),
  linkCarousel: vi.fn(),
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("./job-writer.server", () => ({ studioJobWriter: (client: unknown) => client }));
vi.mock("@/lib/feature-flags", () => ({
  isAudienceAutoScoreEnabled: () => false,
  creativeSkillsFor: () => ({}),
}));
vi.mock("@/lib/openrouter-image.server", () => ({
  isImageTask: () => true,
  checkImageTask: mocks.check,
  startImageTask: mocks.start,
}));
vi.mock("./image-review.server", () => ({ reviewGeneratedImage: mocks.review }));
vi.mock("./story-assets.server", () => ({
  linkGeneratedStory: mocks.linkStory,
  storeStoryFrames: vi.fn(),
}));
vi.mock("./carousel-assets.server", () => ({
  linkGeneratedCarousel: mocks.linkCarousel,
  storeCarouselSlides: vi.fn(),
}));
vi.mock("@/server/assets/persist.server", () => ({
  persistAsset: mocks.save,
  signAssetPath: vi.fn(async () => "https://owned.test/signed.png"),
  linkAssetToContent: vi.fn(),
}));
import { advanceStudioJob } from "./runner.server";

type Row = Parameters<typeof advanceStudioJob>[1];
const workspace = "00000000-0000-4000-8000-000000000001";

function seriesRow(type: "story" | "carousel", slots: string[]) {
  const row = {
    id: "job",
    workspace_id: workspace,
    type,
    status: "running",
    stage: "render",
    title: "Series",
    input: { approve: false, controls: {} },
    content_item_ids: ["post"],
    asset_ids: [],
    output: {
      ...(type === "story"
        ? {
            story: {
              mode: "frames",
              frames: slots.map((_, i) => ({ heading: `Frame ${i + 1}`, body: "" })),
            },
          }
        : {
            slides: slots.map((_, i) => ({ heading: `Slide ${i + 1}`, body: "" })),
            carousel: { design: { flow: "designed" } },
          }),
      media: slots.map((slot) => ({ slot, kind: "image", ratio: "9:16", status: "pending" })),
    },
    provider_tasks: slots.map((slot) => ({
      slot,
      kind: "image",
      taskId: `task:${slot}`,
      model: "image-model",
      fallbacks: [],
      ratio: "9:16",
      prompt: `Prompt for ${slot}`,
      referenceAssets: [],
      reviewAttempts: 1,
      startedAt: Date.now(),
      state: "pending",
    })),
  } as unknown as Row;
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
          if (patch && table === "studio_jobs") Object.assign(row, patch);
          resolve({
            data:
              table === "studio_jobs"
                ? [{ id: "job" }]
                : [{ id: "post", status: "draft", meta: {} }],
            error: null,
          });
        },
      };
      return builder;
    },
  };
  return { row, client };
}

let png = "";
let restarted = 0;
beforeEach(async () => {
  vi.clearAllMocks();
  restarted = 0;
  const bytes = await sharp({
    create: { width: 9, height: 16, channels: 3, background: "#123456" },
  })
    .png()
    .toBuffer();
  png = `data:image/png;base64,${bytes.toString("base64")}`;
  mocks.review.mockResolvedValue({ status: "pass", issues: [] });
  mocks.save.mockImplementation(async (args: { idempotencyKey: string }) => ({
    ok: true,
    asset: {
      id: args.idempotencyKey,
      storage_path: `workspace/${workspace}/assets/${args.idempotencyKey.replace(/[^a-z0-9]/gi, "")}.png`,
    },
  }));
  mocks.start.mockImplementation(async () => ({
    taskId: `retry:${++restarted}`,
    model: "image-model",
    fallbacks: [],
  }));
  mocks.linkStory.mockResolvedValue(true);
  mocks.linkCarousel.mockResolvedValue(true);
});

it("finishes a Story whose last frame was refused while the others were made", async () => {
  const { row, client } = seriesRow("story", ["frame:0", "frame:1", "frame:2"]);
  mocks.check.mockImplementation(async (taskId: string) =>
    taskId === "task:frame:2"
      ? { state: "failed", message: "Bad request", code: "invalid_request", retryable: false }
      : { state: "success", dataUrl: png },
  );
  const first = await advanceStudioJob(client, row);
  expect(first.status).toBe("running");
  expect(mocks.start).toHaveBeenCalledTimes(1);
  const retried = first.provider_tasks.find((t) => t.slot === "frame:2")!;
  expect(retried.taskId).toBe("retry:1");
  expect(retried.resubmits).toBe(1);

  mocks.check.mockResolvedValue({ state: "success", dataUrl: png });
  const second = await advanceStudioJob(client, { ...first, lease_until: null } as Row);
  expect(second.status).toBe("succeeded");
  expect(mocks.linkStory).toHaveBeenCalledTimes(1);
});

it("never deadlocks a carousel whose slides were refused together", async () => {
  const slots = ["slide:0", "slide:1", "slide:2", "slide:3", "slide:4"];
  const { row, client } = seriesRow("carousel", slots);
  // Slide 1 is made; the four sent with it are refused for balance in a second.
  mocks.check.mockImplementation(async (taskId: string) =>
    taskId === "task:slide:0"
      ? { state: "success", dataUrl: png }
      : taskId.startsWith("retry:")
        ? { state: "success", dataUrl: png }
        : {
            state: "failed",
            message: "Out of credits",
            code: "insufficient_credits",
            retryable: false,
          },
  );
  let job = await advanceStudioJob(client, row);
  // One refused slide is sent again at a time, until all are made.
  for (let poll = 0; poll < 12 && job.status === "running"; poll++)
    job = await advanceStudioJob(client, { ...job, lease_until: null } as Row);
  expect(job.status).toBe("succeeded");
  expect(restarted).toBe(4);
  expect(mocks.linkCarousel).toHaveBeenCalledTimes(1);
});

it("still fails a set when a refused picture keeps being refused", async () => {
  const { row, client } = seriesRow("story", ["frame:0", "frame:1"]);
  mocks.check.mockImplementation(async (taskId: string) =>
    taskId === "task:frame:0"
      ? { state: "success", dataUrl: png }
      : { state: "failed", message: "Out of credits", code: "insufficient_credits" },
  );
  let job = await advanceStudioJob(client, row);
  for (let poll = 0; poll < 8 && job.status === "running"; poll++)
    job = await advanceStudioJob(client, { ...job, lease_until: null } as Row);
  expect(job.status).toBe("failed");
  expect(restarted).toBe(2);
});
