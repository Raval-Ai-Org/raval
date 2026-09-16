// Kie.ai implementation of VideoProvider. Builds the exact Market API input for
// each registry family (confirmed by live validation, see src/lib/ugc/models.ts)
// and maps Kie's task records and errors to provider-neutral results. All HTTP
// goes through src/lib/kie-gateway.server.ts.
import "server-only";
import {
  createKieTask,
  getKieTask,
  KieGatewayError,
  pickVideoUrl,
} from "@/lib/kie-gateway.server";
import type { UgcModel } from "@/lib/ugc/models";
import { log } from "@/server/observability/logger";
import { kieUsdPerCredit } from "../models.server";
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

/** The Kie `input` object for a render. Exported for tests. */
export function buildKieInput(req: VideoRenderRequest): Record<string, unknown> {
  const { model } = req;
  const images = model.images ? req.imageUrls.slice(0, model.images.max) : [];
  if (model.family === "veo") {
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
  }
  return {
    prompt: req.prompt,
    ...(images.length ? { reference_image_urls: images } : {}),
    aspect_ratio: req.aspectRatio,
    resolution: req.resolution,
    duration: req.durationSec,
    generate_audio: model.nativeAudio,
    web_search: false,
  };
}

/** Map a gateway error to a failure the user can act on. Exported for tests. */
export function kieFailure(error: unknown): ProviderFailure {
  if (error instanceof KieGatewayError) {
    if (error.providerCode === 402) {
      return {
        code: "provider_credits",
        message: "The video provider account is out of credits. Please try again later.",
        retryable: false,
      };
    }
    if (error.providerCode === 455) {
      return {
        code: "provider_maintenance",
        message: "The video provider is under maintenance. Retrying shortly.",
        retryable: true,
      };
    }
    if (error.category === "configuration" || error.category === "authentication") {
      return {
        code: "provider_configuration",
        message: "Video generation isn't configured on the server. Contact your workspace admin.",
        retryable: false,
      };
    }
    if (RETRYABLE_CATEGORIES.has(error.category)) {
      return { code: `provider_${error.category}`, message: error.message, retryable: true };
    }
    return { code: "provider_rejected", message: error.message.slice(0, 300), retryable: false };
  }
  return { code: "provider_error", message: "The video provider could not be reached.", retryable: true };
}

export const kieVideoProvider: VideoProvider = {
  id: "kie",

  generationType: kieGenerationType,

  async submit(req: VideoRenderRequest): Promise<SubmitResult> {
    const input = buildKieInput(req);
    try {
      const { taskId } = await createKieTask({
        model: req.model.providerModel,
        input,
        callBackUrl: req.callbackUrl,
      });
      const { prompt: _prompt, image_urls: _i, reference_image_urls: _r, ...request } = input;
      return { ok: true, taskId, request: { model: req.model.providerModel, ...request } };
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
    if (record.state === "pending") return { state: "pending", providerState: record.providerState };
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
      meta,
    };
  },
};

function friendlyFailure(message: string | null): string {
  if (!message) return "The provider couldn't render this video.";
  if (/flagged|policy|violat|sensitive|nsfw|minor|prominent people/i.test(message)) {
    return `The provider's safety filter blocked this video (${message.slice(0, 160)}). Try rewording the script or using a different product photo.`;
  }
  return message.slice(0, 300);
}
