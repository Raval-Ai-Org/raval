import "server-only";
import { randomUUID } from "node:crypto";
import { durationsFor } from "@/lib/ugc/models";
import { planVideoSegments, segmentVideoPrompt, type VideoSegment } from "@/lib/ugc/duration";
import type { DownloadedVideo, ProviderCheck, VideoProvider, VideoRenderRequest } from "./types";

const PREFIX = "composition:";
type Clip = VideoSegment & {
  /** This clip's own prompt (a storyboard clip); absent: cut from the shared prompt. */
  prompt?: string;
  taskId?: string;
  provider?: string;
  videoUrl?: string;
  costUsd?: number | null;
  submitting?: boolean;
  /** Times this clip was submitted again after an outage-type failure. */
  retries?: number;
  /** What earlier takes of this clip cost, when the video checks had it made again. */
  earlierCostUsd?: number;
};

/** A clip that ended with an outage-type failure is made again this many times. */
export const CLIP_RETRIES = 2;
export type CompositionState = {
  request: VideoRenderRequest;
  clips: Clip[];
  error?: string;
};
export type CompositionRow = {
  id: string;
  revision: number;
  lease_until: string | null;
  state: CompositionState;
};
export interface CompositionStore {
  create(row: CompositionRow): Promise<void>;
  get(id: string): Promise<CompositionRow | null>;
  save(row: CompositionRow, leaseUntil: string | null): Promise<CompositionRow | null>;
}

// Lazy import keeps provider unit tests independent of the service client.
async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const client = supabaseAdmin as unknown as import("@supabase/supabase-js").SupabaseClient;
  return client.from("video_compositions");
}
const store: CompositionStore = {
  async create(row) {
    const { error } = await (await db()).insert(row);
    if (error)
      throw new Error(
        "Longer videos are unavailable until the video compositions migration is applied.",
      );
  },
  async get(id) {
    const { data, error } = await (await db()).select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data as CompositionRow | null;
  },
  async save(row, leaseUntil) {
    const next = { ...row, revision: row.revision + 1, lease_until: leaseUntil };
    const { data, error } = await (
      await db()
    )
      .update(next)
      .eq("id", row.id)
      .eq("revision", row.revision)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as CompositionRow | null;
  },
};

const pending = (): ProviderCheck => ({ state: "pending", providerState: "assembling_clips" });
const failure = (message: string): ProviderCheck => ({
  state: "failed",
  providerState: "composition_failed",
  meta: {},
  code: "composition_failed",
  message,
  retryable: false,
});

/** The clips a request is made of: its own storyboard clips, else a split of its length. */
function planClips(request: VideoRenderRequest): Clip[] {
  if (!request.clips?.length)
    return planVideoSegments(
      request.durationSec,
      durationsFor(request.model, request.imageUrls.length > 0),
    );
  let start = 0;
  return request.clips.map((clip) => {
    const out = { start, seconds: clip.seconds, renderSeconds: clip.seconds, prompt: clip.prompt };
    start += clip.seconds;
    return out;
  });
}

/** The images one clip is sent: a chained clip leads with the frame the clip before ended on. */
function clipImages(request: VideoRenderRequest, index: number, frameUrl?: string): string[] {
  if (index === 0 || !request.chain) return request.imageUrls;
  const rest = request.imageUrls.slice(request.chain.leadImages ?? 0);
  return frameUrl ? [frameUrl, ...rest] : rest;
}

export type ChainFrame = (args: {
  clip: { videoUrl: string; provider?: string; taskId?: string };
  chain: NonNullable<VideoRenderRequest["chain"]>;
  index: number;
  download: (videoUrl: string, provider?: string) => Promise<DownloadedVideo>;
}) => Promise<string>;

/**
 * The last frame of a finished clip, stored as an asset of the job's
 * workspace and signed for the provider. Keyed by the clip's task, so a
 * clip made again gets its own frame.
 */
const storedChainFrame: ChainFrame = async ({ clip, chain, index, download }) => {
  const [{ lastVideoFrame }, { persistAsset, signAssetPath }] = await Promise.all([
    import("./assemble.server"),
    import("@/server/assets/persist.server"),
  ]);
  const video = await download(clip.videoUrl, clip.provider);
  const frame = await lastVideoFrame(video.dataUrl);
  const saved = await persistAsset({
    workspaceId: chain.workspaceId,
    idempotencyKey: `video-chain:${chain.key}:${index}:${clip.taskId ?? clip.videoUrl}`.slice(
      0,
      200,
    ),
    bytes: frame,
    assetType: "image",
    mimeType: "image/jpeg",
    metadata: { source: "video_chain_frame", clip: index },
  });
  if (!saved.ok) throw new Error("Could not keep the clip's last frame.");
  const url = await signAssetPath(saved.asset.storage_path, 6 * 3600);
  if (!url) throw new Error("Could not open the clip's last frame.");
  return url;
};

/** Persist every accepted clip before the next submit; concurrent polls use revision leases. */
export function withVideoComposition(
  base: VideoProvider,
  deps: {
    store?: CompositionStore;
    assemble?: (
      clips: { dataUrl: string; seconds: number }[],
      audio: boolean,
      opts?: { dissolve?: boolean },
    ) => Promise<{ dataUrl: string; bytes: number }>;
    chainFrame?: ChainFrame;
  } = {},
): VideoProvider {
  const jobs = deps.store ?? store;
  const assemble =
    deps.assemble ??
    (async (clips, audio, opts) => {
      const { assembleVideoClips } = await import("./assemble.server");
      return assembleVideoClips(clips, audio, opts);
    });
  const chainFrame = deps.chainFrame ?? storedChainFrame;
  const downloadClip = async (videoUrl: string, provider?: string): Promise<DownloadedVideo> => {
    const downloaded = await base.download?.(videoUrl, provider);
    if (downloaded) return downloaded;
    const { safeFetch } = await import("@/server/safe-fetch");
    const response = await safeFetch(videoUrl, {
      timeoutMs: 30_000,
      maxBytes: 120 * 1024 * 1024,
      onOverflow: "error",
    });
    if (!response.ok) throw new Error("Could not download a generated clip.");
    const bytes = Buffer.from(response.bytes);
    return { dataUrl: `data:video/mp4;base64,${bytes.toString("base64")}`, bytes: bytes.length };
  };
  return {
    ...base,
    async submit(request) {
      const clips = planClips(request);
      if (clips.length === 1 && clips[0].renderSeconds === request.durationSec)
        return base.submit(clips[0].prompt ? { ...request, prompt: clips[0].prompt } : request);
      // Check the required local encoder before spending provider credits.
      if (!deps.assemble) {
        const { assertVideoEncoder } = await import("./assemble.server");
        try {
          await assertVideoEncoder();
        } catch {
          return {
            ok: false,
            code: "encoder_unavailable",
            message:
              "Video assembly is being set up. Choose a model that supports this length in one clip, or try again later.",
            retryable: false,
            definite: true,
          };
        }
      }
      const id = randomUUID();
      await jobs.create({ id, revision: 0, lease_until: null, state: { request, clips } });
      return {
        ok: true,
        taskId: `${PREFIX}${id}`,
        provider: request.model.provider,
        providerModel: request.model.providerModel,
        request: { duration: request.durationSec, clips: clips.length },
      };
    },
    async check(taskId, provider) {
      if (!taskId.startsWith(PREFIX)) return base.check(taskId, provider);
      let row = await jobs.get(taskId.slice(PREFIX.length));
      if (!row) return failure("The video composition could not be found.");
      if (row.state.error) return failure(row.state.error);
      if (row.lease_until && Date.parse(row.lease_until) > Date.now()) return pending();
      const claimed = await jobs.save(row, new Date(Date.now() + 120_000).toISOString());
      if (!claimed) return pending();
      row = claimed;
      const deadline = Date.now() + 25_000;
      const save = async () => {
        const next = await jobs.save(row!, new Date(Date.now() + 120_000).toISOString());
        if (!next) throw new Error("Video composition lease was lost.");
        row = { ...next, state: row!.state };
      };
      try {
        const { request } = row.state;
        for (let i = 0; i < row.state.clips.length; i++) {
          if (Date.now() >= deadline) return pending();
          const clip = row.state.clips[i];
          if (clip.submitting && !clip.taskId) {
            row.state.error =
              "A clip submission was interrupted. Generate again to avoid submitting the same clip twice.";
            break;
          }
          if (!clip.taskId) {
            // A chained clip waits for the one before it to finish.
            const before = row.state.clips[i - 1];
            if (request.chain && before && !before.videoUrl) break;
            const frameUrl =
              request.chain && before?.videoUrl
                ? await chainFrame({
                    clip: {
                      videoUrl: before.videoUrl,
                      provider: before.provider,
                      taskId: before.taskId,
                    },
                    chain: request.chain,
                    index: i,
                    download: downloadClip,
                  })
                : undefined;
            clip.submitting = true;
            await save();
            const submitted = await base.submit({
              ...request,
              clips: undefined,
              chain: undefined,
              callbackUrl: undefined,
              durationSec: clip.renderSeconds,
              minimumDurationSec: clip.renderSeconds,
              imageUrls: clipImages(request, i, frameUrl),
              // The frame the clip before ended on must survive routing.
              requiredReferenceCount: frameUrl ? 1 : request.requiredReferenceCount,
              prompt: clip.prompt ?? segmentVideoPrompt(request.prompt, clip, request.durationSec),
            });
            if (!submitted.ok) {
              if (submitted.definite && submitted.retryable) {
                clip.submitting = false;
                await save();
                return pending();
              }
              row.state.error = submitted.message;
              break;
            }
            clip.taskId = submitted.taskId;
            clip.provider = submitted.provider;
            clip.submitting = false;
            await save();
          }
        }
        if (!row.state.error) {
          for (const clip of row.state.clips) {
            if (Date.now() >= deadline) return pending();
            if (clip.videoUrl || !clip.taskId) continue;
            const checked = await base.check(clip.taskId, clip.provider);
            if (checked.state === "failed") {
              // The clip's task has ended, so submitting it again can never
              // run it twice. Only an outage-type failure is retried; a
              // refusal or anything else still ends the whole video.
              if (checked.retryable && (clip.retries ?? 0) < CLIP_RETRIES) {
                clip.taskId = undefined;
                clip.provider = undefined;
                clip.retries = (clip.retries ?? 0) + 1;
                await save();
                return pending();
              }
              row.state.error = checked.message;
              break;
            }
            if (checked.state === "success") {
              clip.videoUrl = checked.videoUrl;
              clip.costUsd = checked.costUsd;
              await save();
            }
          }
        }
        if (row.state.error) return failure(row.state.error);
        if (row.state.clips.some((c) => !c.videoUrl)) return pending();
        // A clip made again by the checks is added to the cost, so what Mellox
        // really paid is metered (the person's price never changes).
        const costs = row.state.clips.map((c) =>
          c.costUsd == null ? c.costUsd : c.costUsd + (c.earlierCostUsd ?? 0),
        );
        return {
          state: "success",
          providerState: "clips_ready",
          videoUrl: taskId,
          costUsd: costs.every((c) => c != null)
            ? costs.reduce<number>((sum, c) => sum + (c ?? 0), 0)
            : null,
          meta: { clips: row.state.clips.length, duration: row.state.request.durationSec },
        };
      } finally {
        await jobs.save(row, null);
      }
    },
    async download(videoUrl, provider) {
      if (!videoUrl.startsWith(PREFIX)) return base.download?.(videoUrl, provider) ?? null;
      const row = await jobs.get(videoUrl.slice(PREFIX.length));
      if (!row || row.state.error || row.state.clips.some((c) => !c.videoUrl))
        throw new Error("The video clips are not ready to assemble.");
      const clips = [];
      let totalBytes = 0;
      for (const clip of row.state.clips) {
        const downloaded = await downloadClip(clip.videoUrl!, clip.provider);
        totalBytes += downloaded.bytes;
        if (totalBytes > 240 * 1024 * 1024)
          throw new Error("Generated clips exceed the video size limit.");
        clips.push({ dataUrl: downloaded.dataUrl, seconds: clip.seconds });
      }
      return assemble(clips, row.state.request.audio ?? row.state.request.model.nativeAudio, {
        dissolve: row.state.request.dissolve,
      });
    },
  };
}

export const isComposedTask = (taskId: string) => taskId.startsWith(PREFIX);

/**
 * Make some clips of a finished composition again, because the video checks
 * found them wrong (src/lib/studio/video/checks.ts). Each named clip is reset
 * with the reason added to its prompt; the next check submits it, a chained
 * clip again from the frame the clip before ended on. False when the
 * composition is gone or another poll holds it.
 */
export async function redoComposedClips(
  taskId: string,
  clips: readonly number[],
  notes: Readonly<Record<number, string>>,
  jobs: CompositionStore = store,
): Promise<boolean> {
  if (!isComposedTask(taskId)) return false;
  const row = await jobs.get(taskId.slice(PREFIX.length));
  if (!row || row.state.error) return false;
  if (row.lease_until && Date.parse(row.lease_until) > Date.now()) return false;
  for (const index of clips) {
    const clip = row.state.clips[index];
    if (!clip) continue;
    clip.earlierCostUsd = (clip.earlierCostUsd ?? 0) + (clip.costUsd ?? 0);
    clip.taskId = undefined;
    clip.provider = undefined;
    clip.videoUrl = undefined;
    clip.costUsd = undefined;
    clip.retries = 0;
    if (notes[index] && clip.prompt)
      clip.prompt = `${clip.prompt.replace(/\n\nFIX FROM THE LAST TRY:[\s\S]*$/, "")}\n\nFIX FROM THE LAST TRY: ${notes[index]}`;
  }
  return Boolean(await jobs.save(row, null));
}
