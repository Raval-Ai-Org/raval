import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  prompt: vi.fn(),
  render: vi.fn(),
  link: vi.fn(),
  sign: vi.fn(),
  video: vi.fn(),
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("./job-writer.server", () => ({ studioJobWriter: (client: unknown) => client }));
vi.mock("@/server/billing/creation.server", () => ({ captionEditsRemaining: async () => 2 }));
vi.mock("@/lib/feature-flags", () => ({ isAudienceAutoScoreEnabled: () => false }));
vi.mock("@/lib/ai", () => ({
  runStructuredPrompt: mocks.prompt,
  AiOutputError: class extends Error {},
  AiGatewayError: class extends Error {},
}));
vi.mock("@/lib/openrouter-image.server", () => ({
  startImageTask: mocks.render,
  checkImageTask: vi.fn(),
  isImageTask: () => true,
}));
vi.mock("@/server/assets/persist.server", () => ({
  signAssetPath: mocks.sign,
  linkAssetToContent: mocks.link,
  persistAsset: vi.fn(),
}));
vi.mock("@/server/brand-look/resolve.server", () => ({ loadBrandLook: async () => null }));
vi.mock("@/server/ugc/providers/routed.server", () => ({
  routedVideoProvider: { submit: mocks.video },
}));
vi.mock("@/server/ai/budget", () => ({
  enforceBudget: vi.fn(),
  BudgetExceededError: class extends Error {},
}));
vi.mock("@/server/guardrails/media-safety.server", () => ({
  assertSafeMediaImages: vi.fn(),
  assertSafeMediaPrompt: vi.fn(),
  MediaSafetyError: class extends Error {},
}));
vi.mock("@/server/memory/context.server", () => ({ loadMemories: async () => [] }));
vi.mock("@/server/brand-visuals/service.server", () => ({
  loadGenerationVisualSnapshot: async () => null,
  loadVisualFeedbackRules: async () => "",
  resolveVisualReferenceUrls: async () => [],
}));
vi.mock("@/lib/studio/naturalize.server", () => ({
  naturalizeVariants: async (variants: unknown) => variants,
}));
vi.mock("./context.server", async () => {
  const { emptyContext } = await import("@/lib/studio/prompts");
  return {
    loadStudioContext: async () => emptyContext("Coffee brand"),
    invalidateStudioContext: vi.fn(),
  };
});
import { createStudioJob, advanceStudioJob, cancelStudioJob } from "./runner.server";
import { CreateJobSchema } from "@/lib/studio/jobs";

const workspace = "00000000-0000-4000-8000-000000000001";
const parentId = "00000000-0000-4000-8000-000000000002";

function database() {
  const originalMedia = [
    {
      slot: "main",
      kind: "image",
      status: "ready",
      ratio: "1:1",
      assetId: "photo",
      storagePath: `workspace/${workspace}/assets/photo/original.png`,
    },
  ];
  const now = new Date().toISOString();
  const jobs: Record<string, unknown>[] = [
    {
      id: parentId,
      workspace_id: workspace,
      type: "image",
      status: "succeeded",
      group_id: "group",
      stage: "polish",
      stage_at: now,
      input: { controls: { platforms: ["instagram"] }, intent: { brief: "Our actual product" } },
      output: {
        title: "Product",
        concept: "The original product photo",
        media: originalMedia,
        variants: [
          {
            platform: "instagram",
            title: "Product",
            body: "The original caption",
            chars: 20,
            hashtags: [],
          },
        ],
      },
      content_item_ids: ["post"],
      asset_ids: ["photo"],
      attempt: 1,
      created_at: now,
      idempotency_key: "original-key",
      parent_job_id: null,
    },
  ];
  const posts: Record<string, unknown>[] = [
    {
      id: "post",
      workspace_id: workspace,
      status: "pending",
      title: "Product",
      body: "Original caption",
      hashtags: [],
      meta: { platform: "instagram" },
    },
  ];
  const client = {
    from(table: string) {
      const rows = table === "studio_jobs" ? jobs : posts;
      const filters: ((row: Record<string, unknown>) => boolean)[] = [];
      let patch: Record<string, unknown> | null = null;
      let inserted: Record<string, unknown> | null = null;
      const execute = () => {
        if (inserted) {
          const created = {
            id: "revision",
            created_at: now,
            updated_at: now,
            stage_at: now,
            provider_tasks: [],
            ...inserted,
          };
          rows.push(created);
          inserted = null;
          return { data: [created], error: null };
        }
        const matches = rows.filter((row) => filters.every((filter) => filter(row)));
        if (patch) for (const row of matches) Object.assign(row, patch);
        return { data: matches, error: null };
      };
      const query = {
        select() {
          return this;
        },
        insert(value: Record<string, unknown>) {
          inserted = value;
          return this;
        },
        update(value: Record<string, unknown>) {
          patch = value;
          return this;
        },
        eq(key: string, value: unknown) {
          filters.push((row) => row[key] === value);
          return this;
        },
        in(key: string, values: unknown[]) {
          filters.push((row) => values.includes(row[key]));
          return this;
        },
        limit() {
          return this;
        },
        single: async () => {
          const result = execute();
          return { ...result, data: result.data[0] ?? null };
        },
        maybeSingle: async () => {
          const result = execute();
          return { ...result, data: result.data[0] ?? null };
        },
        then(resolve: (result: unknown) => void) {
          resolve(execute());
        },
      };
      return query;
    },
  };
  return { client, jobs, posts, originalMedia };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.sign.mockResolvedValue("https://owned.test/original.png");
  mocks.prompt.mockResolvedValue({
    title: "Product",
    variants: [
      {
        platform: "instagram",
        title: "Product",
        body: "A much clearer caption for the same product photo.",
        hashtags: [],
      },
    ],
  });
});

it("executes an image caption revision without another image task and keeps the original asset", async () => {
  const db = database();
  const input = CreateJobSchema.parse({
    workspaceId: workspace,
    type: "image",
    parentJobId: parentId,
    idempotencyKey: "caption-revision-key",
    intent: { brief: "Our actual product" },
    controls: { platforms: ["instagram"] },
    refine: { instruction: "Make the caption clearer", target: "instagram" },
  });
  const job = await createStudioJob({
    client: db.client,
    workspaceId: workspace,
    userId: "user",
    input,
  });
  expect(job.status).toBe("succeeded");
  expect(mocks.render).not.toHaveBeenCalled();
  expect(mocks.prompt).toHaveBeenCalledTimes(1);
  expect(mocks.prompt.mock.calls[0][0].user).toContain("Make the caption clearer");
  expect(job.output.concept).toBe("The original product photo");
  expect(job.output.media?.[0].assetId).toBe("photo");
  expect(db.posts[0].body).toContain("much clearer caption");
  expect(mocks.link).toHaveBeenCalledWith(
    workspace,
    ["post"],
    expect.objectContaining({ id: "photo" }),
  );
});

it("bounds an included edit to one small text request and keeps the paid visual", async () => {
  const db = database();
  const input = CreateJobSchema.parse({
    workspaceId: workspace,
    type: "image",
    parentJobId: parentId,
    idempotencyKey: "included-caption",
    intent: { brief: "Our actual product" },
    controls: { platforms: ["instagram"], paymentSource: "creation" },
    refine: { instruction: "Make the existing caption clearer", target: "captions" },
    includedCaptionEdit: true,
  });
  const job = await createStudioJob({
    client: db.client,
    workspaceId: workspace,
    userId: "user",
    input,
  });
  expect(job.status).toBe("succeeded");
  expect(mocks.prompt).toHaveBeenCalledOnce();
  expect(mocks.prompt).toHaveBeenCalledWith(
    expect.objectContaining({ route: "studio.caption.edit", maxTokens: 1800 }),
  );
  expect(mocks.render).not.toHaveBeenCalled();
  expect(job.output.media?.[0].assetId).toBe("photo");
});

it("terminates an interrupted text stage so the billing worker can return its reservation", async () => {
  const db = database();
  Object.assign(db.jobs[0], {
    status: "running",
    provider_tasks: [],
    stage_at: new Date(Date.now() - 20 * 60_000).toISOString(),
  });
  const result = await advanceStudioJob(
    db.client,
    db.jobs[0] as unknown as Parameters<typeof advanceStudioJob>[1],
  );
  expect(result.status).toBe("failed");
  expect(result.error?.category).toBe("timeout");
  expect(mocks.render).not.toHaveBeenCalled();
});

it("keeps cancellation terminal when a later read tries to advance the job", async () => {
  const db = database();
  Object.assign(db.jobs[0], { status: "running", content_item_ids: [], provider_tasks: [] });
  const cancelled = await cancelStudioJob(db.client, workspace, parentId);
  expect(cancelled.status).toBe("cancelled");
  const result = await advanceStudioJob(
    db.client,
    db.jobs[0] as unknown as Parameters<typeof advanceStudioJob>[1],
  );
  expect(result.status).toBe("cancelled");
  expect(mocks.prompt).not.toHaveBeenCalled();
});

it("sends the complete reviewed script directly to the video renderer when the AI plan omits its words", async () => {
  const db = database();
  const sourceScript = {
    title: "The reviewed product video",
    hook: "An exact opening",
    durationSec: 30,
    beats: [
      {
        time: "0–15s",
        visual: "Show the product from the front",
        voiceover: "An exact opening in the reviewed script.",
      },
      {
        time: "15–30s",
        visual: "Show the product in use",
        voiceover: "An exact ending that must reach the renderer.",
      },
    ],
    cta: "Visit the store",
    caption: "Post-only caption",
  };
  mocks.prompt.mockResolvedValue({
    title: sourceScript.title,
    concept:
      "A close shot of the reviewed coffee bag on the kitchen counter in soft daylight. The camera pans slowly across its label, then shows the same product being used beside a steaming cup. No dialogue supplied in this plan.",
    altText: "Product video",
    variants: [{ platform: "instagram", body: "The product in use", hashtags: [] }],
  });
  mocks.video.mockResolvedValue({
    ok: true,
    taskId: "video-task",
    providerModel: "video-model",
    provider: "openrouter",
    request: {},
  });
  const input = CreateJobSchema.parse({
    workspaceId: workspace,
    type: "video",
    idempotencyKey: "reviewed-script-render",
    intent: { brief: "Make my reviewed script into a video", sourceScript },
    controls: { platforms: ["instagram"], durationSec: 30, audio: true },
  });
  const job = await createStudioJob({
    client: db.client,
    workspaceId: workspace,
    userId: "user",
    input,
  });
  expect(job.error ?? null).toBeNull();
  expect(mocks.video).toHaveBeenCalledTimes(1);
  const request = mocks.video.mock.calls[0][0];
  expect(request.durationSec).toBe(30);
  for (const beat of sourceScript.beats) {
    expect(request.prompt).toContain(beat.visual);
    expect(request.prompt).toContain(beat.voiceover);
  }
  expect(request.prompt).not.toContain(sourceScript.caption);
});
