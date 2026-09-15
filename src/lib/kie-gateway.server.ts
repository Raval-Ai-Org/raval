import "server-only";
import { UpstreamError } from "@/server/upstream";
import { cache, digest, recordCacheLookup } from "@/server/cache/store";
import { enforceBudget } from "@/server/ai/budget";
import { recordUsage } from "@/server/ai/metering";
import { unitPrice } from "@/server/ai/pricing";
import { getRequestScope } from "@/server/request-context";
import { log } from "@/server/observability/logger";
import {
  getImageModelConfigStatus,
  routeImageModel,
  type ImageRoutingInput,
} from "./model-router.server";

const KIE_BASE = "https://api.kie.ai/api/v1";
const KIE_VIDEO_MODEL = process.env.KIE_VIDEO_MODEL?.trim() || "veo-3-1";
const SUPPORTED_VIDEO_DURATIONS = [4, 6, 8] as const;
const TASK_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 3_000;
const IMAGE_URL_TIMEOUT_MS = 30_000;
/** Generated-image cache (shared cache, per tenant). */
const IMAGE_CACHE_TTL_SECONDS = 2 * 60 * 60;
/** A provider-returned image larger than this is refused rather than buffered. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
// In-flight dedupe stays per-process; the finished image goes to the shared cache.
const inflight = new Map<string, Promise<{ b64: string; mimeType: string }>>();

function imagePrice(model: string): number {
  return unitPrice(/sunburst|premium/i.test(model) ? "kie:image:premium" : "kie:image");
}

export type MediaType = "image" | "video" | "audio";

export type GeneratedMedia = {
  type: MediaType;
  provider: "kie";
  generationId: string;
  urls: string[];
  mimeType: string;
};

export type ImageGenerationMetadata = {
  creativeBriefVersion?: string;
  brandDnaVersion?: string;
  promptVersion?: string;
  attempt?: number;
  seed?: string;
  referenceAssets?: string[];
};

export type VideoAspectRatio = "adaptive" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
export type VideoResolution = "480P" | "720P" | "1080P";

function normalizeKieAspectRatio(
  value?: VideoAspectRatio,
): "16:9" | "9:16" | "1:1" | "4:3" | "3:4" {
  switch (value ?? "16:9") {
    case "9:16":
      return "9:16";
    case "1:1":
      return "1:1";
    case "4:3":
      return "4:3";
    case "3:4":
      return "3:4";
    case "adaptive":
    case "16:9":
    default:
      return "16:9";
  }
}

export type GeneratedVideo = {
  type: "video";
  provider: "kie";
  generationId: string;
  videoUrl: string;
  thumbnailUrl?: string;
  duration: number;
  aspectRatio: VideoAspectRatio;
  model: string;
  status: "completed";
  metadata?: Record<string, unknown>;
};

export function getKieConfigStatus() {
  const image = getImageModelConfigStatus();
  return {
    configured: Boolean(process.env.KIE_API_KEY?.trim()),
    image: {
      ...image,
      defaultRouteConfigured: image.defaultConfigured && image.premiumConfigured,
      imageToImageRouteConfigured: image.editConfigured && image.premiumEditConfigured,
      availability: "not-probed" as const,
    },
    videoModelConfigured: Boolean(process.env.KIE_VIDEO_MODEL?.trim()),
    videoModel: KIE_VIDEO_MODEL,
    runtime: "node",
  } as const;
}

export class KieGatewayError extends UpstreamError {
  readonly category: string;

  constructor(status: number, message: string, category = "provider") {
    super(status, message, { provider: "kie", code: category });
    this.name = "KieGatewayError";
    this.category = category;
  }
}

function getApiKey(): string {
  const key = process.env.KIE_API_KEY?.trim();
  if (!key) {
    throw new KieGatewayError(
      503,
      "Kie image generation is not configured. Set KIE_API_KEY on the server and restart the app.",
      "configuration",
    );
  }
  return key;
}

function headers(key: string): HeadersInit {
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

/**
 * Kie reuses HTTP-500-shaped codes for plain request-validation failures (an
 * unsupported aspect ratio, a missing field) as well as for genuine provider
 * errors — confirmed by direct testing: both `{"code":500,"msg":"This
 * aspect_ratio is not within the range of allowed options"}` and a real
 * transient failure come back the same shape. Recognize the validation kind
 * by its message so it fails fast (no retry, no model fallback burning
 * credits on a request that will never succeed) instead of being treated as
 * a temporary outage.
 */
const VALIDATION_HINT_RE = /not within the range|is required|not supported|invalid|must be one of/i;

function mapStatus(status: number, detail?: string): KieGatewayError {
  const message = detail?.trim() || undefined;
  if (status === 401 || status === 403)
    return new KieGatewayError(
      503,
      "Kie authentication failed. Check the server-side API key.",
      "authentication",
    );
  if (status === 429)
    return new KieGatewayError(
      429,
      "Kie is rate limiting generation requests. Please try again shortly.",
      "rate_limit",
    );
  if (status === 422)
    return new KieGatewayError(422, message || "Kie rejected this request.", "request");
  if (status >= 400 && status < 500)
    return new KieGatewayError(400, message || "Kie rejected this request.", "request");
  if (message && VALIDATION_HINT_RE.test(message)) {
    return new KieGatewayError(400, message, "request");
  }
  // A real 5xx / unrecognized code: never invent detail Kie didn't give us,
  // but never discard detail it did give us either — the generic sentence is
  // strictly a fallback for a genuinely empty response.
  return new KieGatewayError(
    502,
    message ? `The image provider rejected the request: ${message}` : "The image provider is temporarily unavailable.",
    "provider",
  );
}

/** A blip worth one silent retry rather than surfacing to the user. */
const TRANSIENT_RETRY_CATEGORIES = new Set(["provider", "network"]);
const TRANSIENT_RETRY_DELAYS_MS = [800, 2000];

async function fetchJsonOnce(url: string, init: RequestInit, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    let payload: any;
    try {
      payload = await response.json();
    } catch {
      if (!response.ok)
        throw mapStatus(response.status, "The Kie provider returned malformed data.");
      throw new KieGatewayError(502, "The Kie provider returned malformed data.", "response");
    }

    const kCode = Number(payload?.code ?? payload?.status ?? 0);
    if (payload && (payload.code !== undefined || payload.status !== undefined)) {
      const msg = typeof payload?.msg === "string" ? payload.msg : undefined;
      if (kCode !== 200 && kCode !== 0) {
        throw mapStatus(kCode || response.status || 400, msg || "Kie rejected this request.");
      }
    }

    if (!response.ok)
      throw mapStatus(response.status, payload?.msg || "The Kie provider rejected the request.");
    return payload;
  } catch (error) {
    if (error instanceof KieGatewayError) throw error;
    if ((error as { name?: string })?.name === "AbortError")
      throw new KieGatewayError(504, "Image generation timed out. Please retry.", "timeout");
    throw new KieGatewayError(502, "The image provider could not be reached.", "network");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A single 5xx or dropped connection from Kie shouldn't fail the whole
 * generation — it's usually a passing blip, not a real outage. Retry those
 * (never validation/auth/rate-limit errors, which won't change on retry)
 * before letting the error reach the caller.
 */
async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<any> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= TRANSIENT_RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fetchJsonOnce(url, init, timeoutMs);
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof KieGatewayError && TRANSIENT_RETRY_CATEGORIES.has(error.category);
      if (!retryable || attempt === TRANSIENT_RETRY_DELAYS_MS.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAYS_MS[attempt]));
    }
  }
  throw lastError;
}

function aspectRatio(size: "1024x1024" | "1792x1024" | "1024x1792"): string {
  if (size === "1792x1024") return "16:9";
  if (size === "1024x1792") return "9:16";
  return "1:1";
}

/**
 * Cache key for a generated image. Includes the tenant and the reference
 * images: the old key (`model|size|prompt`) returned the previous result for
 * an image-to-image edit of a DIFFERENT reference with the same prompt, and
 * shared generated images across tenants.
 */
async function cacheKey(
  prompt: string,
  size: string,
  model: string,
  referenceAssets: string[] = [],
): Promise<string> {
  const scope = getRequestScope();
  const tenant = scope.workspaceId
    ? `ws:${scope.workspaceId}`
    : scope.userId
      ? `u:${scope.userId}`
      : "anon";
  return `kie:img:${await digest(`${tenant}|${model}|${size}|${referenceAssets.join(",")}|${prompt}`)}`;
}

function resultUrls(record: any): string[] {
  const visit = (value: any, depth: number): string[] => {
    if (depth > 8 || value == null) return [];
    if (typeof value === "string") {
      if (/^https:\/\//i.test(value)) return [value];
      try {
        return visit(JSON.parse(value), depth + 1);
      } catch {
        return [];
      }
    }
    if (Array.isArray(value)) return value.flatMap((item) => visit(item, depth + 1));
    if (typeof value !== "object") return [];

    const urls: string[] = [];
    for (const key of [
      "resultUrls",
      "result_urls",
      "urls",
      "images",
      "videos",
      "videoUrl",
      "video_url",
      "url",
    ]) {
      if (key in value) urls.push(...visit(value[key], depth + 1));
    }
    for (const key of ["resultJson", "result_json", "result", "data"]) {
      if (key in value) urls.push(...visit(value[key], depth + 1));
    }
    return [...new Set(urls)];
  };

  return visit(record, 0);
}

async function createTask(
  prompt: string,
  size: "1024x1024" | "1792x1024" | "1024x1792",
  model: string,
  referenceAssets: string[],
) {
  const input: Record<string, unknown> = {
    prompt: prompt.slice(0, 10_000),
    aspect_ratio: aspectRatio(size),
    resolution: "1K",
    background: "opaque",
  };
  if (referenceAssets.length) input.image_urls = referenceAssets;
  const started = Date.now();
  try {
    const json = await fetchJson(
      `${KIE_BASE}/jobs/createTask`,
      {
        method: "POST",
        headers: headers(getApiKey()),
        body: JSON.stringify({
          model,
          input,
        }),
      },
      30_000,
    );
    const taskId = json?.data?.taskId ?? json?.data?.task_id ?? json?.taskId ?? json?.task_id;
    if (typeof taskId !== "string" || !taskId) {
      throw new KieGatewayError(502, "The image provider did not return a task ID.", "response");
    }
    log.info("kie.image.submitted", {
      model,
      aspectRatio: input.aspect_ratio,
      hasReference: referenceAssets.length > 0,
      taskId,
      elapsedMs: Date.now() - started,
    });
    return taskId;
  } catch (error) {
    log.warn("kie.image.submit_failed", {
      model,
      aspectRatio: input.aspect_ratio,
      hasReference: referenceAssets.length > 0,
      elapsedMs: Date.now() - started,
      status: error instanceof KieGatewayError ? error.status : undefined,
      category: error instanceof KieGatewayError ? error.category : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function waitForTask(taskId: string): Promise<string[]> {
  const deadline = Date.now() + TASK_TIMEOUT_MS;
  const startedAt = Date.now();
  while (Date.now() < deadline) {
    const json = await fetchJson(
      `${KIE_BASE}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
      { headers: headers(getApiKey()) },
      30_000,
    );
    const record = json?.data ?? json;
    const state = String(record?.state ?? record?.status ?? record?.taskStatus ?? "").toLowerCase();
    if (["success", "completed", "succeeded"].includes(state)) {
      const urls = resultUrls(record);
      if (!urls.length) {
        log.warn("kie.image.empty_result", { taskId, state, elapsedMs: Date.now() - startedAt });
        throw new KieGatewayError(502, "The image provider returned no image.", "response");
      }
      log.info("kie.image.completed", { taskId, state, elapsedMs: Date.now() - startedAt });
      return urls;
    }
    if (["fail", "failed", "error", "cancelled"].includes(state)) {
      const reason =
        typeof record?.failMsg === "string" && record.failMsg.trim()
          ? record.failMsg.trim().slice(0, 200)
          : undefined;
      log.warn("kie.image.task_failed", {
        taskId,
        state,
        reason,
        elapsedMs: Date.now() - startedAt,
      });
      throw new KieGatewayError(
        502,
        reason
          ? `Image generation failed at the provider: ${reason}`
          : "Image generation failed at the provider.",
        state === "cancelled" ? "cancelled" : "generation",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  log.warn("kie.image.timeout", { taskId, elapsedMs: Date.now() - startedAt });
  throw new KieGatewayError(504, "Image generation timed out. Please retry.", "timeout");
}

async function downloadImage(url: string): Promise<{ b64: string; mimeType: string }> {
  if (!/^https:\/\//i.test(url))
    throw new KieGatewayError(502, "The image provider returned an invalid image URL.", "response");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_URL_TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      log.warn("kie.image.download_failed", {
        httpStatus: response.status,
        elapsedMs: Date.now() - started,
      });
      throw new KieGatewayError(502, "The generated image could not be downloaded.", "storage");
    }
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_IMAGE_BYTES)
      throw new KieGatewayError(502, "The generated image is too large to accept.", "response");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES)
      throw new KieGatewayError(502, "The generated image is too large to accept.", "response");
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    log.info("kie.image.downloaded", { bytes: bytes.byteLength, elapsedMs: Date.now() - started });
    return {
      b64: btoa(binary),
      mimeType: response.headers.get("content-type")?.split(";")[0] || "image/png",
    };
  } catch (error) {
    if (error instanceof KieGatewayError) throw error;
    log.warn("kie.image.download_error", {
      elapsedMs: Date.now() - started,
      message: error instanceof Error ? error.message : String(error),
    });
    throw new KieGatewayError(502, "The generated image could not be downloaded.", "network");
  } finally {
    clearTimeout(timer);
  }
}

export async function imageGenerationStream(opts: {
  prompt: string;
  size?: "1024x1024" | "1792x1024" | "1024x1792";
  routing?: Omit<ImageRoutingInput, "prompt">;
  metadata?: ImageGenerationMetadata;
  maxAttempts?: number;
}): Promise<Response> {
  const size = opts.size ?? "1024x1024";
  const referenceAssets = (opts.routing?.referenceAssets ?? [])
    .filter((value): value is string => typeof value === "string" && /^https:\/\//i.test(value))
    .slice(0, 4);
  const requiresReference = Boolean(
    opts.routing?.hasReference ||
    opts.routing?.editing ||
    opts.routing?.taskType === "reference" ||
    opts.routing?.taskType === "editing" ||
    referenceAssets.length,
  );
  if (requiresReference && referenceAssets.length === 0) {
    throw new KieGatewayError(
      422,
      "Image-to-image generation requires at least one HTTPS reference image.",
      "request",
    );
  }
  const plan = routeImageModel({ prompt: opts.prompt, ...opts.routing });
  // Billed per image: the workspace's monthly image quota and spend ceiling apply.
  await enforceBudget("image");
  let image: { b64: string; mimeType: string } | undefined;
  let lastError: unknown;
  const candidates = [plan.model, ...plan.fallbacks].slice(
    0,
    Math.max(1, Math.min(3, opts.maxAttempts ?? 3)),
  );
  let attempt = 0;
  for (const model of candidates) {
    attempt += 1;
    const key = await cacheKey(opts.prompt, size, model, referenceAssets);
    try {
      image = (await cache.get<{ b64: string; mimeType: string }>(key)) ?? undefined;
      recordCacheLookup("image", Boolean(image));
      if (image) {
        recordUsage({
          provider: "kie",
          model,
          kind: "image",
          cached: true,
          savedUsd: imagePrice(model),
        });
      }
      if (!image) {
        let pending = inflight.get(key);
        if (!pending) {
          pending = (async () => {
            const started = Date.now();
            try {
              const taskId = await createTask(opts.prompt, size, model, referenceAssets);
              const [url] = await waitForTask(taskId);
              const downloaded = await downloadImage(url);
              recordUsage({
                provider: "kie",
                model,
                kind: "image",
                units: 1,
                estCostUsd: imagePrice(model),
                latencyMs: Date.now() - started,
              });
              await cache.set(key, downloaded, IMAGE_CACHE_TTL_SECONDS);
              return downloaded;
            } catch (error) {
              recordUsage({
                provider: "kie",
                model,
                kind: "image",
                status: "error",
                latencyMs: Date.now() - started,
              });
              throw error;
            }
          })();
          inflight.set(key, pending);
          void pending.then(
            () => inflight.delete(key),
            () => inflight.delete(key),
          );
        }
        image = await pending;
      }
      if (image) break;
    } catch (error) {
      lastError = error;
      if (
        error instanceof KieGatewayError &&
        ["configuration", "authentication", "request"].includes(error.category)
      )
        throw error;
    }
  }
  if (!image)
    throw lastError instanceof Error
      ? lastError
      : new KieGatewayError(502, "No image model completed the request.", "provider");
  const payload = JSON.stringify({ b64_json: image.b64, mime_type: image.mimeType });
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(`event: image_generation.completed\ndata: ${payload}\n\n`),
      );
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Creative-Model": plan.model,
      "X-Creative-Route": plan.route,
      "X-Creative-Attempt": String(attempt),
      "X-Creative-Prompt-Version": opts.metadata?.promptVersion ?? "1",
      "X-Creative-Brief-Version": opts.metadata?.creativeBriefVersion ?? "1",
    },
  });
}

/* ───────────── Async task API (Studio jobs) ─────────────
 * The functions above hold a request open until the provider finishes. Studio
 * instead starts a task, stores its id, and checks it on each poll — so a
 * render survives navigation and never outlives an HTTP timeout. */

export type KieImageSize = "1024x1024" | "1024x1280" | "1792x1024" | "1024x1792";

function imageAspect(size: KieImageSize): string {
  // Kie's gpt-image-2-5 models reject "4:5" outright — confirmed live:
  // {"code":500,"msg":"This aspect_ratio is not within the range of allowed
  // options"}. Verified-supported ratios include 1:1, 4:3, 3:4, 3:2, 2:3,
  // 16:9, 9:16, 21:9. 3:4 is the closest supported ratio to Instagram's 4:5
  // portrait crop, so Studio's portrait format (1024x1280) renders as 3:4
  // instead of failing every request. This was the root cause of every
  // Studio image render failing: Instagram/Facebook/Threads default to 4:5,
  // and carousel always uses 4:5.
  return size === "1024x1280"
    ? "3:4"
    : aspectRatio(size as "1024x1024" | "1792x1024" | "1024x1792");
}

export type StartedTask = { taskId: string; model: string; route: string; fallbacks: string[] };

/** Route a model, enforce the image budget, and create one provider task. */
export async function startImageTask(opts: {
  prompt: string;
  size: KieImageSize;
  referenceAssets?: string[];
  model?: string;
}): Promise<StartedTask> {
  const referenceAssets = (opts.referenceAssets ?? [])
    .filter((value) => /^https:\/\//i.test(value))
    .slice(0, 4);
  const plan = routeImageModel({
    prompt: opts.prompt,
    hasReference: referenceAssets.length > 0,
    referenceAssets,
    editing: referenceAssets.length > 0,
  });
  if (!opts.model) await enforceBudget("image");
  const key = getApiKey();
  const input: Record<string, unknown> = {
    prompt: opts.prompt.slice(0, 10_000),
    aspect_ratio: imageAspect(opts.size),
    resolution: "1K",
    background: "opaque",
  };
  if (referenceAssets.length) input.image_urls = referenceAssets;

  // fetchJson already retries a lone 5xx/network blip; if that model still
  // won't accept the task, fall back to the next candidate rather than
  // failing generation outright (matches imageGenerationStream's behaviour).
  const candidates = opts.model
    ? [opts.model]
    : [plan.model, ...plan.fallbacks].filter(
        (candidate, index, all) => candidate && all.indexOf(candidate) === index,
      );
  let model = candidates[0];
  let lastError: unknown;
  let json: any;
  const startedAt = Date.now();
  for (const candidate of candidates) {
    try {
      json = await fetchJson(
        `${KIE_BASE}/jobs/createTask`,
        {
          method: "POST",
          headers: headers(key),
          body: JSON.stringify({ model: candidate, input }),
        },
        30_000,
      );
      model = candidate;
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      log.warn("kie.studio.image.submit_failed", {
        model: candidate,
        aspectRatio: input.aspect_ratio,
        hasReference: referenceAssets.length > 0,
        status: error instanceof KieGatewayError ? error.status : undefined,
        category: error instanceof KieGatewayError ? error.category : undefined,
        message: error instanceof Error ? error.message : String(error),
      });
      if (
        error instanceof KieGatewayError &&
        ["configuration", "authentication", "request"].includes(error.category)
      )
        break; // not retryable — stop trying other candidates too
    }
  }
  if (lastError) {
    recordUsage({
      provider: "kie",
      model,
      kind: "image",
      status: "error",
      latencyMs: Date.now() - startedAt,
    });
    throw lastError;
  }
  const taskId = json?.data?.taskId ?? json?.data?.task_id ?? json?.taskId ?? json?.task_id;
  if (typeof taskId !== "string" || !taskId) {
    recordUsage({
      provider: "kie",
      model,
      kind: "image",
      status: "error",
      latencyMs: Date.now() - startedAt,
    });
    throw new KieGatewayError(502, "The image provider did not return a task ID.", "response");
  }
  log.info("kie.studio.image.submitted", {
    model,
    aspectRatio: input.aspect_ratio,
    hasReference: referenceAssets.length > 0,
    taskId,
    elapsedMs: Date.now() - startedAt,
  });
  return {
    taskId,
    model,
    route: plan.route,
    fallbacks: plan.fallbacks.filter((m) => m !== model),
  };
}

/** Enforce the video budget and create one provider task. */
export async function startVideoTask(opts: {
  prompt: string;
  aspectRatio?: VideoAspectRatio;
  duration?: number;
  resolution?: VideoResolution;
  audio?: boolean;
  seed?: number;
}): Promise<StartedTask> {
  const duration = opts.duration ?? 6;
  if (!SUPPORTED_VIDEO_DURATIONS.includes(duration as (typeof SUPPORTED_VIDEO_DURATIONS)[number])) {
    throw new KieGatewayError(400, "Video duration must be 4, 6, or 8 seconds.", "request");
  }
  await enforceBudget("video");
  const model = KIE_VIDEO_MODEL;
  const startedAt = Date.now();
  try {
    const json = await fetchJson(
      `${KIE_BASE}/jobs/createTask`,
      {
        method: "POST",
        headers: headers(getApiKey()),
        body: JSON.stringify({
          model,
          input: {
            prompt: opts.prompt.slice(0, 20_000),
            resolution: opts.resolution ?? "720P",
            aspect_ratio: normalizeKieAspectRatio(opts.aspectRatio),
            duration,
            audio: opts.audio ?? true,
            seed: opts.seed ?? 0,
            nsfw_checker: true,
          },
        }),
      },
      30_000,
    );
    const taskId = json?.data?.taskId ?? json?.data?.task_id ?? json?.taskId ?? json?.task_id;
    if (typeof taskId !== "string" || !taskId) {
      throw new KieGatewayError(502, "The video provider did not return a task ID.", "response");
    }
    log.info("kie.studio.video.submitted", { model, taskId, elapsedMs: Date.now() - startedAt });
    return { taskId, model, route: "video", fallbacks: [] };
  } catch (error) {
    log.warn("kie.studio.video.submit_failed", {
      model,
      elapsedMs: Date.now() - startedAt,
      status: error instanceof KieGatewayError ? error.status : undefined,
      category: error instanceof KieGatewayError ? error.category : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
    recordUsage({
      provider: "kie",
      model,
      kind: "video",
      status: "error",
      latencyMs: Date.now() - startedAt,
    });
    throw error;
  }
}

export type TaskCheck =
  | { state: "pending" }
  | { state: "success"; urls: string[] }
  | { state: "failed"; message: string };

/** One status read — never waits. */
export async function checkTask(taskId: string): Promise<TaskCheck> {
  const json = await fetchJson(
    `${KIE_BASE}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
    { headers: headers(getApiKey()) },
    30_000,
  );
  const record = json?.data ?? json;
  const state = String(record?.state ?? record?.status ?? record?.taskStatus ?? "").toLowerCase();
  if (["success", "completed", "succeeded"].includes(state)) {
    const urls = resultUrls(record);
    if (!urls.length) return { state: "failed", message: "The provider returned no result." };
    return { state: "success", urls };
  }
  if (["fail", "failed", "error", "cancelled"].includes(state)) {
    const reason =
      typeof record?.failMsg === "string" && record.failMsg.trim()
        ? record.failMsg.trim().slice(0, 200)
        : "The provider could not complete this render.";
    log.warn("kie.task_failed", { taskId, state, reason });
    return { state: "failed", message: reason };
  }
  return { state: "pending" };
}

export function recordTaskUsage(args: {
  kind: "image" | "video";
  model: string;
  latencyMs: number;
  ok: boolean;
  taskId?: string;
}) {
  log[args.ok ? "info" : "warn"]("kie.task_completed", {
    kind: args.kind,
    model: args.model,
    taskId: args.taskId,
    ok: args.ok,
    elapsedMs: args.latencyMs,
  });
  recordUsage({
    provider: "kie",
    model: args.model,
    kind: args.kind,
    ...(args.ok
      ? {
          units: 1,
          estCostUsd: args.kind === "video" ? unitPrice("kie:video") : imagePrice(args.model),
        }
      : { status: "error" as const }),
    latencyMs: args.latencyMs,
  });
}

export function pickVideoUrl(urls: string[]): { videoUrl?: string; thumbnailUrl?: string } {
  return {
    videoUrl: urls.find((url) => /\.(mp4|webm|mov)(?:\?|$)/i.test(url)) ?? urls[0],
    thumbnailUrl: urls.find((url) => /\.(png|jpe?g|webp)(?:\?|$)/i.test(url)),
  };
}

export async function videoGeneration(opts: {
  prompt: string;
  aspectRatio?: VideoAspectRatio;
  duration?: number;
  resolution?: VideoResolution;
  audio?: boolean;
  seed?: number;
}): Promise<GeneratedVideo> {
  const aspectRatio = normalizeKieAspectRatio(opts.aspectRatio);
  const duration = opts.duration ?? 6;
  const resolution = opts.resolution ?? "720P";
  if (
    !Number.isInteger(duration) ||
    !SUPPORTED_VIDEO_DURATIONS.includes(duration as (typeof SUPPORTED_VIDEO_DURATIONS)[number])
  ) {
    throw new KieGatewayError(400, "Video duration must be 4, 6, or 8 seconds.", "request");
  }
  if (!opts.prompt.trim()) {
    throw new KieGatewayError(400, "A video prompt is required.", "request");
  }

  const model = KIE_VIDEO_MODEL?.trim() || "veo-3-1";
  if (!model) {
    throw new KieGatewayError(
      503,
      "Kie video generation is not configured. Set KIE_VIDEO_MODEL on the server.",
      "configuration",
    );
  }
  // The most expensive call in the product: quota + spend ceiling apply.
  await enforceBudget("video");
  const started = Date.now();
  try {
    const video = await runVideoTask(model, opts.prompt, {
      aspectRatio,
      duration,
      resolution,
      audio: opts.audio,
      seed: opts.seed,
    });
    recordUsage({
      provider: "kie",
      model,
      kind: "video",
      units: 1,
      estCostUsd: unitPrice("kie:video"),
      latencyMs: Date.now() - started,
    });
    return video;
  } catch (error) {
    recordUsage({
      provider: "kie",
      model,
      kind: "video",
      status: "error",
      latencyMs: Date.now() - started,
    });
    throw error;
  }
}

async function runVideoTask(
  model: string,
  prompt: string,
  opts: {
    aspectRatio: ReturnType<typeof normalizeKieAspectRatio>;
    duration: number;
    resolution: VideoResolution;
    audio?: boolean;
    seed?: number;
  },
): Promise<GeneratedVideo> {
  const { aspectRatio, duration, resolution } = opts;
  const json = await fetchJson(
    `${KIE_BASE}/jobs/createTask`,
    {
      method: "POST",
      headers: headers(getApiKey()),
      body: JSON.stringify({
        model,
        input: {
          prompt: prompt.slice(0, 20_000),
          resolution,
          aspect_ratio: aspectRatio,
          duration,
          audio: opts.audio ?? true,
          seed: opts.seed ?? 0,
          nsfw_checker: true,
        },
      }),
    },
    30_000,
  );
  const taskId = json?.data?.taskId ?? json?.data?.task_id ?? json?.taskId ?? json?.task_id;
  if (typeof taskId !== "string" || !taskId) {
    throw new KieGatewayError(502, "The video provider did not return a task ID.", "response");
  }

  const deadline = Date.now() + TASK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const statusJson = await fetchJson(
      `${KIE_BASE}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
      { headers: headers(getApiKey()) },
      30_000,
    );
    const record = statusJson?.data ?? statusJson;
    const state = String(record?.state ?? record?.status ?? record?.taskStatus ?? "").toLowerCase();
    if (["fail", "failed", "error", "cancelled"].includes(state)) {
      throw new KieGatewayError(502, "Kie.ai failed to generate the video.", "generation");
    }
    if (["success", "completed", "succeeded"].includes(state)) {
      const urls = resultUrls(record);
      const videoUrl = urls.find((url) => /\.(mp4|webm|mov)(?:\?|$)/i.test(url)) ?? urls[0];
      if (!videoUrl || !/^https:\/\//i.test(videoUrl)) {
        throw new KieGatewayError(502, "Kie.ai returned no usable video result.", "response");
      }
      const thumbnailUrl = urls.find((url) => /\.(png|jpe?g|webp)(?:\?|$)/i.test(url));
      return {
        type: "video",
        provider: "kie",
        generationId: taskId,
        videoUrl,
        thumbnailUrl,
        duration,
        aspectRatio,
        model,
        status: "completed",
        metadata: { resolution, audio: opts.audio ?? true },
      };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new KieGatewayError(504, "Video generation took too long and timed out.", "timeout");
}
