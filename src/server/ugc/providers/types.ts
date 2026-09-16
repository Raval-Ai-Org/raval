// The seam between UGC renders and a video provider. The render service only
// speaks this interface, so another provider (or a direct Google/ByteDance
// integration) is a new implementation, not a rewrite.
import "server-only";
import type { UgcAspectRatio, UgcModel, UgcResolution } from "@/lib/ugc/models";

export type VideoRenderRequest = {
  model: UgcModel;
  prompt: string;
  durationSec: number;
  aspectRatio: UgcAspectRatio;
  resolution: UgcResolution;
  /** Publicly fetchable image URLs (signed), already capped to the model's max. */
  imageUrls: string[];
  callbackUrl?: string;
};

export type ProviderFailure = {
  code: string;
  message: string;
  /** Worth trying the same step again later (outage, rate limit, network). */
  retryable: boolean;
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
  | { ok: true; taskId: string; request: Record<string, unknown> }
  | ({ ok: false } & ProviderFailure);

export interface VideoProvider {
  readonly id: string;
  /** The exact generation type sent (for records): TEXT_2_VIDEO, REFERENCE_2_VIDEO, … */
  generationType(model: UgcModel, imageCount: number): string;
  submit(request: VideoRenderRequest): Promise<SubmitResult>;
  check(taskId: string): Promise<ProviderCheck>;
}
