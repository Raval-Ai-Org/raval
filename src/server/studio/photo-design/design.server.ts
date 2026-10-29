// "Design with my photos", start and finish. Start reads the photos, plans
// the piece and writes the design-layer prompt; the layer is an ordinary
// Studio image task (metered, routed, polled). Finish lays the real photos
// into the finished layer, or asks for one more layer with what went wrong.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { persistAsset, signAssetPath } from "@/server/assets/persist.server";
import { isWorkspaceStoragePath } from "@/lib/workspace/storage-path";
import {
  photoDesignCopy,
  planPhotoDesign,
  type PhotoDesignPlan,
} from "@/lib/studio/photo-design/plan";
import {
  blendPrompt,
  designLayerPrompt,
  type PhotoDesignBrand,
} from "@/lib/studio/photo-design/prompt";
import type { PhotoReading } from "@/lib/studio/photo-design/read";
import type { AspectRatio } from "@/lib/studio/aspect";
import {
  resolveStudioReferences,
  screenCaptureIds,
  type StudioReference,
} from "../references.server";
import { contactSheet, cropToScreen, loadDesignPhotos, readDesignPhotos } from "./photos.server";
import { composePhotoDesign } from "./compose.server";

/** Stored on the Studio image task while its design layer renders. */
export type PhotoDesignTask = {
  /** The person's photos, by asset id, in the order they chose them. */
  assetIds: string[];
  plan: PhotoDesignPlan;
  readings: PhotoReading[];
  /** References the layer is made from (workspace storage paths), signed again on a retry. */
  referencePaths: string[];
  /** Layers that could not hold the photos; one more is asked for, then the piece fails. */
  attempts: number;
  /** The prompt before any retry note. */
  basePrompt: string;
  background?: "transparent";
  /** The finished layer, kept so a later edit starts from this design. */
  layerPath?: string;
};

/** Layers asked for again after a failed check (so at most two per picture). */
export const LAYER_RETRIES = 1;

export const PHOTO_DESIGN_FAILED =
  "We couldn't place your photos cleanly in the design. Try again, or choose Blend it more.";

const SERIES_SOURCES = ["studio_photo_design"];

/**
 * Up to two of the brand's earlier photo designs that a person approved or
 * sent, so a brand's event posts read as one series. Best effort.
 */
async function seriesPaths(client: SupabaseClient, workspaceId: string): Promise<string[]> {
  try {
    const { data: assets } = await client
      .from("assets")
      .select("storage_path, content_item_id")
      .eq("workspace_id", workspaceId)
      .eq("status", "ready")
      .in("metadata->>source", SERIES_SOURCES)
      .not("content_item_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(8);
    const ids = [...new Set((assets ?? []).map((a) => a.content_item_id as string))];
    if (!ids.length) return [];
    const { data: items } = await client
      .from("content_items")
      .select("id, status")
      .eq("workspace_id", workspaceId)
      .in("id", ids)
      .in("status", ["approved", "scheduled", "published"]);
    const kept = new Set((items ?? []).map((item) => item.id));
    return (assets ?? [])
      .filter((a) => kept.has(a.content_item_id as string))
      .map((a) => a.storage_path as string)
      .filter((path) => isWorkspaceStoragePath(path, workspaceId))
      .slice(0, 2);
  } catch {
    return [];
  }
}

async function signAll(paths: string[], workspaceId: string): Promise<string[]> {
  const signed = await Promise.all(
    paths
      .filter((path) => isWorkspaceStoragePath(path, workspaceId))
      .map((path) => signAssetPath(path)),
  );
  return signed.filter((url): url is string => !!url);
}

/** Words for the design: a revision's own quoted words replace the brief's. */
function copyFor(args: {
  brief: string;
  revision?: string;
  onImageText?: string;
  title?: string;
  maxWords?: number;
}) {
  const revised = args.revision ? photoDesignCopy({ brief: args.revision }) : [];
  const fromRevision = /[“"][^”"]{2,90}[”"]/.test(args.revision ?? "");
  return fromRevision
    ? revised
    : photoDesignCopy({
        brief: args.brief,
        onImageText: args.onImageText,
        title: args.title,
        maxWords: args.maxWords,
      });
}

export type PreparedPhotoDesign = {
  prompt: string;
  references: string[];
  /** Absent for "blend it more": that picture is an ordinary generated one. */
  task?: PhotoDesignTask;
  background?: "transparent";
};

export async function preparePhotoDesign(args: {
  client: SupabaseClient;
  workspaceId: string;
  jobId: string;
  photos: StudioReference[];
  fidelity: "exact" | "blend";
  ratio: AspectRatio;
  brief: string;
  brand: PhotoDesignBrand;
  onImageText?: string;
  title?: string;
  maxWords?: number;
  revision?: string;
  novelty?: string;
  /** The brand's saved style references (already signed). */
  tasteReferences: string[];
  /** The layer of the design being edited, if this is an edit. */
  previousLayerPath?: string | null;
  emphasisSeed: string;
}): Promise<PreparedPhotoDesign> {
  const screenIds = await screenCaptureIds(
    args.client,
    args.workspaceId,
    args.photos.map((p) => p.id),
  );
  const screens = args.photos.map((p) => screenIds.has(p.id));
  const loaded = await loadDesignPhotos(args.client, args.photos);
  const photos = await Promise.all(
    loaded.map((photo, i) => (screens[i] ? cropToScreen(photo) : photo)),
  );
  const read = await readDesignPhotos(photos);
  const plan = planPhotoDesign({
    readings: read.photos,
    sizes: photos,
    ratio: args.ratio,
    copy: copyFor(args),
    brief: args.brief,
    occasion: read.occasion,
    brandColours: args.brand.colours,
    screens,
  });

  if (args.fidelity === "blend") {
    // The photos themselves are the references; past three, one sheet holds them.
    const lead =
      args.photos.length <= 3
        ? args.photos.map((photo) => photo.url)
        : await signAll([await storeSheet(args, photos, plan)], args.workspaceId);
    return {
      prompt: blendPrompt({
        plan,
        brand: args.brand,
        brief: args.brief,
        revision: args.revision,
        emphasisSeed: args.emphasisSeed,
      }),
      references: [...new Set([...lead, ...args.tasteReferences])].slice(0, 4),
    };
  }

  const sheetPath = await storeSheet(args, photos, plan);
  const previous =
    args.previousLayerPath && isWorkspaceStoragePath(args.previousLayerPath, args.workspaceId)
      ? [args.previousLayerPath]
      : [];
  const referencePaths = [
    ...previous,
    sheetPath,
    ...(previous.length ? [] : await seriesPaths(args.client, args.workspaceId)),
  ].slice(0, 4);
  const basePrompt = [
    designLayerPrompt({
      plan,
      brand: args.brand,
      brief: args.brief,
      revision: args.revision,
      novelty: args.novelty,
      emphasisSeed: args.emphasisSeed,
    }),
    previous.length
      ? "The first reference is the current design: keep it and change only what the revision asks. The next reference is the contact sheet."
      : referencePaths.length > 1
        ? "The first reference is the contact sheet. The others are this brand's earlier posts: follow their design language (colours, type, frame style), never their photos."
        : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const background =
    process.env.IMAGE_DESIGN_LAYER_TRANSPARENT === "yes" ? ("transparent" as const) : undefined;
  return {
    prompt: basePrompt,
    references: [
      ...(await signAll(referencePaths, args.workspaceId)),
      ...args.tasteReferences,
    ].slice(0, 4),
    background,
    task: {
      assetIds: args.photos.map((photo) => photo.id),
      plan,
      readings: read.photos,
      referencePaths,
      attempts: 0,
      basePrompt,
      ...(background ? { background } : {}),
    },
  };
}

async function storeSheet(
  args: { workspaceId: string; jobId: string },
  photos: Awaited<ReturnType<typeof loadDesignPhotos>>,
  plan: PhotoDesignPlan,
): Promise<string> {
  const saved = await persistAsset({
    workspaceId: args.workspaceId,
    idempotencyKey: `photo-design-sheet:${args.jobId}`,
    bytes: await contactSheet(photos, plan.order),
    assetType: "image",
    mimeType: "image/jpeg",
    filename: `mellox-photo-sheet-${args.jobId.slice(0, 8)}`,
    metadata: { source: "studio_photo_design_sheet", job_id: args.jobId },
  });
  if (!saved.ok || !saved.asset.storage_path)
    throw new Error("Your photos could not be prepared for the design. Try again.");
  return saved.asset.storage_path;
}

/** Signed references for a design layer asked for again. */
export function photoDesignReferences(task: PhotoDesignTask, workspaceId: string) {
  return signAll(task.referencePaths, workspaceId);
}

export type FinishedPhotoDesign =
  | { state: "ready"; dataUrl: string }
  | { state: "retry"; prompt: string; reason: string }
  | { state: "failed"; reason: string };

/** Lay the real photos into a finished layer, or say what to ask for next. */
export async function finishPhotoDesign(args: {
  client: SupabaseClient;
  workspaceId: string;
  jobId: string;
  slot: string;
  taskId: string;
  layerDataUrl: string;
  task: PhotoDesignTask;
}): Promise<FinishedPhotoDesign> {
  const { task } = args;
  const layer = Buffer.from(args.layerDataUrl.split(",")[1] ?? "", "base64");
  const saved = await persistAsset({
    workspaceId: args.workspaceId,
    idempotencyKey: `photo-design-layer:${args.jobId}:${args.slot}:${args.taskId}`,
    bytes: layer,
    assetType: "image",
    mimeType: "image/png",
    filename: `mellox-photo-layer-${args.jobId.slice(0, 8)}`,
    metadata: { source: "studio_photo_design_layer", job_id: args.jobId },
  });
  if (saved.ok && saved.asset.storage_path) task.layerPath = saved.asset.storage_path;

  const references = await resolveStudioReferences(args.client, args.workspaceId, task.assetIds);
  const loaded = await loadDesignPhotos(args.client, references);
  // Screens are cut exactly as they were when the design was planned.
  const photos = await Promise.all(
    loaded.map((photo, i) =>
      task.plan.screens?.[task.plan.order.indexOf(i)] ? cropToScreen(photo) : photo,
    ),
  );
  const result = await composePhotoDesign({
    layer,
    photos,
    readings: task.readings,
    plan: task.plan,
  });
  if (result.ok)
    return { state: "ready", dataUrl: `data:image/png;base64,${result.png.toString("base64")}` };
  if (task.attempts < LAYER_RETRIES)
    return {
      state: "retry",
      reason: result.reason,
      prompt: `${task.basePrompt}\n\nThe last attempt was rejected: ${result.reason} ${result.feedback}`,
    };
  return { state: "failed", reason: result.reason };
}
