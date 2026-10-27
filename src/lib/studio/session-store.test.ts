import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), list: vi.fn(), events: vi.fn() }));
vi.mock("./client", () => ({
  studioApi: { createJob: mocks.create, listJobs: mocks.list, findJob: mocks.list },
  readBrandPayload: () => null,
  StudioApiError: class extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/lib/authed-fetch", () => ({ getActiveWorkspaceId: () => "workspace" }));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/app-events", () => ({ emitAppEvent: mocks.events }));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("window", { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn() });
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener: vi.fn() });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
});
it("recovers a lost response with the same billing key instead of charging a fresh generation", async () => {
  const { StudioApiError } = await import("./client");
  const store = await import("./session-store");
  mocks.create
    .mockRejectedValueOnce(new StudioApiError(0, "Connection lost"))
    .mockImplementationOnce(async (input) => ({
      id: "original-job",
      workspace_id: "workspace",
      type: "script",
      status: "succeeded",
      input,
      output: {},
      idempotency_key: input.idempotencyKey,
      created_at: new Date().toISOString(),
    }));
  mocks.list.mockResolvedValue(null);
  const id = store.openComposer({ type: "script", brief: "Write a product launch script" })!;
  await store.generate(id);
  expect(store.getSession(id)?.retryKey).toBeTruthy();
  await store.generate(id);
  expect(mocks.create.mock.calls[0][0].idempotencyKey).toBe(
    mocks.create.mock.calls[1][0].idempotencyKey,
  );
  expect(store.getSession(id)?.step).toBe("review");
  expect(store.getSession(id)?.retryKey).toBeNull();
});

it("adopts the original job on an idempotency conflict instead of offering another paid retry", async () => {
  const { StudioApiError } = await import("./client");
  const store = await import("./session-store");
  mocks.create
    .mockRejectedValueOnce(new StudioApiError(0, "Connection lost"))
    .mockRejectedValueOnce(new StudioApiError(409, "Already completed"));
  mocks.list.mockResolvedValueOnce(null).mockImplementationOnce(async (_workspace, key) => ({
    id: "already-completed",
    workspace_id: "workspace",
    type: "script",
    status: "succeeded",
    idempotency_key: key,
    output: {},
    created_at: new Date().toISOString(),
  }));
  const id = store.openComposer({ type: "script", brief: "Write a product launch script" })!;
  await store.generate(id);
  await store.generate(id);
  expect(store.getSession(id)?.job?.id).toBe("already-completed");
  expect(store.getSession(id)?.step).toBe("review");
  expect(mocks.create.mock.calls[0][0].idempotencyKey).toBe(
    mocks.create.mock.calls[1][0].idempotencyKey,
  );
});

it("does not start generation while a source photo is still uploading", async () => {
  const store = await import("./session-store");
  const id = store.openComposer({ type: "image", brief: "Use the product photo" })!;
  store.updateSession(id, { uploadingReference: true });
  await store.generate(id);
  expect(mocks.create).not.toHaveBeenCalled();
});

it("submits and persists the reviewed script snapshot when making a video", async () => {
  const store = await import("./session-store");
  const sourceScript = {
    title: "Reviewed",
    hook: "Open",
    beats: [{ time: "0–30s", visual: "Our product", voiceover: "The reviewed words" }],
    cta: "Try it",
    caption: "Post caption",
    durationSec: 30,
  };
  mocks.create.mockImplementation(async (input) => ({
    id: "video-job",
    workspace_id: "workspace",
    type: "video",
    status: "succeeded",
    input,
    output: {},
    idempotency_key: input.idempotencyKey,
    created_at: new Date().toISOString(),
  }));
  const id = store.openComposer({
    type: "video",
    brief: "Make my reviewed script into a video",
    sourceScript,
    durationSec: 30,
  })!;
  expect(store.getSession(id)?.controls.durationSec).toBe(30);
  await store.generate(id);
  expect(mocks.create.mock.calls[0][0].intent.sourceScript).toEqual(sourceScript);
  expect(localStorage.setItem).toHaveBeenCalledWith(
    "studio:sessions:v2",
    expect.stringContaining("The reviewed words"),
  );
});
