// The video provider every render uses: the configured primary
// (VIDEO_PROVIDER, default kie) with an automatic fallback
// (VIDEO_PROVIDER_FALLBACK, default openrouter).
//
// Fallback rule — never pay twice: a job moves to the fallback only when the
// primary *definitely* refused it for a reason another provider can fix: out
// of credits, not configured (auth), or the model unavailable. A validation
// rejection or rate limit stays on the primary. An unknown outcome — a timeout or dropped
// connection on submit — may mean the primary accepted the job, so it is
// retried on the primary later instead of being submitted elsewhere.
//
// The job records which provider accepted it (provider/provider_model on the
// render row, `provider` on a Studio task); status checks and downloads go to
// that provider.
import "server-only";
import { assertSafeVideo } from "@/server/guardrails/video-safety.server";
import {
  assertSafeMediaPrompt,
  assertSafeMediaImages,
  clearedMediaImages,
  MediaSafetyError,
} from "@/server/guardrails/media-safety.server";
import {
  coerceRenderSettings,
  specFor,
  usableImageCount,
  type UgcModel,
  type VideoProviderId,
} from "@/lib/ugc/models";
import { log } from "@/server/observability/logger";
import { videoFallbackProvider, videoProvider } from "../models.server";
import { kieVideoProvider } from "./kie.server";
import { openRouterVideoProvider } from "./openrouter.server";
import type { ProviderCheck, SubmitResult, VideoProvider, VideoRenderRequest } from "./types";
import { withVideoComposition } from "./composition.server";

/** The only refusals that move a job to the fallback provider. */
const FALLBACK_CODES = new Set([
  "provider_credits",
  "provider_configuration",
  "provider_model_unavailable",
]);

const PROVIDERS: Record<VideoProviderId, VideoProvider> = {
  kie: kieVideoProvider,
  openrouter: openRouterVideoProvider,
};

export type RoutedProviderDeps = {
  providers?: Partial<Record<VideoProviderId, VideoProvider>>;
  primary?: () => VideoProviderId;
  fallback?: (primary?: VideoProviderId) => VideoProviderId | null;
};

/** Adapt a request to another provider's view of the same model (nearest valid settings). */
function requestFor(req: VideoRenderRequest, provider: VideoProviderId): VideoRenderRequest | null {
  const model: UgcModel | null = specFor(req.model, provider);
  if (!model) return null;
  if (
    usableImageCount(model, req.imageUrls.length) <
    (req.requiredReferenceCount ?? (req.requireReferences ? 1 : 0))
  )
    return null;
  const settings = coerceRenderSettings(model, {
    model: model.key,
    durationSec: req.durationSec,
    aspectRatio: req.aspectRatio,
    resolution: req.resolution,
    imageCount: req.imageUrls.length,
  });
  if (settings.durationSec < (req.minimumDurationSec ?? 0)) return null;
  return {
    ...req,
    model,
    durationSec: settings.durationSec,
    aspectRatio: settings.aspectRatio,
    resolution: settings.resolution,
    imageUrls: req.imageUrls.slice(0, usableImageCount(model, req.imageUrls.length)),
  };
}

/** The request without the style references that were left out. */
function withImages(req: VideoRenderRequest, own: string[], style: string[]): VideoRenderRequest {
  const imageUrls = [...own, ...style];
  const required = Math.min(
    req.requiredReferenceCount ?? (req.requireReferences ? 1 : 0),
    imageUrls.length,
  );
  return {
    ...req,
    imageUrls,
    styleReferenceCount: style.length,
    requireReferences: Boolean(req.requireReferences && imageUrls.length),
    requiredReferenceCount: required || undefined,
  };
}

export function createRoutedVideoProvider(deps: RoutedProviderDeps = {}): VideoProvider {
  const providers = { ...PROVIDERS, ...deps.providers };
  const primary = deps.primary ?? videoProvider;
  const fallback = deps.fallback ?? videoFallbackProvider;
  const pick = (id?: string): VideoProvider =>
    providers[
      (id === "openrouter" ? "openrouter" : id === "kie" ? "kie" : primary()) as VideoProviderId
    ];

  return {
    id: "routed",

    generationType(model, imageCount) {
      return pick(model.provider).generationType(model, imageCount);
    },

    async submit(request: VideoRenderRequest): Promise<SubmitResult> {
      let req = request;
      try {
        await assertSafeMediaPrompt(req.prompt);
        const style = Math.min(req.styleReferenceCount ?? 0, req.imageUrls.length);
        const own = req.imageUrls.slice(0, req.imageUrls.length - style);
        await assertSafeMediaImages(own);
        if (style) {
          // Brand style references the person did not pick: one that is not
          // cleared is left out, never a reason to fail their render.
          const kept = await clearedMediaImages(req.imageUrls.slice(own.length));
          if (kept.length < style) req = withImages(req, own, kept);
        }
      } catch (error) {
        if (!(error instanceof MediaSafetyError)) throw error;
        return {
          ok: false,
          code: error.code,
          message: error.message,
          retryable: error.code === "safety_unavailable",
          definite: true,
        };
      }
      const first = deps.primary ? primary() : req.model.provider;
      const firstReq = requestFor(req, first);
      let result: SubmitResult | null = firstReq ? await providers[first].submit(firstReq) : null;
      if (result?.ok) {
        if (!req.requireReferences && !req.requiredReferenceCount) return result;
        return {
          ...result,
          request: {
            ...result.request,
            visual_references: {
              requested: req.imageUrls.length,
              used: firstReq!.imageUrls.length,
              limited: firstReq!.imageUrls.length < req.imageUrls.length,
            },
          },
        };
      }

      const second = first === "kie" ? fallback(first) : null;
      const refusedOutright =
        !result ||
        (!result.ok &&
          result.definite === true &&
          FALLBACK_CODES.has(result.code) &&
          !/safety|policy|nsfw|content.?filter|refus/i.test(result.message));
      if (!second || !refusedOutright) {
        return (
          result ?? {
            ok: false,
            code: "provider_model_unavailable",
            message: req.requireReferences
              ? "This video model cannot preserve the required identity images. Choose a compatible model or fewer identity references."
              : "This video model isn't available on the configured provider.",
            retryable: false,
          }
        );
      }
      const secondReq = requestFor(req, second);
      if (!secondReq)
        return (
          result ?? {
            ok: false,
            code: "provider_model_unavailable",
            message: "This video model isn't available on any configured provider.",
            retryable: false,
          }
        );
      log.warn("video.provider.fallback", {
        model: req.model.key,
        from: first,
        to: second,
        reason: result && !result.ok ? result.code : "no_model",
      });
      const retried = await providers[second].submit(secondReq);
      if (retried.ok) {
        if (!req.requireReferences && !req.requiredReferenceCount) return retried;
        return {
          ...retried,
          request: {
            ...retried.request,
            visual_references: {
              requested: req.imageUrls.length,
              used: secondReq.imageUrls.length,
              limited: secondReq.imageUrls.length < req.imageUrls.length,
            },
          },
        };
      }
      // Report the fallback's failure, but only retry later when either could still succeed.
      result = {
        ...retried,
        retryable: retried.retryable || Boolean(result && !result.ok && result.retryable),
      };
      return result;
    },

    async check(taskId: string, provider?: string): Promise<ProviderCheck> {
      const chosen = pick(provider);
      const result = await chosen.check(taskId);
      if (result.state !== "success") return result;
      try {
        const downloaded = await chosen.download?.(result.videoUrl, provider);
        await assertSafeVideo(downloaded?.dataUrl ?? result.videoUrl);
        return downloaded ? { ...result, downloaded } : result;
      } catch (error) {
        if (!(error instanceof MediaSafetyError)) throw error;
        if (error.code === "safety_unavailable")
          return { state: "pending", providerState: "safety_review_pending" };
        return {
          state: "failed",
          providerState: "safety_blocked",
          meta: {},
          code: "refusal",
          message: error.message,
          retryable: false,
        };
      }
    },

    async download(videoUrl: string, provider?: string) {
      const chosen = pick(provider);
      return chosen.download ? chosen.download(videoUrl) : null;
    },
  };
}

export const routedVideoProvider = withVideoComposition(createRoutedVideoProvider());
