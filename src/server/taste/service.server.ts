// service.server.ts — Library hearts (ADR-0038). Callers
// (src/server/fns/taste.ts) have already checked the workspace role. Every id
// from the browser is re-read here against the verified workspace; traits and
// the caption sample are copied from stored rows, never from the request.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HttpError } from "@/server/http-error";
import type { WorkspaceRole } from "@/server/api-auth";
import {
  TASTE_WINDOW,
  isReaction,
  type Reaction,
  type Taste,
  type TasteView,
} from "@/lib/taste/contracts";
import { learnTaste } from "@/lib/taste/learn";
import { parseTraits, traitsOf } from "@/lib/taste/traits";
import { tasteSummary } from "@/lib/taste/block";
import { invalidateTasteContext } from "./context.server";

const db = supabaseAdmin as unknown as SupabaseClient;
const TABLE = "content_reactions";
const LOVED_LABEL = "Loved in Library";

type Obj = Record<string, unknown>;
type Caller = { workspaceId: string; userId: string; role: WorkspaceRole };

export type { TasteView };

function checked<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

function obj(value: unknown): Obj {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : {};
}

type Row = {
  subject_key: string;
  reaction: string;
  traits: unknown;
  caption_sample: string | null;
  visual_source_id: string | null;
};

async function readRows(workspaceId: string, limit = TASTE_WINDOW): Promise<Row[]> {
  return (checked(
    await db
      .from(TABLE)
      .select("subject_key, reaction, traits, caption_sample, visual_source_id")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(limit),
  ) ?? []) as Row[];
}

export function tasteFromRows(rows: readonly Row[]): Taste {
  return learnTaste(
    rows
      .filter((r) => isReaction(r.reaction))
      .map((r) => ({ reaction: r.reaction as Reaction, traits: parseTraits(r.traits) })),
  );
}

/** The brand's taste and up to two loved captions, for generators. */
export async function readTaste(
  workspaceId: string,
): Promise<{ taste: Taste; lovedSamples: string[] }> {
  const rows = await readRows(workspaceId);
  return {
    taste: tasteFromRows(rows),
    lovedSamples: rows
      .filter((r) => r.reaction === "love" && (r.caption_sample ?? "").trim().length > 60)
      .slice(0, 2)
      .map((r) => (r.caption_sample ?? "").trim()),
  };
}

export async function getTasteView(workspaceId: string): Promise<TasteView> {
  // The view lists every reaction (for the hearts); the taste uses the window.
  const rows = await readRows(workspaceId, 1000);
  const reactions: Record<string, Reaction> = {};
  for (const r of rows) if (isReaction(r.reaction)) reactions[r.subject_key] = r.reaction;
  const all = Object.values(reactions);
  const loves = all.filter((r) => r === "love").length;
  return {
    reactions,
    summary: {
      ...tasteSummary(tasteFromRows(rows.slice(0, TASTE_WINDOW))),
      loves,
      lesses: all.length - loves,
    },
  };
}

type Subject = {
  key: string;
  contentItemId: string | null;
  assetId: string | null;
  meta: Obj;
  channel: string | null;
  kind: string | null;
  body: string;
  jobId: string | null;
  /** The picture a love adds to Inspo, when it is an image. */
  imageAssetId: string | null;
};

const IMAGE = /^image\//;

/** One piece, read from the workspace's own rows. A post's asset belongs to its post. */
async function resolveSubject(
  workspaceId: string,
  args: { contentItemId?: string; assetId?: string },
): Promise<Subject> {
  let contentItemId = args.contentItemId ?? null;
  let asset: Obj | null = null;
  if (args.assetId) {
    asset = checked(
      await db
        .from("assets")
        .select("id, content_item_id, mime_type, metadata, status")
        .eq("workspace_id", workspaceId)
        .eq("id", args.assetId)
        .is("deleted_at", null)
        .maybeSingle(),
    ) as Obj | null;
    if (!asset) throw new HttpError(404, "This picture is no longer in the library.");
    if (!contentItemId && typeof asset.content_item_id === "string")
      contentItemId = asset.content_item_id;
  }
  if (contentItemId) {
    const item = checked(
      await db
        .from("content_items")
        .select("id, kind, channel, body, meta")
        .eq("workspace_id", workspaceId)
        .eq("id", contentItemId)
        .maybeSingle(),
    ) as Obj | null;
    if (item) {
      const meta = obj(item.meta);
      const key = typeof meta.group_id === "string" ? meta.group_id : String(item.id);
      // The post's picture: the asset that was asked about, else its newest image.
      let imageAssetId =
        asset && IMAGE.test(String(asset.mime_type ?? "")) && asset.status === "ready"
          ? String(asset.id)
          : null;
      if (!imageAssetId) {
        const ids = [String(item.id)];
        if (typeof meta.group_id === "string") {
          const siblings = checked(
            await db
              .from("content_items")
              .select("id")
              .eq("workspace_id", workspaceId)
              .eq("meta->>group_id", meta.group_id)
              .limit(20),
          ) as { id: string }[] | null;
          for (const s of siblings ?? []) if (!ids.includes(s.id)) ids.push(s.id);
        }
        const pic = checked(
          await db
            .from("assets")
            .select("id, mime_type")
            .eq("workspace_id", workspaceId)
            .in("content_item_id", ids)
            .eq("status", "ready")
            .is("deleted_at", null)
            .like("mime_type", "image/%")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ) as { id: string } | null;
        imageAssetId = pic?.id ?? null;
      }
      return {
        key,
        contentItemId: String(item.id),
        assetId: asset ? String(asset.id) : null,
        meta,
        channel: typeof item.channel === "string" ? item.channel : null,
        kind: typeof item.kind === "string" ? item.kind : null,
        body: typeof item.body === "string" ? item.body : "",
        jobId: typeof meta.job_id === "string" ? meta.job_id : null,
        imageAssetId,
      };
    }
    if (!asset) throw new HttpError(404, "This post is no longer in the library.");
  }
  if (!asset) throw new HttpError(400, "Choose a post or a picture.");
  const metadata = obj(asset.metadata);
  return {
    key: String(asset.id),
    contentItemId: null,
    assetId: String(asset.id),
    meta: metadata,
    channel: null,
    kind: null,
    body: "",
    jobId: typeof metadata.job_id === "string" ? metadata.job_id : null,
    imageAssetId:
      IMAGE.test(String(asset.mime_type ?? "")) && asset.status === "ready"
        ? String(asset.id)
        : null,
  };
}

async function readJob(workspaceId: string, jobId: string | null) {
  if (!jobId) return null;
  return checked(
    await db
      .from("studio_jobs")
      .select("type, input, output")
      .eq("workspace_id", workspaceId)
      .eq("id", jobId)
      .maybeSingle(),
  ) as { type: string | null; input: unknown; output: unknown } | null;
}

function editor(c: Caller) {
  if (c.role === "viewer") throw new HttpError(403, "You need edit access to teach Mellox.");
}

/** Adds a loved picture to Inspo once; returns the source it created, if any. */
async function addLovedPicture(c: Caller, assetId: string): Promise<string | null> {
  const existing = checked(
    await db
      .from("brand_visual_sources")
      .select("id")
      .eq("workspace_id", c.workspaceId)
      .eq("asset_id", assetId)
      .maybeSingle(),
  );
  // A reference a person added (or removed) keeps what they chose.
  if (existing) return null;
  try {
    const { addVisualSource } = await import("@/server/brand-visuals/service.server");
    await addVisualSource(c, {
      assetId,
      label: LOVED_LABEL,
      purpose: "inspiration",
      notes: "",
      formats: [],
      kind: "library",
    });
  } catch (error) {
    // The Inspo board is full or the picture can't be a reference: the heart still counts.
    if (error instanceof HttpError) return null;
    throw error;
  }
  const row = checked(
    await db
      .from("brand_visual_sources")
      .select("id")
      .eq("workspace_id", c.workspaceId)
      .eq("asset_id", assetId)
      .maybeSingle(),
  ) as { id: string } | null;
  return row?.id ?? null;
}

async function removeLovedPicture(c: Caller, sourceId: string | null) {
  if (!sourceId) return;
  try {
    const { changeVisualSource } = await import("@/server/brand-visuals/service.server");
    await changeVisualSource(c, { id: sourceId, status: "removed" });
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
  }
}

export async function setReaction(
  c: Caller,
  args: { contentItemId?: string; assetId?: string; reaction: Reaction | null },
): Promise<TasteView> {
  editor(c);
  const subject = await resolveSubject(c.workspaceId, args);
  const before = checked(
    await db
      .from(TABLE)
      .select("reaction, visual_source_id")
      .eq("workspace_id", c.workspaceId)
      .eq("subject_key", subject.key)
      .maybeSingle(),
  ) as { reaction: string; visual_source_id: string | null } | null;

  if (!args.reaction) {
    if (before) {
      await removeLovedPicture(c, before.visual_source_id);
      checked(
        await db
          .from(TABLE)
          .delete()
          .eq("workspace_id", c.workspaceId)
          .eq("subject_key", subject.key),
      );
    }
  } else {
    const job = await readJob(c.workspaceId, subject.jobId);
    const traits = traitsOf({
      meta: subject.meta,
      channel: subject.channel,
      kind: subject.kind,
      job,
    });
    let visualSourceId = before?.visual_source_id ?? null;
    if (args.reaction === "love" && !visualSourceId && subject.imageAssetId)
      visualSourceId = await addLovedPicture(c, subject.imageAssetId);
    if (args.reaction === "less" && visualSourceId) {
      await removeLovedPicture(c, visualSourceId);
      visualSourceId = null;
    }
    checked(
      await db.from(TABLE).upsert(
        {
          workspace_id: c.workspaceId,
          subject_key: subject.key,
          content_item_id: subject.contentItemId,
          asset_id: subject.assetId,
          reaction: args.reaction,
          traits,
          caption_sample: subject.body.trim().slice(0, 600),
          visual_source_id: visualSourceId,
          set_by: c.userId,
        },
        { onConflict: "workspace_id,subject_key" },
      ),
    );
  }
  invalidateTasteContext(c.workspaceId);
  return getTasteView(c.workspaceId);
}

/** Forget every heart: the reactions and the Inspo pictures they added. */
export async function resetTaste(c: Caller): Promise<TasteView> {
  editor(c);
  const rows = (checked(
    await db
      .from(TABLE)
      .select("visual_source_id")
      .eq("workspace_id", c.workspaceId)
      .not("visual_source_id", "is", null),
  ) ?? []) as { visual_source_id: string | null }[];
  for (const r of rows) await removeLovedPicture(c, r.visual_source_id);
  checked(await db.from(TABLE).delete().eq("workspace_id", c.workspaceId));
  invalidateTasteContext(c.workspaceId);
  return getTasteView(c.workspaceId);
}
