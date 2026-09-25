// OpenRouter implementation of VideoProvider (POST /api/v1/videos, confirmed
// 2026-09-25): an asynchronous job — submit returns an id, GET
// /api/v1/videos/{id} reports pending | in_progress | completed | failed |
// cancelled | expired, and the finished file is streamed from
// /api/v1/videos/{id}/content with the API key (the URL is not presigned, so
// the file is downloaded here and handed to storage, never linked).
//
// Images: `frame_images` (first frame) for image-to-video models,
// `input_references` for reference-to-video models. Completion can also arrive
// by webhook (callback_url → /api/public/hooks/openrouter-video, HMAC-signed
// with OPENROUTER_WEBHOOK_SECRET); the webhook only makes a render due, and
// the status is always re-read here.
import "server-only";
import { fetchWithTimeout } from "@/server/upstream";
import {
  AiGatewayError,
  getOpenRouterKey,
  mapOpenRouterError,
  OPENROUTER_BASE,
  openRouterHeaders,
} from "@/lib/ai-gateway.server";
import { providerSpec, type UgcModel } from "@/lib/ugc/models";
import { getAppUrl } from "@/server/env";
import { MAX_ASSET_BYTES } from "@/server/assets/persist.server";
import { log } from "@/server/observability/logger";
import { safeFetch } from "@/server/safe-fetch";
import type {
  DownloadedVideo,
  ProviderCheck,
  ProviderFailure,
  SubmitResult,
  VideoProvider,
  VideoRenderRequest,
} from "./types";
import { friendlyFailure } from "./failure";

const SUBMIT_TIMEOUT_MS = 30_000;
const POLL_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

/** Completion webhooks reach only a public HTTPS app with a signing secret. */
export function openRouterVideoCallbackUrl(): string | undefined {
  if (!process.env.OPENROUTER_WEBHOOK_SECRET?.trim()) return undefined;
  const app = getAppUrl();
  if (!/^https:\/\//i.test(app) || /localhost|127\.0\.0\.1/i.test(app)) return undefined;
  return `${app}/api/public/hooks/openrouter-video`;
}

/** OpenRouter's resolution tiers ("2K" upper-case, the rest as-is). */
function orResolution(res: string): string {
  return res === "2k" ? "2K" : res;
}

export function openRouterGenerationType(model: UgcModel, imageCount: number): string {
  if (imageCount === 0 || !model.images) return "TEXT_TO_VIDEO";
  return model.images.mode === "references" ? "REFERENCE_TO_VIDEO" : "IMAGE_TO_VIDEO";
}

/** The OpenRouter request body for a render. Exported for tests. */
export function buildOpenRouterVideoBody(
  req: VideoRenderRequest,
  callbackUrl?: string,
): Record<string, unknown> {
  const spec = providerSpec(req.model, "openrouter");
  if (!spec) throw new Error(`${req.model.key} has no OpenRouter model`);
  const images = spec.images ? req.imageUrls.slice(0, spec.images.max) : [];
  const body: Record<string, unknown> = {
    model: spec.model,
    prompt: req.prompt.slice(0, 20_000),
    duration: req.durationSec,
    resolution: orResolution(req.resolution),
    aspect_ratio: req.aspectRatio,
  };
  if (spec.nativeAudio) body.generate_audio = req.audio ?? true;
  if (images.length && spec.images?.mode === "first_frame") {
    body.frame_images = [
      { type: "image_url", image_url: { url: images[0] }, frame_type: "first_frame" },
    ];
  } else if (images.length) {
    body.input_references = images.map((url) => ({ type: "image_url", image_url: { url } }));
  }
  if (callbackUrl) body.callback_url = callbackUrl;
  return body;
}

/** Map an OpenRouter error to a failure the user can act on. Exported for tests. */
export function openRouterFailure(error: unknown): ProviderFailure {
  if (error instanceof AiGatewayError) {
    switch (error.code) {
      case "insufficient_credits":
        return {
          code: "provider_credits",
          message: "The video provider account is out of credits. Please try again later.",
          retryable: false,
          definite: true,
        };
      case "missing_api_key":
      case "invalid_api_key":
        return {
          code: "provider_configuration",
          message: "Video generation isn't configured on the server. Contact your workspace admin.",
          retryable: false,
          definite: true,
        };
      case "rate_limited":
        return {
          code: "provider_rate_limit",
          message: error.message,
          retryable: true,
          definite: true,
        };
      case "no_endpoints":
        return {
          code: "provider_model_unavailable",
          message: "This video model is unavailable at the provider right now.",
          retryable: true,
          definite: true,
        };
      case "timeout":
      case "network_error":
        // Unknown outcome: the job may be running. Never resubmitted elsewhere.
        return { code: `provider_${error.code}`, message: error.message, retryable: true };
      case "provider_error":
        return { code: "provider_error", message: error.message, retryable: true, definite: true };
      default:
        return {
          code: "provider_rejected",
          message: error.message.slice(0, 300),
          retryable: false,
          definite: true,
        };
    }
  }
  return {
    code: "provider_error",
    message: "The video provider could not be reached.",
    retryable: true,
  };
}

async function orFetch(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return fetchWithTimeout(
    `${OPENROUTER_BASE}${path}`,
    { ...init, headers: openRouterHeaders(getOpenRouterKey()) },
    {
      timeoutMs,
      onTransportError: ({ kind, detail }) =>
        kind === "timeout"
          ? new AiGatewayError(504, "The video provider timed out.", "timeout")
          : new AiGatewayError(
              502,
              `Network error contacting the video provider: ${detail}`,
              "network_error",
            ),
    },
  );
}

const FRAME_TYPES = new Set(["image/jpeg", "image/png"]);
const MAX_FRAME_BYTES = 20 * 1024 * 1024;

/**
 * OpenRouter's video models take JPEG or PNG images only (confirmed live:
 * "Unsupported image format. Expected JPEG or PNG."). A JPEG/PNG link goes
 * through as-is; anything else (WebP, AVIF, HEIC product photos) is fetched
 * through the SSRF guard and re-encoded as a PNG data URL. Exported for tests.
 */
export async function frameReadyImage(url: string): Promise<string> {
  const res = await safeFetch(url, {
    timeoutMs: 20_000,
    maxBytes: MAX_FRAME_BYTES,
    onOverflow: "error",
  });
  if (!res.ok)
    throw new AiGatewayError(502, "A product photo couldn't be read.", "invalid_request");
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (FRAME_TYPES.has(type)) return url;
  const { default: sharp } = await import("sharp");
  const png = await sharp(Buffer.from(res.bytes))
    .rotate()
    .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

const PENDING = new Set(["pending", "queued", "in_progress", "processing"]);

export const openRouterVideoProvider: VideoProvider = {
  id: "openrouter",

  generationType: openRouterGenerationType,

  async submit(req: VideoRenderRequest): Promise<SubmitResult> {
    let imageUrls: string[];
    try {
      imageUrls = await Promise.all(req.imageUrls.map(frameReadyImage));
    } catch (error) {
      log.warn("ugc.openrouter.image_prep_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        code: "reference_unreadable",
        message: "A product photo couldn't be prepared for the video model. Try another photo.",
        retryable: true,
      };
    }
    let body: Record<string, unknown>;
    try {
      body = buildOpenRouterVideoBody({ ...req, imageUrls }, openRouterVideoCallbackUrl());
    } catch (error) {
      return {
        ok: false,
        code: "provider_model_unavailable",
        message: error instanceof Error ? error.message : "No OpenRouter model for this render.",
        retryable: false,
        definite: true,
      };
    }
    try {
      // Never retried: OpenRouter has no idempotency key on submit, so a
      // retried POST after a lost response could start (and bill) a second job.
      const res = await orFetch(
        "/videos",
        { method: "POST", body: JSON.stringify(body) },
        SUBMIT_TIMEOUT_MS,
      );
      if (!res.ok) throw mapOpenRouterError(res.status, await res.text().catch(() => ""));
      const json = (await res.json().catch(() => null)) as { id?: unknown } | null;
      const taskId = typeof json?.id === "string" ? json.id : "";
      if (!taskId) {
        // Accepted (2xx) but no id: the job may exist. Not retried elsewhere.
        return {
          ok: false,
          code: "provider_response",
          message: "The video provider did not return a job id.",
          retryable: false,
        };
      }
      const {
        prompt: _p,
        frame_images: _f,
        input_references: _r,
        callback_url: _c,
        ...request
      } = body;
      log.info("ugc.openrouter.submitted", { model: body.model, taskId });
      return {
        ok: true,
        taskId,
        request,
        provider: "openrouter",
        providerModel: String(body.model),
      };
    } catch (error) {
      const failure = openRouterFailure(error);
      log.warn("ugc.openrouter.submit_failed", { model: req.model.key, ...failure });
      return { ok: false, ...failure };
    }
  },

  async check(taskId: string): Promise<ProviderCheck> {
    const res = await orFetch(
      `/videos/${encodeURIComponent(taskId)}`,
      { method: "GET" },
      POLL_TIMEOUT_MS,
    );
    if (!res.ok) throw mapOpenRouterError(res.status, await res.text().catch(() => ""));
    const job = (await res.json()) as {
      status?: string;
      unsigned_urls?: unknown;
      usage?: { cost?: unknown };
      error?: unknown;
      generation_id?: unknown;
    };
    const status = String(job?.status ?? "").toLowerCase();
    const meta: Record<string, unknown> = {
      providerState: status,
      generationId: typeof job?.generation_id === "string" ? job.generation_id : null,
    };
    if (PENDING.has(status)) return { state: "pending", providerState: status };
    if (status === "completed") {
      const urls = Array.isArray(job.unsigned_urls)
        ? job.unsigned_urls.filter((u): u is string => typeof u === "string")
        : [];
      const videoUrl = urls[0];
      if (!videoUrl || !videoUrl.startsWith(OPENROUTER_BASE)) {
        return {
          state: "failed",
          providerState: status,
          meta,
          code: "no_result",
          message: "The provider finished without a video. Your allowance was returned.",
          retryable: false,
        };
      }
      const cost = Number(job.usage?.cost);
      return {
        state: "success",
        providerState: status,
        videoUrl,
        costUsd: Number.isFinite(cost) ? Math.round(cost * 1_000_000) / 1_000_000 : null,
        meta,
      };
    }
    return {
      state: "failed",
      providerState: status || "unknown",
      meta,
      code: status === "expired" ? "timeout" : "render_failed",
      message: friendlyFailure(typeof job?.error === "string" ? job.error : null),
      retryable: false,
    };
  },

  async download(videoUrl: string): Promise<DownloadedVideo | null> {
    // Only OpenRouter's own content URLs ever get the API key.
    if (!videoUrl.startsWith(`${OPENROUTER_BASE}/videos/`)) return null;
    const path = videoUrl.slice(OPENROUTER_BASE.length);
    const res = await orFetch(path, { method: "GET" }, DOWNLOAD_TIMEOUT_MS);
    if (!res.ok) throw mapOpenRouterError(res.status, await res.text().catch(() => ""));
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_ASSET_BYTES)
      throw new AiGatewayError(413, "The video is too large to store.", "too_large");
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_ASSET_BYTES) {
      throw new AiGatewayError(413, "The video is empty or too large to store.", "too_large");
    }
    const mimeType = res.headers.get("content-type")?.split(";")[0] || "video/mp4";
    return { dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`, bytes: bytes.length };
  },
};
