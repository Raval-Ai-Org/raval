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
  fallback?: () => VideoProviderId | null;
};

/** Adapt a request to another provider's view of the same model (nearest valid settings). */
function requestFor(req: VideoRenderRequest, provider: VideoProviderId): VideoRenderRequest | null {
  const model: UgcModel | null = specFor(req.model, provider);
  if (!model) return null;
  const settings = coerceRenderSettings(model, {
    model: model.key,
    durationSec: req.durationSec,
    aspectRatio: req.aspectRatio,
    resolution: req.resolution,
    imageCount: req.imageUrls.length,
  });
  return {
    ...req,
    model,
    durationSec: settings.durationSec,
    aspectRatio: settings.aspectRatio,
    resolution: settings.resolution,
    imageUrls: req.imageUrls.slice(0, usableImageCount(model, req.imageUrls.length)),
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

    async submit(req: VideoRenderRequest): Promise<SubmitResult> {
      const first = primary();
      const firstReq = requestFor(req, first);
      let result: SubmitResult | null = firstReq ? await providers[first].submit(firstReq) : null;
      if (result?.ok) return result;

      const second = fallback();
      const refusedOutright =
        !result || (!result.ok && result.definite === true && FALLBACK_CODES.has(result.code));
      if (!second || !refusedOutright) {
        return (
          result ?? {
            ok: false,
            code: "provider_model_unavailable",
            message: "This video model isn't available on the configured provider.",
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
      if (retried.ok) return retried;
      // Report the fallback's failure, but only retry later when either could still succeed.
      result = {
        ...retried,
        retryable: retried.retryable || Boolean(result && !result.ok && result.retryable),
      };
      return result;
    },

    check(taskId: string, provider?: string): Promise<ProviderCheck> {
      return pick(provider).check(taskId);
    },

    async download(videoUrl: string, provider?: string) {
      const chosen = pick(provider);
      return chosen.download ? chosen.download(videoUrl) : null;
    },
  };
}

export const routedVideoProvider = createRoutedVideoProvider();
