// Kie.ai implementation of VideoProvider. TEMPORARY — KIE is being dropped;
// deleting this file (plus kie-gateway.server.ts, the KIE webhook route and
// the KIE_* env vars) removes it. Builds the exact Market API input for each
// registry family (request shapes confirmed against docs.kie.ai, see
// src/lib/ugc/models.ts) and maps Kie's task records and errors to
// provider-neutral results. All HTTP goes through src/lib/kie-gateway.server.ts.
import "server-only";
import { createKieTask, getKieTask, KieGatewayError, pickVideoUrl } from "@/lib/kie-gateway.server";
import { providerSpec, type UgcModel } from "@/lib/ugc/models";
import { checkVideoResult } from "@/lib/ugc/quality";
import { log } from "@/server/observability/logger";
import { kieUsdPerCredit } from "../models.server";
import { friendlyFailure } from "./failure";
import type {
  ProviderCheck,
  ProviderFailure,
  SubmitResult,
  VideoProvider,
  VideoRenderRequest,
} from "./types";

const RETRYABLE_CATEGORIES = new Set(["rate_limit", "provider", "network", "timeout"]);

export function kieGenerationType(model: UgcModel, imageCount: number): string {
  if (model.family === "seedance") return imageCount > 0 ? "REFERENCE_IMAGES" : "TEXT";
  if (imageCount === 0 || !model.images) return "TEXT_2_VIDEO";
  return model.images.mode === "references" ? "REFERENCE_2_VIDEO" : "FIRST_AND_LAST_FRAMES_2_VIDEO";
}

/** The Kie model id for a render (MiniMax H3 has one id per input kind). */
export function kieModelId(model: UgcModel, imageCount: number): string {
  const spec = providerSpec(model, "kie");
  if (!spec) throw new Error(`${model.key} has no KIE model`);
  if (imageCount === 0 && spec.textModel) return spec.textModel;
  return spec.model;
}

/** Kie's MiniMax resolutions are upper-case tiers. */
const MINIMAX_RESOLUTION: Record<string, string> = { "768p": "768P", "2k": "2K", "1080p": "2K" };

/** The Kie `input` object for a render. Exported for tests. */
export function buildKieInput(req: VideoRenderRequest): Record<string, unknown> {
  const { model } = req;
  const images = model.images ? req.imageUrls.slice(0, model.images.max) : [];
  const audio = req.audio ?? model.nativeAudio;
  switch (model.family) {
    case "veo":
      return {
        prompt: req.prompt,
        ...(model.providerVariant ? { model: model.providerVariant } : {}),
        generation_type: kieGenerationType(model, images.length),
        ...(images.length ? { image_urls: images } : {}),
        aspect_ratio: req.aspectRatio,
        resolution: req.resolution,
        duration: req.durationSec,
        // Dialogue is written in the chosen language; translating it would change the words spoken.
        enable_translation: false,
      };
    case "gemini":
      // Gemini Omni 1.1 Flash: up to 7 quota units (1 per image); duration is
      // a string enum; a first frame can't be combined with references, so
      // product photos always go in as references.
      return {
        prompt: req.prompt.slice(0, 20_000),
        ...(images.length ? { image_urls: images.slice(0, 7) } : {}),
        duration: String(req.durationSec),
        aspect_ratio: req.aspectRatio,
        resolution: req.resolution,
      };
    case "minimax":
      return {
        prompt: req.prompt.slice(0, 7_000),
        ...(images.length ? { reference_image_urls: images.slice(0, 9) } : {}),
        aspect_ratio: req.aspectRatio,
        resolution: MINIMAX_RESOLUTION[req.resolution] ?? "768P",
        duration: req.durationSec,
      };
    default:
      return {
        prompt: req.prompt,
        ...(images.length ? { reference_image_urls: images } : {}),
        aspect_ratio: req.aspectRatio,
        resolution: req.resolution,
        duration: req.durationSec,
        generate_audio: audio,
        web_search: false,
      };
  }
}

const MODEL_UNAVAILABLE_RE =
  /model.*(not (found|exist|available|supported)|unavailable|offline|disabled)/i;

/** Map a gateway error to a failure the user can act on. Exported for tests. */
export function kieFailure(error: unknown): ProviderFailure {
  if (error instanceof KieGatewayError) {
    if (error.providerCode === 402 || /credit|balance|insufficient/i.test(error.message)) {
      return {
        code: "provider_credits",
        message: "The video provider account is out of credits. Please try again later.",
        retryable: false,
        definite: true,
      };
    }
    if (error.providerCode === 455) {
      return {
        code: "provider_maintenance",
        message: "The video provider is under maintenance. Retrying shortly.",
        retryable: true,
        definite: true,
      };
    }
    if (error.category === "configuration" || error.category === "authentication") {
      return {
        code: "provider_configuration",
        message: "Video generation isn't configured on the server. Contact your workspace admin.",
        retryable: false,
        definite: true,
      };
    }
    if (error.category === "request" && MODEL_UNAVAILABLE_RE.test(error.message)) {
      return {
        code: "provider_model_unavailable",
        message: "This video model is unavailable at the provider right now.",
        retryable: false,
        definite: true,
      };
    }
    if (error.category === "rate_limit") {
      return {
        code: "provider_rate_limit",
        message: error.message,
        retryable: true,
        definite: true,
      };
    }
    if (RETRYABLE_CATEGORIES.has(error.category)) {
      // A timeout or dropped connection is an unknown outcome: Kie may have
      // accepted the task, so it is never handed to another provider.
      return { code: `provider_${error.category}`, message: error.message, retryable: true };
    }
    return {
      code: "provider_rejected",
      message: error.message.slice(0, 300),
      retryable: false,
      definite: true,
    };
  }
  return {
    code: "provider_error",
    message: "The video provider could not be reached.",
    retryable: true,
  };
}

export const kieVideoProvider: VideoProvider = {
  id: "kie",

  generationType: kieGenerationType,

  async submit(req: VideoRenderRequest): Promise<SubmitResult> {
    let input: Record<string, unknown>;
    let providerModel: string;
    try {
      input = buildKieInput(req);
      providerModel = kieModelId(req.model, req.imageUrls.length);
    } catch (error) {
      return {
        ok: false,
        code: "provider_model_unavailable",
        message: error instanceof Error ? error.message : "No KIE model for this render.",
        retryable: false,
        definite: true,
      };
    }
    try {
      const { taskId } = await createKieTask({
        model: providerModel,
        input,
        callBackUrl: req.callbackUrl,
      });
      const { prompt: _prompt, image_urls: _i, reference_image_urls: _r, ...request } = input;
      return {
        ok: true,
        taskId,
        request: { model: providerModel, ...request },
        provider: "kie",
        providerModel,
      };
    } catch (error) {
      const failure = kieFailure(error);
      log.warn("ugc.kie.submit_failed", { model: req.model.key, ...failure });
      return { ok: false, ...failure };
    }
  },

  async check(taskId: string): Promise<ProviderCheck> {
    const record = await getKieTask(taskId);
    const meta: Record<string, unknown> = {
      providerState: record.providerState,
      creditsConsumed: record.creditsConsumed,
      costTimeMs: record.costTimeMs,
    };
    if (record.state === "pending")
      return { state: "pending", providerState: record.providerState };
    if (record.state === "failed") {
      return {
        state: "failed",
        providerState: record.providerState,
        meta: { ...meta, failCode: record.failCode },
        code: "render_failed",
        message: friendlyFailure(record.failMessage),
        retryable: false,
      };
    }
    const { videoUrl, thumbnailUrl } = pickVideoUrl(record.urls);
    if (!videoUrl || !/^https:\/\//i.test(videoUrl)) {
      return {
        state: "failed",
        providerState: record.providerState,
        meta,
        code: "no_result",
        message: "The provider finished without a video. Your allowance was returned.",
        retryable: false,
      };
    }
    return {
      state: "success",
      providerState: record.providerState,
      videoUrl,
      thumbnailUrl,
      costUsd:
        record.creditsConsumed != null
          ? Math.round(record.creditsConsumed * kieUsdPerCredit() * 1_000_000) / 1_000_000
          : null,
      meta: { ...meta, qualityCheck: checkVideoResult(videoUrl) },
    };
  },
};
