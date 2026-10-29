import "server-only";
import { randomUUID } from "node:crypto";
import { durationsFor } from "@/lib/ugc/models";
import { planVideoSegments, segmentVideoPrompt, type VideoSegment } from "@/lib/ugc/duration";
import type { ProviderCheck, VideoProvider, VideoRenderRequest } from "./types";

const PREFIX = "composition:";
type Clip = VideoSegment & {
  taskId?: string;
  provider?: string;
  videoUrl?: string;
  costUsd?: number | null;
  submitting?: boolean;
  /** Times this clip was submitted again after an outage-type failure. */
  retries?: number;
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

/** Persist every accepted clip before the next submit; concurrent polls use revision leases. */
export function withVideoComposition(
  base: VideoProvider,
  deps: {
    store?: CompositionStore;
    assemble?: (
      clips: { dataUrl: string; seconds: number }[],
      audio: boolean,
    ) => Promise<{ dataUrl: string; bytes: number }>;
  } = {},
): VideoProvider {
  const jobs = deps.store ?? store;
  const assemble =
    deps.assemble ??
    (async (clips, audio) => {
      const { assembleVideoClips } = await import("./assemble.server");
      return assembleVideoClips(clips, audio);
    });
  return {
    ...base,
    async submit(request) {
      const clips = planVideoSegments(
        request.durationSec,
        durationsFor(request.model, request.imageUrls.length > 0),
      );
      if (clips.length === 1 && clips[0].renderSeconds === request.durationSec)
        return base.submit(request);
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
            clip.submitting = true;
            await save();
            const submitted = await base.submit({
              ...request,
              callbackUrl: undefined,
              durationSec: clip.renderSeconds,
              minimumDurationSec: clip.renderSeconds,
              prompt: segmentVideoPrompt(request.prompt, clip, request.durationSec),
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
        const costs = row.state.clips.map((c) => c.costUsd);
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
        let downloaded = await base.download?.(clip.videoUrl!, clip.provider);
        if (!downloaded) {
          const { safeFetch } = await import("@/server/safe-fetch");
          const response = await safeFetch(clip.videoUrl!, {
            timeoutMs: 30_000,
            maxBytes: 120 * 1024 * 1024,
            onOverflow: "error",
          });
          if (!response.ok) throw new Error("Could not download a generated clip.");
          const bytes = Buffer.from(response.bytes);
          downloaded = {
            dataUrl: `data:video/mp4;base64,${bytes.toString("base64")}`,
            bytes: bytes.length,
          };
        }
        totalBytes += downloaded.bytes;
        if (totalBytes > 240 * 1024 * 1024)
          throw new Error("Generated clips exceed the video size limit.");
        clips.push({ dataUrl: downloaded.dataUrl, seconds: clip.seconds });
      }
      return assemble(clips, row.state.request.audio ?? row.state.request.model.nativeAudio);
    },
  };
}
