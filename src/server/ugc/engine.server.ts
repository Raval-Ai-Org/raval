// The UGC render state machine. Store- and provider-agnostic; tested against
// store.memory.ts with a fake provider.
//
//   queued ──submit──▶ processing ──provider success──▶ persisting ──stored──▶ succeeded
//     │  (transient error: stay, back off)   │                  │ (retry, then give up)
//     └──────────── failed / cancelled ◀─────┴── provider failure / timeout ◀──┘
//
// Allowance: the render's reservation is CAPTURED (usage recorded, once) only
// after the video is in Mellox storage, and RELEASED on every failure path.
// Every status change is compare-and-set, so the callback, the cron hook,
// after() and status reads can all advance the same render concurrently
// without double-submitting, double-storing or double-charging.
import "server-only";
import {
  isKnownUgcModelKey,
  resolveUgcModel,
  type UgcAspectRatio,
  type UgcResolution,
} from "@/lib/ugc/models";
import { ACTIVE_RENDER_STATUSES, type RenderStatus } from "@/lib/ugc/schemas";
import { log as defaultLog } from "@/server/observability/logger";
import type { VideoProvider } from "./providers/types";
import type { RenderPatch, RenderRow, UgcRenderStore } from "./store";

export const MAX_SUBMIT_ATTEMPTS = 4;
export const MAX_PERSIST_ATTEMPTS = 5;
export const RENDER_TIMEOUT_MS = 30 * 60_000;
export const LEASE_SECONDS = 120;
/** Reference image links must outlive a slow provider queue. */
const IMAGE_URL_TTL_SECONDS = 6 * 60 * 60;

export type EngineDeps = {
  store: UgcRenderStore;
  provider: VideoProvider;
  now?: () => number;
  callbackUrl?: () => string | undefined;
  log?: Pick<typeof defaultLog, "info" | "warn" | "error">;
};

const iso = (ms: number) => new Date(ms).toISOString();

export function pollDelayMs(submittedAt: string | null, now: number): number {
  const elapsed = submittedAt ? now - Date.parse(submittedAt) : 0;
  return elapsed < 2 * 60_000 ? 10_000 : elapsed < 10 * 60_000 ? 20_000 : 45_000;
}

export function createRenderEngine(deps: EngineDeps) {
  const { store, provider } = deps;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? defaultLog;

  async function fail(row: RenderRow, code: string, message: string): Promise<RenderRow> {
    const failed = await store.transition(row.id, ACTIVE_RENDER_STATUSES, {
      status: "failed",
      error_code: code,
      error_message: message.slice(0, 1000),
      completed_at: iso(now()),
      lease_until: null,
    });
    if (!failed) return (await store.getRender(row.id)) ?? row;
    if (failed.reservation_id) await store.release(failed.reservation_id, code);
    log.warn("ugc.render.failed", { renderId: row.id, code, model: row.model_key });
    return failed;
  }

  async function submit(row: RenderRow): Promise<RenderRow> {
    if (!isKnownUgcModelKey(row.model_key))
      return fail(row, "model_unavailable", "This model is no longer available.");
    // A legacy key resolves to its current equivalent; the provider adapts it.
    const model = resolveUgcModel(row.model_key);
    if (row.submit_attempts >= MAX_SUBMIT_ATTEMPTS) {
      return fail(
        row,
        row.error_code ?? "submit_failed",
        row.error_message ?? "The video provider stayed unavailable. Your allowance was returned.",
      );
    }
    const current =
      row.status === "queued"
        ? await store.transition(row.id, ["queued"], { status: "submitting" })
        : row;
    if (!current || current.status !== "submitting") return (await store.getRender(row.id)) ?? row;

    let imageUrls: string[] = [];
    if (current.reference_asset_ids.length) {
      imageUrls = await store.signImageAssets(
        current.workspace_id,
        current.reference_asset_ids,
        IMAGE_URL_TTL_SECONDS,
      );
      if (!imageUrls.length) {
        return fail(
          current,
          "reference_missing",
          "The product photos for this render are no longer available. Upload them again.",
        );
      }
    }

    const result = await provider.submit({
      model,
      prompt: current.prompt,
      durationSec: current.duration_sec,
      aspectRatio: current.aspect_ratio as UgcAspectRatio,
      resolution: current.resolution as UgcResolution,
      audio: current.audio,
      imageUrls,
      callbackUrl: deps.callbackUrl?.(),
    });
    const t = now();
    if (result.ok) {
      const processing = await store.transition(current.id, ["submitting"], {
        status: "processing",
        // Recorded so checks, webhooks, refunds and metering reach the provider that took it.
        provider: result.provider,
        provider_model: result.providerModel,
        provider_task_id: result.taskId,
        provider_state: "waiting",
        provider_meta: { ...current.provider_meta, request: result.request },
        submitted_at: iso(t),
        submit_attempts: current.submit_attempts + 1,
        error_code: null,
        error_message: null,
        next_attempt_at: iso(t + pollDelayMs(iso(t), t)),
        lease_until: null,
      });
      log.info("ugc.render.submitted", {
        renderId: current.id,
        taskId: result.taskId,
        model: model.key,
      });
      return processing ?? (await store.getRender(current.id)) ?? current;
    }
    if (!result.retryable) return fail(current, result.code, result.message);
    const attempts = current.submit_attempts + 1;
    if (attempts >= MAX_SUBMIT_ATTEMPTS) {
      return fail(current, result.code, `${result.message} Your allowance was returned.`);
    }
    return (
      (await store.transition(current.id, ["submitting"], {
        submit_attempts: attempts,
        error_code: result.code,
        error_message: result.message,
        next_attempt_at: iso(t + 30_000 * 2 ** (attempts - 1)),
        lease_until: null,
      })) ?? current
    );
  }

  async function check(row: RenderRow): Promise<RenderRow> {
    const t = now();
    if (!row.provider_task_id)
      return fail(row, "missing_task", "The render lost its provider task.");
    if (row.submitted_at && t - Date.parse(row.submitted_at) > RENDER_TIMEOUT_MS) {
      return fail(
        row,
        "timeout",
        "The render took too long and was stopped. Your allowance was returned.",
      );
    }
    let result;
    try {
      result = await provider.check(row.provider_task_id, row.provider);
    } catch (error) {
      log.warn("ugc.render.check_error", {
        renderId: row.id,
        message: error instanceof Error ? error.message : String(error),
      });
      return (
        (await store.transition(row.id, ["processing"], {
          next_attempt_at: iso(t + 30_000),
          lease_until: null,
        })) ?? row
      );
    }
    if (result.state === "pending") {
      return (
        (await store.transition(row.id, ["processing"], {
          provider_state: result.providerState,
          next_attempt_at: iso(t + pollDelayMs(row.submitted_at, t)),
          lease_until: null,
        })) ?? row
      );
    }
    if (result.state === "failed") {
      await store.transition(row.id, ["processing"], {
        provider_state: result.providerState,
        provider_meta: { ...row.provider_meta, result: result.meta },
      });
      return fail(row, result.code, result.message);
    }
    const persisting = await store.transition(row.id, ["processing"], {
      status: "persisting",
      provider_state: result.providerState,
      actual_cost_usd: result.costUsd,
      provider_meta: {
        ...row.provider_meta,
        result: result.meta,
        videoUrl: result.videoUrl,
        thumbnailUrl: result.thumbnailUrl ?? null,
      },
    });
    if (!persisting) return (await store.getRender(row.id)) ?? row;
    return persist(persisting);
  }

  async function persist(row: RenderRow): Promise<RenderRow> {
    const videoUrl =
      typeof row.provider_meta.videoUrl === "string" ? row.provider_meta.videoUrl : null;
    if (!videoUrl) return fail(row, "no_result", "The provider finished without a video.");
    const persistAttempts = Number(row.provider_meta.persistAttempts ?? 0) + 1;
    const script = row.script as { hook?: string; postCaption?: string };
    // A provider whose file URL needs its API key hands over the bytes instead.
    let dataUrl: string | undefined;
    try {
      dataUrl = (await provider.download?.(videoUrl, row.provider))?.dataUrl;
    } catch (error) {
      log.warn("ugc.render.download_failed", {
        renderId: row.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    const stored = await store.persistVideo({
      row,
      sourceUrl: videoUrl,
      dataUrl,
      idempotencyKey: `ugc:${row.id}:${row.provider_task_id}`,
      metadata: {
        source: "ugc",
        studio_type: "video",
        project_id: row.project_id,
        render_id: row.id,
        model: row.model_key,
        duration: row.duration_sec,
        aspect_ratio: row.aspect_ratio,
        resolution: row.resolution,
        hook: script.hook ?? null,
        caption: script.postCaption ?? null,
      },
    });
    const t = now();
    if (!stored.ok) {
      log.warn("ugc.render.persist_failed", {
        renderId: row.id,
        attempt: persistAttempts,
        message: stored.message,
      });
      if (persistAttempts >= MAX_PERSIST_ATTEMPTS) {
        return fail(
          row,
          "persist_failed",
          "The video was made but couldn't be saved. Your allowance was returned.",
        );
      }
      return (
        (await store.transition(row.id, ["persisting"], {
          provider_meta: { ...row.provider_meta, persistAttempts },
          next_attempt_at: iso(t + 60_000 * persistAttempts),
          lease_until: null,
        })) ?? row
      );
    }
    if (row.reservation_id) {
      const latency = row.submitted_at ? t - Date.parse(row.submitted_at) : null;
      await store.capture(row.reservation_id, row.actual_cost_usd, latency);
    }
    const done = await store.transition(row.id, ["persisting"], {
      status: "succeeded",
      asset_id: stored.assetId,
      completed_at: iso(t),
      error_code: null,
      error_message: null,
      lease_until: null,
    });
    log.info("ugc.render.succeeded", {
      renderId: row.id,
      assetId: stored.assetId,
      costUsd: row.actual_cost_usd,
    });
    return done ?? (await store.getRender(row.id)) ?? row;
  }

  /** Advance one leased render by one step. */
  async function advance(row: RenderRow): Promise<RenderRow> {
    try {
      switch (row.status) {
        case "queued":
        case "submitting":
          return await submit(row);
        case "processing":
          return await check(row);
        case "persisting":
          return await persist(row);
        default:
          return row;
      }
    } catch (error) {
      log.error("ugc.render.advance_error", {
        renderId: row.id,
        status: row.status,
        message: error instanceof Error ? error.message : String(error),
      });
      // Leave it for the next worker, a little later.
      return (
        (await store.transition(row.id, [row.status], {
          next_attempt_at: iso(now() + 60_000),
          lease_until: null,
        })) ?? row
      );
    }
  }

  /** Claim due renders and advance each, within a time budget. */
  async function runDue(opts: { worker: string; budgetMs: number; max: number; id?: string }) {
    const started = now();
    const out = { advanced: 0, succeeded: 0, failed: 0, swept: 0 };
    if (!opts.id) out.swept = await store.sweepExpiredReservations();
    while (now() - started < opts.budgetMs) {
      const rows = await store.claim(
        opts.worker,
        opts.id ? 1 : Math.min(opts.max, 5),
        LEASE_SECONDS,
        opts.id,
      );
      if (!rows.length) break;
      for (const row of rows) {
        const next = await advance(row);
        out.advanced++;
        if (next.status === "succeeded") out.succeeded++;
        if (next.status === "failed") out.failed++;
      }
      if (opts.id || out.advanced >= opts.max) break;
    }
    return out;
  }

  /** Cancel before the provider starts working. Rendering tasks can't be stopped at Kie. */
  async function cancel(row: RenderRow): Promise<{ ok: boolean; row: RenderRow }> {
    const cancelled = await store.transition(row.id, ["queued", "submitting"] as RenderStatus[], {
      status: "cancelled",
      error_code: "cancelled",
      error_message: "Cancelled before rendering started.",
      completed_at: iso(now()),
      lease_until: null,
    });
    if (!cancelled) return { ok: false, row: (await store.getRender(row.id)) ?? row };
    if (cancelled.reservation_id) await store.release(cancelled.reservation_id, "cancelled");
    return { ok: true, row: cancelled };
  }

  return { advance, runDue, cancel, fail };
}

export type RenderEngine = ReturnType<typeof createRenderEngine>;
export type { RenderPatch };
