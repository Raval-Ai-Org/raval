import { randomUUID } from "node:crypto";
import { z } from "zod";
import { defineRoute } from "@/server/route";
import { HttpError } from "@/server/http-error";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BodySchema = z.object({
  prompt: z.string().trim().min(1).max(20_000),
  aspectRatio: z.enum(["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16"]).default("16:9"),
  duration: z
    .number()
    .int()
    .refine((value) => [4, 6, 8].includes(value), {
      message: "Video duration must be 4, 6, or 8 seconds.",
    })
    .default(6),
  resolution: z.enum(["480P", "720P", "1080P"]).default("720P"),
  audio: z.boolean().default(true),
  seed: z.number().int().min(0).max(2_147_483_647).default(0),
});

/** The catalog model this route renders with (src/lib/ugc/models.ts). */
const MODEL_KEY = "premium" as const;
const POLL_MS = 5_000;
const DEADLINE_MS = 270_000;

/**
 * One text-to-video render, held open until it finishes. Runs on the video
 * provider interface (VIDEO_PROVIDER, with the KIE → OpenRouter fallback).
 * A provider whose file needs its API key (OpenRouter) is stored in the
 * workspace's assets and a signed link returned, so this needs a workspace.
 */
export const POST = defineRoute({
  name: "generate-video",
  auth: "user",
  body: BodySchema,
  // The most expensive call in the product, billed per video.
  rateLimit: "video",
  handler: async ({ body, attributedWorkspaceId }) => {
    const [{ enforceBudget }, { recordUsage }, { activeModel }, { routedVideoProvider }] =
      await Promise.all([
        import("@/server/ai/budget"),
        import("@/server/ai/metering"),
        import("@/server/ugc/models.server"),
        import("@/server/ugc/providers/routed.server"),
      ]);
    await enforceBudget("video");
    const aspectRatio = body.aspectRatio === "adaptive" ? "16:9" : body.aspectRatio;
    const started = Date.now();
    const submitted = await routedVideoProvider.submit({
      model: activeModel(MODEL_KEY),
      prompt: body.prompt,
      durationSec: body.duration,
      aspectRatio,
      resolution: body.resolution.toLowerCase() as "480p" | "720p" | "1080p",
      audio: body.audio,
      imageUrls: [],
    });
    if (!submitted.ok) throw new HttpError(submitted.retryable ? 503 : 502, submitted.message);

    while (Date.now() - started < DEADLINE_MS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      const check = await routedVideoProvider.check(submitted.taskId, submitted.provider);
      if (check.state === "pending") continue;
      if (check.state === "failed") {
        recordUsage({
          provider: submitted.provider,
          model: submitted.providerModel,
          kind: "video",
          status: "error",
          latencyMs: Date.now() - started,
        });
        throw new HttpError(502, check.message);
      }
      recordUsage({
        provider: submitted.provider,
        model: submitted.providerModel,
        kind: "video",
        units: 1,
        estCostUsd: check.costUsd ?? undefined,
        latencyMs: Date.now() - started,
      });
      let videoUrl = check.videoUrl;
      const downloaded = await routedVideoProvider.download?.(check.videoUrl, submitted.provider);
      if (downloaded) {
        if (!attributedWorkspaceId) {
          throw new HttpError(400, "Send x-workspace-id so the finished video can be stored.");
        }
        const { persistAsset } = await import("@/server/assets/persist.server");
        const stored = await persistAsset({
          workspaceId: attributedWorkspaceId,
          idempotencyKey: `generate-video:${submitted.taskId}`,
          dataUrl: downloaded.dataUrl,
          assetType: "video",
          filename: `mellox-video-${randomUUID().slice(0, 8)}.mp4`,
          provider: submitted.provider,
          model: submitted.providerModel,
          metadata: { source: "generate-video", aspect_ratio: aspectRatio },
        });
        if (!stored.ok) throw new HttpError(stored.status, stored.message);
        videoUrl = stored.asset.public_url ?? "";
      }
      return Response.json(
        {
          type: "video",
          provider: submitted.provider,
          generationId: submitted.taskId,
          videoUrl,
          thumbnailUrl: check.thumbnailUrl,
          duration: body.duration,
          aspectRatio,
          model: submitted.providerModel,
          status: "completed",
          metadata: { resolution: body.resolution, audio: body.audio },
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    throw new HttpError(504, "Video generation took too long and timed out.");
  },
});
