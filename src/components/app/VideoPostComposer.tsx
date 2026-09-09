"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Download,
  Image as ImageIcon,
  Repeat,
  Sparkles,
  Video as VideoIcon,
  X,
} from "@/components/brand/icons";
import { authedFetch } from "@/lib/authed-fetch";
import { persistGeneratedAsset } from "@/lib/persistent-assets";
import type { PlatformId } from "@/lib/social-platforms";

type VideoAspectRatio = "adaptive" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
type VideoResolution = "480P" | "720P" | "1080P";
type VideoStatus = "idle" | "loading" | "success" | "error";

const ASPECT_BY_PLATFORM: Record<PlatformId, VideoAspectRatio> = {
  linkedin: "16:9",
  twitter: "16:9",
  facebook: "16:9",
  instagram: "9:16",
  threads: "1:1",
  tiktok: "9:16",
  youtube: "16:9",
};

const DURATION_OPTIONS = [4, 6, 8];

export type GeneratedVideoState = {
  url: string;
  generationId: string;
  assetId?: string;
  duration: number;
  aspectRatio: VideoAspectRatio;
  model: string;
};

export function VideoPostComposer({
  prompt,
  workspaceId,
  contentItemId,
  platform,
  brandName,
  brandContext,
  onMediaTypeChange,
  onComplete,
}: {
  prompt: string;
  workspaceId: string | null;
  contentItemId?: string | null;
  platform: PlatformId;
  brandName?: string;
  brandContext?: string;
  onMediaTypeChange: (type: "image" | "video") => void;
  onComplete?: (video: GeneratedVideoState) => void;
}) {
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>(
    ASPECT_BY_PLATFORM[platform] ?? "adaptive",
  );
  const [duration, setDuration] = useState(6);
  const [resolution, setResolution] = useState<VideoResolution>("720P");
  const [audio, setAudio] = useState(true);
  const [status, setStatus] = useState<VideoStatus>("idle");
  const [stage, setStage] = useState("Ready to create");
  const [error, setError] = useState<string | null>(null);
  const [video, setVideo] = useState<GeneratedVideoState | null>(null);

  useEffect(() => {
    setAspectRatio(ASPECT_BY_PLATFORM[platform] ?? "adaptive");
  }, [platform]);

  const generate = useCallback(async () => {
    const basePrompt = prompt.trim();
    if (!basePrompt || status === "loading") return;
    if (!workspaceId) {
      setStatus("error");
      setStage("Workspace required");
      setError("Select a workspace before generating a video.");
      return;
    }
    setStatus("loading");
    setError(null);
    setStage("Preparing creative");
    try {
      const creativePrompt = [
        `Create a ${duration}-second branded marketing video for ${brandName || "the brand"}.`,
        `Platform: ${platform}. Aspect ratio: ${aspectRatio}.`,
        "Structure the video with a clear opening hook, purposeful motion, coherent camera movement, a focused product/service moment, and a concise visual CTA ending.",
        "Keep on-screen text minimal, legible, and free of gibberish. Avoid watermarks and other brands.",
        brandContext,
        `Creative brief: ${basePrompt}`,
      ]
        .filter(Boolean)
        .join("\n\n");
      setStage("Creating video task");
      const response = await authedFetch("/api/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: creativePrompt, aspectRatio, duration, resolution, audio }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof json?.error === "string" ? json.error : "Video generation failed.");
      }
      setStage("Finalizing preview");
      if (!json.videoUrl || !json.generationId)
        throw new Error("Video generation returned no usable result.");
      const persisted = (await persistGeneratedAsset({
        workspaceId,
        contentItemId,
        sourceUrl: json.videoUrl,
        idempotencyKey: json.generationId,
        filename: `mellox-generated-video-${new Date().toISOString().slice(0, 10)}.mp4`,
        platform,
        assetType: "video",
        model: json.model,
        metadata: {
          source: "studio-video",
          duration: json.duration,
          aspectRatio: json.aspectRatio,
        },
      })) as { id?: string; public_url?: string };
      if (!persisted.public_url)
        throw new Error("Video was generated but could not be stored permanently.");
      const next: GeneratedVideoState = {
        url: persisted.public_url,
        generationId: json.generationId,
        assetId: persisted.id,
        duration: json.duration,
        aspectRatio: json.aspectRatio,
        model: json.model,
      };
      setVideo(next);
      setStatus("success");
      setStage("Ready");
      onComplete?.(next);
    } catch (cause) {
      setStatus("error");
      setStage("Generation failed");
      setError(
        cause instanceof Error ? cause.message : "Video generation failed. Please try again.",
      );
    }
  }, [
    aspectRatio,
    audio,
    brandContext,
    brandName,
    contentItemId,
    duration,
    onComplete,
    platform,
    prompt,
    resolution,
    status,
    workspaceId,
  ]);

  return (
    <section className="mx-auto max-w-[680px] space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Creative format</div>
          <div className="text-[11px] text-muted-foreground">
            Choose the asset type for this post.
          </div>
        </div>
        <div className="flex rounded-full border border-border/60 bg-card p-1">
          <button
            type="button"
            onClick={() => onMediaTypeChange("image")}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <ImageIcon className="h-3 w-3" /> Image
          </button>
          <button
            type="button"
            onClick={() => onMediaTypeChange("video")}
            className="inline-flex items-center gap-1 rounded-full bg-foreground px-2.5 py-1 text-[11px] text-background"
          >
            <VideoIcon className="h-3 w-3" /> Video
          </button>
        </div>
      </div>

      <div className="grid gap-3 rounded-2xl border border-border/60 bg-card p-3 sm:grid-cols-3">
        <label className="text-[11px] font-medium">
          Aspect ratio
          <select
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value as VideoAspectRatio)}
            disabled={status === "loading"}
            className="mt-1 w-full rounded-lg border border-border/60 bg-background px-2 py-1.5 text-xs"
          >
            <option value="16:9">16:9 Landscape</option>
            <option value="4:3">4:3</option>
            <option value="1:1">1:1 Square</option>
            <option value="3:4">3:4</option>
            <option value="9:16">9:16 Vertical</option>
          </select>
        </label>
        <label className="text-[11px] font-medium">
          Duration
          <select
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            disabled={status === "loading"}
            className="mt-1 w-full rounded-lg border border-border/60 bg-background px-2 py-1.5 text-xs"
          >
            {DURATION_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}s
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] font-medium">
          Resolution
          <select
            value={resolution}
            onChange={(e) => setResolution(e.target.value as VideoResolution)}
            disabled={status === "loading"}
            className="mt-1 w-full rounded-lg border border-border/60 bg-background px-2 py-1.5 text-xs"
          >
            <option value="480P">480P Draft</option>
            <option value="720P">720P</option>
            <option value="1080P">1080P</option>
          </select>
        </label>
      </div>

      {video ? (
        <div className="overflow-hidden rounded-2xl border border-border/60 bg-black">
          <video
            key={video.url}
            src={video.url}
            controls
            playsInline
            preload="metadata"
            className="max-h-[480px] w-full"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 bg-card px-3 py-2 text-[11px]">
            <span className="inline-flex items-center gap-1 text-emerald-600">
              <Check className="h-3 w-3" /> Ready · {video.duration}s · {video.aspectRatio}
            </span>
            <div className="flex items-center gap-1.5">
              <a
                href={video.url}
                download
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2.5 py-1 hover:bg-muted"
              >
                <Download className="h-3 w-3" /> Download
              </a>
              <button
                type="button"
                onClick={() => void generate()}
                disabled={status === "loading"}
                className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2.5 py-1 hover:bg-muted disabled:opacity-50"
              >
                <Repeat className="h-3 w-3" /> Regenerate
              </button>
            </div>
          </div>
        </div>
      ) : status === "loading" ? (
        <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-2xl border border-border/60 bg-card text-center">
          <div className="relative grid h-12 w-12 place-items-center rounded-full bg-foreground/5">
            <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-foreground" />
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="text-sm font-semibold">{stage}</div>
          <div className="text-[11px] text-muted-foreground">
            Kie.ai is rendering the video. This can take a few minutes.
          </div>
          <button
            type="button"
            onClick={() => setStatus("idle")}
            className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground"
          >
            <X className="h-3 w-3" /> Hide
          </button>
        </div>
      ) : status === "error" ? (
        <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-2xl border border-destructive/40 bg-card px-5 text-center">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <div className="text-sm font-semibold">Video generation failed</div>
          <p className="max-w-md text-[11px] text-muted-foreground">{error}</p>
          <button
            type="button"
            onClick={() => void generate()}
            className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs text-background"
          >
            <Repeat className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      ) : (
        <div className="flex min-h-[260px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/70 bg-card px-5 text-center">
          <VideoIcon className="h-8 w-8 text-muted-foreground" />
          <div className="text-sm font-semibold">Create a platform-ready video</div>
          <p className="max-w-md text-[11px] text-muted-foreground">
            Wan 3.0 supports 2–30 seconds, platform-aware ratios, and optional audio.
          </p>
          <label className="mt-2 inline-flex items-center gap-2 text-[11px] text-muted-foreground">
            <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} />{" "}
            Include generated audio
          </label>
          <button
            type="button"
            onClick={() => void generate()}
            disabled={!prompt.trim()}
            className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs text-background disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" /> Generate video
          </button>
        </div>
      )}
    </section>
  );
}
