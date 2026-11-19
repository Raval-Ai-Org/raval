// openrouter-image.server.ts — image generation and editing on OpenRouter's
// Images API (POST /api/v1/images, confirmed 2026-09-25: synchronous, returns
// base64 in data[].b64_json with usage.cost).
//
// Pipeline: route a model (model-router.server.ts: Recraft V4.1 for plain
// pictures, GPT Image 2.5 Flare for references and edits, Sunburst for premium) → image budget → per-tenant cache
// and in-flight dedupe → OpenRouter → metering from usage.cost.
//
// Two entry points:
//   imageGenerationStream  holds the request open and answers as SSE
//                          (/api/generate-image; the browser contract is the
//                          same one the KIE gateway used).
//   startImageTask /       Studio jobs. The provider answers synchronously, so
//   checkImageTask         the task runs after the response (next/server
//                          after()) and parks its result in the shared cache;
//                          each Studio poll reads it. Job leases, idempotency
//                          keys and persistAsset stay exactly as they were.
import "server-only";
import {
  assertSafeMediaPrompt,
  assertSafeMediaImages,
  MediaSafetyError,
} from "@/server/guardrails/media-safety.server";
import { randomUUID } from "node:crypto";
import { normalizeReferenceImages } from "./image-reference.server";
import { fetchWithRetry, upstreamDetail } from "@/server/upstream";
import { cache, digest, recordCacheLookup } from "@/server/cache/store";
import { enforceBudget } from "@/server/ai/budget";
import { recordUsage } from "@/server/ai/metering";
import { round6, unitPrice } from "@/server/ai/pricing";
import { getRequestScope } from "@/server/request-context";
import { log } from "@/server/observability/logger";
import { markImageFundsOut } from "@/server/ai/image-funds.server";
import {
  AiGatewayError,
  getOpenRouterKey,
  mapOpenRouterError,
  OPENROUTER_BASE,
  openRouterHeaders,
} from "./ai-gateway.server";
import {
  isRecraftModel,
  routeImageModel,
  routeStandardImageModel,
  type ImageRoutingInput,
} from "./model-router.server";

/** Studio's image sizes, and the legacy /api/generate-image sizes. */
export type ImageSize = "1024x1024" | "1024x1280" | "1792x1024" | "1024x1792" | "1024x1536";
export type ImageQuality = "low" | "medium" | "high";

const IMAGE_TIMEOUT_MS = 150_000;
/** Generated-image cache (shared cache, per tenant). */
const IMAGE_CACHE_TTL_SECONDS = 2 * 60 * 60;
/** A Studio task's parked result lives this long (the job times out at 10 min). */
const TASK_TTL_SECONDS = 30 * 60;
const MAX_REFERENCES = 4;
/** A returned image larger than this is refused rather than stored. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const inflight = new Map<string, Promise<GeneratedImage>>();

export type ImageGenerationMetadata = {
  creativeBriefVersion?: string;
  brandDnaVersion?: string;
  promptVersion?: string;
  attempt?: number;
  seed?: string;
  referenceAssets?: string[];
};

export type GeneratedImage = { b64: string; mimeType: string; model: string; costUsd: number };

/**
 * The GPT Image 2.5 models take 1:1, 16:9, 9:16, 3:4 (and others) but not
 * 4:5, so Studio's 4:5 portrait (1024x1280) renders as 3:4, the closest
 * supported portrait ratio. A Pin (1024x1536) is the models' native 2:3.
 */
export function aspectRatioFor(
  size: ImageSize,
  model = "",
): "1:1" | "16:9" | "9:16" | "3:4" | "4:5" | "2:3" {
  if (size === "1792x1024") return "16:9";
  if (size === "1024x1792") return "9:16";
  // Recraft draws Studio's 4:5 portrait natively.
  if (size === "1024x1280") return isRecraftModel(model) ? "4:5" : "3:4";
  if (size === "1024x1536") return "2:3";
  return "1:1";
}

function usableReferences(refs: string[] | undefined): string[] {
  return (refs ?? [])
    .filter((u) => typeof u === "string" && /^(https:\/\/|data:image\/)/i.test(u))
    .slice(0, MAX_REFERENCES);
}

/** Recraft V4.1's list price per picture (OpenRouter, 2026-11-19). */
const RECRAFT_PRICE_USD = 0.035;

function fallbackPrice(model: string): number {
  if (isRecraftModel(model)) return RECRAFT_PRICE_USD;
  return unitPrice(
    /sunburst|premium/i.test(model) ? "openrouter:image:premium" : "openrouter:image",
  );
}

/** Codes where another model would fail the same way: stop instead of spending again. */
const TERMINAL_CODES = new Set([
  "missing_api_key",
  "invalid_api_key",
  "insufficient_credits",
  "invalid_request",
  "refusal",
]);

/**
 * Recraft is on test: a request it refuses (an unlisted field, a prompt it
 * won't take) goes on to Flare instead of failing the piece. Missing keys and
 * credits stay terminal for every model.
 */
function isTerminal(error: unknown, model: string): boolean {
  if (!(error instanceof AiGatewayError)) return false;
  const code = error.code ?? "";
  if (isRecraftModel(model))
    return (
      code === "missing_api_key" || code === "invalid_api_key" || code === "insufficient_credits"
    );
  return TERMINAL_CODES.has(code);
}

/** One Images API call. Exported for tests via setImageTransport. */
export type ImageRequest = {
  model: string;
  prompt: string;
  aspectRatio: string;
  quality: ImageQuality;
  references: string[];
  /** "transparent" only for a design layer laid over real photos. */
  background?: "opaque" | "transparent";
};

export type ImageTransport = (req: ImageRequest) => Promise<GeneratedImage>;

/**
 * Recraft refuses fields it doesn't list (quality, background, resolution,
 * output_format) and takes at most one reference, so it gets only these.
 */
function recraftBody(req: ImageRequest): Record<string, unknown> {
  return {
    model: req.model,
    prompt: req.prompt.slice(0, 10_000),
    aspect_ratio: req.aspectRatio,
    n: 1,
  };
}

/** Whether a model can do this request at all (Recraft: no transparency, no references). */
export function modelCanServe(
  model: string,
  req: { references: string[]; background?: "opaque" | "transparent" },
): boolean {
  if (!isRecraftModel(model)) return true;
  return req.references.length === 0 && req.background !== "transparent";
}

async function openRouterImage(req: ImageRequest): Promise<GeneratedImage> {
  if (isRecraftModel(req.model)) return sendImageBody(req, recraftBody(req));
  const body: Record<string, unknown> = {
    model: req.model,
    prompt: req.prompt.slice(0, 10_000),
    aspect_ratio: req.aspectRatio,
    quality: req.quality,
    resolution: "1K",
    background: req.background ?? "opaque",
    output_format: "png",
    n: 1,
  };
  if (req.references.length) {
    // Any size, orientation or format a person uploaded is made readable
    // first (upright, ≤2048 px, JPEG/PNG), so a photo never fails the render.
    const readable = await normalizeReferenceImages(req.references);
    body.input_references = readable.map((url) => ({
      type: "image_url",
      image_url: { url },
    }));
  }
  return sendImageBody(req, body);
}

async function sendImageBody(
  req: ImageRequest,
  body: Record<string, unknown>,
): Promise<GeneratedImage> {
  const res = await fetchWithRetry(
    `${OPENROUTER_BASE}/images`,
    { method: "POST", headers: openRouterHeaders(getOpenRouterKey()), body: JSON.stringify(body) },
    {
      timeoutMs: IMAGE_TIMEOUT_MS,
      retries: 1,
      // A timed-out image may already be billed.
      retryOnTimeout: false,
      retryableStatuses: [429, 502, 503, 529],
      onTransportError: ({ kind, detail }) =>
        kind === "timeout"
          ? new AiGatewayError(504, "Image generation timed out. Please retry.", "timeout")
          : new AiGatewayError(
              502,
              `Network error contacting the image provider: ${detail}`,
              "network_error",
            ),
    },
  );
  if (!res.ok) throw mapOpenRouterError(res.status, await res.text().catch(() => ""));
  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new AiGatewayError(
      502,
      "The image provider returned malformed JSON.",
      "malformed_response",
    );
  }
  const image = json?.data?.[0];
  const b64 = typeof image?.b64_json === "string" ? image.b64_json : "";
  if (!b64)
    throw new AiGatewayError(502, "The image provider returned no image.", "empty_response");
  if (Math.floor((b64.length * 3) / 4) > MAX_IMAGE_BYTES) {
    throw new AiGatewayError(502, "The generated image is too large to accept.", "too_large");
  }
  const cost = Number(json?.usage?.cost);
  return {
    b64,
    mimeType: typeof image?.media_type === "string" ? image.media_type : "image/png",
    model: req.model,
    costUsd: Number.isFinite(cost) ? round6(cost) : fallbackPrice(req.model),
  };
}

let transportOverride: ImageTransport | null = null;

/** Tests: route image requests to a fake. Returns a restore function. */
export function setImageTransport(t: ImageTransport | null): () => void {
  const previous = transportOverride;
  transportOverride = t;
  return () => {
    transportOverride = previous;
  };
}

function tenant(): string {
  const scope = getRequestScope();
  return scope.workspaceId
    ? `ws:${scope.workspaceId}`
    : scope.userId
      ? `u:${scope.userId}`
      : "anon";
}

export type GenerateImageOpts = {
  prompt: string;
  size?: ImageSize;
  routing?: Omit<ImageRoutingInput, "prompt">;
  /** Force one model (a Studio fallback restart). */
  model?: string;
  maxAttempts?: number;
  /** Skip the budget check (a restart of an already-budgeted task). */
  budgeted?: boolean;
  background?: "opaque" | "transparent";
  /**
   * The image's own metering label (`studio.image.render`, `.rerender`,
   * `.version`, …), so spend per kind of picture can be read from
   * ai_usage_events. Defaults to the request scope's route.
   */
  meterRoute?: ImageMeterRoute;
  /** Overrides the quality the routing would pick (e.g. "low" for a no-words backdrop). */
  quality?: ImageQuality;
};

/** Metering labels for images (listed in NON_MODEL_ROUTES: no text model plan). */
export type ImageMeterRoute =
  | "studio.image.render"
  | "studio.image.rerender"
  | "studio.image.version"
  | "studio.image.backdrop"
  | "studio.image.slide"
  | "studio.image.edit"
  | "studio.image.cutout"
  | "studio.image.design"
  | "studio.image.storyboard"
  | "studio.image.reframe";

export type GenerateImageResult = GeneratedImage & {
  route: string;
  attempt: number;
  cached: boolean;
};

/**
 * Route, budget, cache and generate one image, falling back along the plan.
 * Every attempt is metered against the model that ran it.
 */
export async function generateImage(opts: GenerateImageOpts): Promise<GenerateImageResult> {
  const size = opts.size ?? "1024x1024";
  const references = usableReferences(opts.routing?.referenceAssets);
  await assertSafeMediaPrompt(opts.prompt);
  await assertSafeMediaImages(references, { stage: "source" });
  const requiresReference = Boolean(
    opts.routing?.hasReference ||
    opts.routing?.editing ||
    opts.routing?.taskType === "reference" ||
    opts.routing?.taskType === "editing",
  );
  if (requiresReference && references.length === 0) {
    throw new AiGatewayError(
      422,
      "Image-to-image generation requires at least one HTTPS reference image.",
      "invalid_request",
    );
  }
  const plan = routeImageModel({
    prompt: opts.prompt,
    ...opts.routing,
    referenceAssets: references,
    hasReference: references.length > 0,
    transparent: opts.background === "transparent",
  });
  const quality: ImageQuality =
    opts.quality ??
    (opts.routing?.requiredQuality === "maximum" || opts.routing?.requiredQuality === "high"
      ? "high"
      : "medium");
  const route = opts.meterRoute;
  // Billed per image: the workspace's monthly image quota and spend ceiling apply.
  if (!opts.budgeted) await enforceBudget("image");

  const candidates = (opts.model ? [opts.model] : [plan.model, ...plan.fallbacks])
    .filter((model) => modelCanServe(model, { references, background: opts.background }))
    .slice(0, Math.max(1, Math.min(3, opts.maxAttempts ?? 3)));
  const send = transportOverride ?? openRouterImage;
  let lastError: unknown;
  let attempt = 0;
  for (const model of candidates) {
    attempt += 1;
    const aspectRatio = aspectRatioFor(size, model);
    const key = `or:img:${await digest(
      `${tenant()}|${model}|${aspectRatio}|${quality}|${opts.background ?? "opaque"}|${references.join(",")}|${opts.prompt}`,
    )}`;
    const hit = await cache.get<GeneratedImage>(key);
    recordCacheLookup("image", Boolean(hit));
    if (hit) {
      await assertSafeMediaImages([`data:${hit.mimeType};base64,${hit.b64}`], { stage: "output" });
      recordUsage({
        provider: "openrouter",
        model,
        kind: "image",
        route,
        cached: true,
        savedUsd: hit.costUsd,
      });
      return { ...hit, route: plan.route, attempt, cached: true };
    }
    try {
      let pending = inflight.get(key);
      if (!pending) {
        pending = (async () => {
          const started = Date.now();
          try {
            const image = await send({
              model,
              prompt: opts.prompt,
              aspectRatio,
              quality,
              references,
              background: opts.background,
            });
            recordUsage({
              provider: "openrouter",
              model,
              kind: "image",
              route,
              units: 1,
              estCostUsd: image.costUsd,
              latencyMs: Date.now() - started,
            });
            await assertSafeMediaImages([`data:${image.mimeType};base64,${image.b64}`], {
              stage: "output",
            });
            await cache.set(key, image, IMAGE_CACHE_TTL_SECONDS);
            return image;
          } catch (error) {
            recordUsage({
              provider: "openrouter",
              model,
              kind: "image",
              route,
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
      const image = await pending;
      return { ...image, route: plan.route, attempt, cached: false };
    } catch (error) {
      if (error instanceof MediaSafetyError) throw error;
      lastError = error;
      log.warn("openrouter.image.failed", {
        model,
        attempt,
        code: error instanceof AiGatewayError ? error.code : undefined,
        message: upstreamDetail(error),
      });
      if (error instanceof AiGatewayError && error.code === "insufficient_credits")
        await markImageFundsOut();
      if (isTerminal(error, model)) throw error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new AiGatewayError(502, "No image model completed the request.", "provider_error");
}

/** /api/generate-image: one SSE `image_generation.completed` event, as before. */
export async function imageGenerationStream(opts: {
  prompt: string;
  size?: "1024x1024" | "1792x1024" | "1024x1792";
  routing?: Omit<ImageRoutingInput, "prompt">;
  metadata?: ImageGenerationMetadata;
  maxAttempts?: number;
}): Promise<Response> {
  const image = await generateImage({
    prompt: opts.prompt,
    size: opts.size,
    routing: opts.routing,
    maxAttempts: opts.maxAttempts,
  });
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
      "X-Creative-Model": image.model,
      "X-Creative-Route": image.route,
      "X-Creative-Attempt": String(image.attempt),
      "X-Creative-Prompt-Version": opts.metadata?.promptVersion ?? "1",
      "X-Creative-Brief-Version": opts.metadata?.creativeBriefVersion ?? "1",
    },
  });
}

/* ───────────────────────────── Studio tasks ───────────────────────────── */

export const IMAGE_TASK_PREFIX = "or-img:";

export type StartedImageTask = {
  taskId: string;
  model: string;
  route: string;
  fallbacks: string[];
};

type ParkedResult =
  | { state: "success"; b64: string; mimeType: string; model: string; costUsd: number }
  | { state: "failed"; message: string; model: string; code?: string; retryable?: boolean };

export type ImageTaskCheck =
  | { state: "pending" }
  | { state: "success"; dataUrl: string; model: string; costUsd: number }
  | { state: "failed"; message: string; code?: string; retryable?: boolean };

const taskKey = (taskId: string) => `studio:image-task:${taskId}`;

/** Run after the response when a request scope exists, else detached. */
async function inBackground(work: () => Promise<void>): Promise<void> {
  try {
    const { after } = await import("next/server");
    after(work);
  } catch {
    void work();
  }
}

/**
 * Route a model, enforce the image budget and start one image in the
 * background. The returned task id is checked with checkImageTask. Passing
 * `model` restarts a failed task on that fallback (already budgeted).
 */
export async function startImageTask(opts: {
  costTier?: "standard";
  prompt: string;
  size: ImageSize;
  referenceAssets?: string[];
  model?: string;
  background?: "opaque" | "transparent";
  meterRoute?: ImageMeterRoute;
  quality?: ImageQuality;
}): Promise<StartedImageTask> {
  const references = usableReferences(opts.referenceAssets);
  const plan = (opts.costTier === "standard" ? routeStandardImageModel : routeImageModel)({
    prompt: opts.prompt,
    hasReference: references.length > 0,
    referenceAssets: references,
    editing: references.length > 0,
    transparent: opts.background === "transparent",
  });
  await enforceBudget("image");
  // Fail fast when the key is missing instead of parking a doomed task.
  getOpenRouterKey();
  // A restart on a model that can't do this job (Recraft with a reference or
  // a transparent layer) runs on the plan's own model instead.
  const model =
    opts.model && modelCanServe(opts.model, { references, background: opts.background })
      ? opts.model
      : plan.model;
  const taskId = `${IMAGE_TASK_PREFIX}${randomUUID()}`;
  const scope = getRequestScope();
  await inBackground(async () => {
    const { runWithScope } = await import("@/server/request-context");
    await runWithScope(scope, async () => {
      let parked: ParkedResult;
      try {
        // One model per task: a failure goes back to the poll, which restarts
        // on the next fallback and keeps the job's idempotency per task id.
        const image = await generateImage({
          prompt: opts.prompt,
          size: opts.size,
          routing: { referenceAssets: references, hasReference: references.length > 0 },
          model,
          maxAttempts: 1,
          budgeted: true,
          background: opts.background,
          meterRoute: opts.meterRoute,
          quality: opts.quality,
        });
        parked = {
          state: "success",
          b64: image.b64,
          mimeType: image.mimeType,
          model,
          costUsd: image.costUsd,
        };
      } catch (error) {
        log.warn("openrouter.studio.image.failed", {
          taskId,
          model,
          code:
            error instanceof AiGatewayError || error instanceof MediaSafetyError
              ? error.code
              : undefined,
          message: upstreamDetail(error),
        });
        parked = {
          state: "failed",
          model,
          ...(error instanceof MediaSafetyError
            ? { code: error.code, retryable: error.code === "safety_unavailable" }
            : error instanceof AiGatewayError
              ? { code: error.code, retryable: !isTerminal(error, model) }
              : {}),
          message:
            error instanceof AiGatewayError || error instanceof MediaSafetyError
              ? error.message.slice(0, 300)
              : "The picture couldn't be made this time. Please try again.",
        };
      }
      await cache.set(taskKey(taskId), parked, TASK_TTL_SECONDS);
    });
  });
  log.info("openrouter.studio.image.started", { model, taskId, references: references.length });
  return {
    taskId,
    model,
    route: plan.route,
    fallbacks: [plan.model, ...plan.fallbacks].filter((m) => m !== model),
  };
}

export function isImageTask(taskId: string): boolean {
  return taskId.startsWith(IMAGE_TASK_PREFIX);
}

/** One read of a Studio image task — never waits. */
export async function checkImageTask(taskId: string): Promise<ImageTaskCheck> {
  const parked = await cache.get<ParkedResult>(taskKey(taskId));
  if (!parked) return { state: "pending" };
  if (parked.state === "failed")
    return {
      state: "failed",
      message: parked.message,
      code: parked.code,
      retryable: parked.retryable,
    };
  return {
    state: "success",
    dataUrl: `data:${parked.mimeType};base64,${parked.b64}`,
    model: parked.model,
    costUsd: parked.costUsd,
  };
}
