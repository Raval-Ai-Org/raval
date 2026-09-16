import { beforeEach, describe, expect, it } from "vitest";
import { KieGatewayError } from "@/lib/kie-gateway.server";
import { UGC_MODELS } from "@/lib/ugc/models";
import { createRenderEngine, MAX_SUBMIT_ATTEMPTS, RENDER_TIMEOUT_MS } from "./engine.server";
import { buildKieInput, kieFailure, kieGenerationType } from "./providers/kie.server";
import type { ProviderCheck, SubmitResult, VideoProvider } from "./providers/types";
import { MemoryUgcStore } from "./store.memory";
import type { NewRenderRow } from "./store";

class FakeProvider implements VideoProvider {
  id = "kie";
  submits: Array<{ imageUrls: string[]; callbackUrl?: string }> = [];
  submitResults: SubmitResult[] = [];
  checks: ProviderCheck[] = [];
  generationType = kieGenerationType;
  async submit(req: { imageUrls: string[]; callbackUrl?: string }) {
    this.submits.push({ imageUrls: req.imageUrls, callbackUrl: req.callbackUrl });
    return (
      this.submitResults.shift() ?? {
        ok: true as const,
        taskId: `task-${this.submits.length}`,
        request: {},
      }
    );
  }
  async check() {
    return this.checks.shift() ?? { state: "pending" as const, providerState: "generating" };
  }
}

const success: ProviderCheck = {
  state: "success",
  providerState: "success",
  videoUrl: "https://tempfile.aiquickdraw.com/v/x.mp4",
  costUsd: 0.3,
  meta: { creditsConsumed: 60 },
};

let clock: number;
let store: MemoryUgcStore;
let provider: FakeProvider;
let engine: ReturnType<typeof createRenderEngine>;

function newRow(overrides: Partial<NewRenderRow> = {}): NewRenderRow {
  return {
    id: `r-${Math.random().toString(36).slice(2)}`,
    workspace_id: "ws1",
    project_id: "p1",
    created_by: "u1",
    idempotency_key: `k-${Math.random()}`,
    model_key: "veo-3-1-fast",
    provider: "kie",
    provider_model: "veo-3-1",
    provider_variant: "veo3_fast",
    generation_type: "TEXT_2_VIDEO",
    duration_sec: 8,
    aspect_ratio: "9:16",
    resolution: "720p",
    audio: true,
    reference_asset_ids: [],
    script: { hook: "Hook", postCaption: "Caption" },
    settings: {},
    prompt: "A UGC ad",
    reservation_id: null,
    est_cost_usd: 0.3,
    ...overrides,
  };
}

async function start(overrides: Partial<NewRenderRow> = {}) {
  const hold = await store.reserve({
    sourceId: overrides.idempotency_key ?? `src-${Math.random()}`,
  } as never);
  const { row } = await store.insertRender(
    newRow({ reservation_id: hold.ok ? hold.id : null, ...overrides }),
  );
  return row;
}

/** Advance by claiming, as a worker would, after moving the clock. */
async function tick(id: string, ms = 60_000) {
  clock += ms;
  return engine.runDue({ worker: "w", budgetMs: 10_000, max: 5, id });
}

beforeEach(() => {
  clock = Date.parse("2026-09-16T10:00:00Z");
  store = new MemoryUgcStore(() => clock);
  provider = new FakeProvider();
  engine = createRenderEngine({
    store,
    provider,
    now: () => clock,
    log: { info() {}, warn() {}, error() {} },
    callbackUrl: () => "https://app.example/api/public/hooks/kie",
  });
});

describe("UGC render engine", () => {
  it("submits, polls, stores the video and captures the allowance exactly once", async () => {
    const row = await start();
    provider.checks = [{ state: "pending", providerState: "generating" }, success];

    await engine.runDue({ worker: "w", budgetMs: 10_000, max: 5, id: row.id });
    let current = (await store.getRender(row.id))!;
    expect(current.status).toBe("processing");
    expect(current.provider_task_id).toBe("task-1");
    expect(provider.submits[0].callbackUrl).toContain("/api/public/hooks/kie");

    await tick(row.id);
    expect((await store.getRender(row.id))!.status).toBe("processing");

    await tick(row.id);
    current = (await store.getRender(row.id))!;
    expect(current.status).toBe("succeeded");
    expect(current.asset_id).toBe(`asset-ugc:${row.id}:task-1`);
    expect(current.actual_cost_usd).toBe(0.3);
    expect(store.usageEvents).toEqual([{ reservationId: row.reservation_id, cost: 0.3 }]);

    // A late callback / cron pass changes nothing and never charges again.
    await tick(row.id);
    expect(store.usageEvents).toHaveLength(1);
    expect(store.persisted).toHaveLength(1);
    expect(provider.submits).toHaveLength(1);
  });

  it("a lease stops two workers from advancing the same render at once", async () => {
    const row = await start();
    const first = await store.claim("a", 5, 120, row.id);
    const second = await store.claim("b", 5, 120, row.id);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it("releases the allowance when the provider fails the render", async () => {
    const row = await start();
    provider.checks = [
      {
        state: "failed",
        providerState: "fail",
        meta: {},
        code: "render_failed",
        message: "Blocked by safety filter",
        retryable: false,
      },
    ];
    await tick(row.id, 0);
    await tick(row.id);
    const current = (await store.getRender(row.id))!;
    expect(current.status).toBe("failed");
    expect(current.error_message).toBe("Blocked by safety filter");
    expect([...store.holds.values()][0]).toMatchObject({
      state: "released",
      reason: "render_failed",
    });
    expect(store.usageEvents).toHaveLength(0);
  });

  it("retries transient submit errors with backoff, then fails and releases", async () => {
    const row = await start();
    const transient: SubmitResult = {
      ok: false,
      code: "provider_network",
      message: "down",
      retryable: true,
    };
    provider.submitResults = Array.from({ length: MAX_SUBMIT_ATTEMPTS }, () => transient);

    await tick(row.id, 0);
    let current = (await store.getRender(row.id))!;
    expect(current.status).toBe("submitting");
    expect(current.submit_attempts).toBe(1);
    // Not due yet: backoff is respected.
    await tick(row.id, 1_000);
    expect(provider.submits).toHaveLength(1);

    for (let i = 0; i < MAX_SUBMIT_ATTEMPTS; i++) await tick(row.id, 10 * 60_000);
    current = (await store.getRender(row.id))!;
    expect(current.status).toBe("failed");
    expect(provider.submits).toHaveLength(MAX_SUBMIT_ATTEMPTS);
    expect([...store.holds.values()][0].state).toBe("released");
  });

  it("fails fast on a non-retryable rejection", async () => {
    const row = await start();
    provider.submitResults = [
      { ok: false, code: "provider_rejected", message: "Ratio error", retryable: false },
    ];
    await tick(row.id, 0);
    const current = (await store.getRender(row.id))!;
    expect(current).toMatchObject({ status: "failed", error_code: "provider_rejected" });
    expect(provider.submits).toHaveLength(1);
  });

  it("times out a render the provider never finishes, and releases", async () => {
    const row = await start();
    await tick(row.id, 0);
    await tick(row.id, RENDER_TIMEOUT_MS + 1_000);
    const current = (await store.getRender(row.id))!;
    expect(current).toMatchObject({ status: "failed", error_code: "timeout" });
    expect([...store.holds.values()][0].state).toBe("released");
  });

  it("retries storage, and never re-renders or double-charges while doing so", async () => {
    const row = await start();
    provider.checks = [success];
    store.persistFailures = 2;
    await tick(row.id, 0);
    await tick(row.id);
    expect((await store.getRender(row.id))!.status).toBe("persisting");
    await tick(row.id, 2 * 60_000);
    await tick(row.id, 3 * 60_000);
    const current = (await store.getRender(row.id))!;
    expect(current.status).toBe("succeeded");
    expect(provider.submits).toHaveLength(1);
    expect(store.usageEvents).toHaveLength(1);
  });

  it("sends signed reference images and fails clearly when they are gone", async () => {
    store.images.set("img1", "https://signed.example/img1.png");
    const withImage = await start({ reference_asset_ids: ["img1", "missing"] });
    await tick(withImage.id, 0);
    expect(provider.submits[0].imageUrls).toEqual(["https://signed.example/img1.png"]);

    const gone = await start({ reference_asset_ids: ["missing"] });
    await tick(gone.id, 0);
    expect(await store.getRender(gone.id)).toMatchObject({
      status: "failed",
      error_code: "reference_missing",
    });
  });

  it("the same idempotency key returns the same render", async () => {
    const a = await store.insertRender(newRow({ idempotency_key: "click-1" }));
    const b = await store.insertRender(newRow({ idempotency_key: "click-1" }));
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.row.id).toBe(a.row.id);
  });

  it("cancels only before rendering starts, returning the allowance", async () => {
    const queued = await start();
    expect((await engine.cancel(queued)).ok).toBe(true);
    expect([...store.holds.values()][0].state).toBe("released");

    const running = await start();
    await tick(running.id, 0);
    const result = await engine.cancel((await store.getRender(running.id))!);
    expect(result.ok).toBe(false);
    expect(result.row.status).toBe("processing");
  });
});

describe("Kie provider mapping", () => {
  const base = {
    prompt: "p",
    durationSec: 8,
    aspectRatio: "9:16" as const,
    resolution: "720p" as const,
  };

  it("builds Veo 3.1 reference-to-video input with the tier in input.model", () => {
    expect(
      buildKieInput({
        ...base,
        model: UGC_MODELS["veo-3-1-fast"],
        imageUrls: ["a", "b", "c", "d"],
      }),
    ).toEqual({
      prompt: "p",
      model: "veo3_fast",
      generation_type: "REFERENCE_2_VIDEO",
      image_urls: ["a", "b", "c"],
      aspect_ratio: "9:16",
      resolution: "720p",
      duration: 8,
      enable_translation: false,
    });
  });

  it("uses a first frame for Veo Quality and text-to-video without images", () => {
    expect(
      buildKieInput({ ...base, model: UGC_MODELS["veo-3-1-quality"], imageUrls: ["a", "b"] }),
    ).toMatchObject({
      model: "veo3",
      generation_type: "FIRST_AND_LAST_FRAMES_2_VIDEO",
      image_urls: ["a"],
    });
    expect(
      buildKieInput({ ...base, model: UGC_MODELS["veo-3-1-lite"], imageUrls: [] }),
    ).toMatchObject({
      model: "veo3_lite",
      generation_type: "TEXT_2_VIDEO",
    });
  });

  it("builds Seedance input with reference images and audio", () => {
    expect(
      buildKieInput({
        ...base,
        durationSec: 12,
        model: UGC_MODELS["seedance-2-fast"],
        imageUrls: ["a"],
      }),
    ).toEqual({
      prompt: "p",
      reference_image_urls: ["a"],
      aspect_ratio: "9:16",
      resolution: "720p",
      duration: 12,
      generate_audio: true,
      web_search: false,
    });
  });

  it("maps Kie errors to retryable / final failures", () => {
    expect(kieFailure(new KieGatewayError(400, "no credits", "request", 402))).toMatchObject({
      code: "provider_credits",
      retryable: false,
    });
    expect(kieFailure(new KieGatewayError(502, "blip", "provider", 500)).retryable).toBe(true);
    expect(kieFailure(new KieGatewayError(422, "Ratio error", "request", 422))).toMatchObject({
      code: "provider_rejected",
      message: "Ratio error",
      retryable: false,
    });
    expect(kieFailure(new KieGatewayError(503, "x", "configuration")).retryable).toBe(false);
  });
});
