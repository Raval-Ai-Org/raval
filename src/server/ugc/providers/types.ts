// The seam between video renders (UGC, Studio, /api/generate-video) and a
// video provider. Renders only speak this interface, so a provider is one
// implementation file: KIE today (providers/kie.server.ts, temporary) and
// OpenRouter (providers/openrouter.server.ts). providers/routed.server.ts
// picks between them and falls back from KIE to OpenRouter.
import "server-only";
import type { UgcAspectRatio, UgcModel, UgcResolution, VideoProviderId } from "@/lib/ugc/models";

export type VideoRenderRequest = {
  /** The model as the provider running this request sees it (see specFor). */
  model: UgcModel;
  prompt: string;
  durationSec: number;
  aspectRatio: UgcAspectRatio;
  resolution: UgcResolution;
  /** Generate sound (for models that can). Default: the model's native audio. */
  audio?: boolean;
  /** Publicly fetchable image URLs (signed), already capped to the model's max. */
  imageUrls: string[];
  /** KIE callback; OpenRouter computes its own (see openRouterVideoCallbackUrl). */
  callbackUrl?: string;
};

export type ProviderFailure = {
  code: string;
  message: string;
  /** Worth trying the same step again later (outage, rate limit, network). */
  retryable: boolean;
  /**
   * The provider definitely did not accept the job (out of credits, not
   * configured, model unavailable), so another provider may take it without
   * any risk of paying twice. Never set for an unknown outcome (timeout,
   * dropped connection), where the job may already be running.
   */
  definite?: boolean;
};

export type ProviderCheck =
  | { state: "pending"; providerState: string }
  | {
      state: "success";
      providerState: string;
      videoUrl: string;
      thumbnailUrl?: string;
      costUsd: number | null;
      meta: Record<string, unknown>;
    }
  | ({ state: "failed"; providerState: string; meta: Record<string, unknown> } & ProviderFailure);

export type SubmitResult =
  | {
      ok: true;
      taskId: string;
      request: Record<string, unknown>;
      /** Which provider accepted the job, and its model id. */
      provider: VideoProviderId;
      providerModel: string;
    }
  | ({ ok: false } & ProviderFailure);

export type DownloadedVideo = { dataUrl: string; bytes: number };

export interface VideoProvider {
  readonly id: string;
  /** The exact generation type sent (for records): TEXT_2_VIDEO, REFERENCE_2_VIDEO, … */
  generationType(model: UgcModel, imageCount: number): string;
  submit(request: VideoRenderRequest): Promise<SubmitResult>;
  /** One status read. `provider` is the one recorded on the job (routed provider). */
  check(taskId: string, provider?: string): Promise<ProviderCheck>;
  /**
   * Fetch a finished video the storage layer can't fetch by URL (OpenRouter's
   * content URLs need the API key). Absent when the URL is public.
   */
  download?(videoUrl: string, provider?: string): Promise<DownloadedVideo | null>;
}
