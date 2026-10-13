import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HttpError } from "@/server/http-error";
import type { WorkspaceRole } from "@/server/api-auth";
import { signStoragePath } from "@/server/assets/storage.server";
import { isWorkspaceStoragePath } from "@/lib/workspace/storage-path";
import {
  ProfileSchema,
  directionRules,
  selectReferences,
  referenceFitsFormat,
  visualFeedbackRules,
  type CaptureJob,
  type ProfileRow,
  type VisualProfile,
  type VisualSource,
  type VisualSnapshot,
  type VisualView,
} from "@/lib/brand-visuals/contracts";
import { assertPublicUrl } from "@/server/safe-fetch";

const db = supabaseAdmin as unknown as SupabaseClient;
export type VisualCaller = { workspaceId: string; userId: string; role: WorkspaceRole };
const table = (name: string) => db.from(name);
const checked = <T>(result: { data: T; error: { message: string } | null }): T => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
};
function editor(c: VisualCaller) {
  if (c.role === "viewer")
    throw new HttpError(403, "You need edit access to change the brand's look.");
}

export async function invalidateVisualLook(workspaceId: string) {
  const [{ invalidateLookCache }, { invalidateStudioContext }] = await Promise.all([
    import("@/server/brand-look/resolve.server"),
    import("@/server/studio/context.server"),
  ]);
  invalidateLookCache(workspaceId);
  invalidateStudioContext(workspaceId);
}

export async function readSources(
  workspaceId: string,
  includeRemoved = false,
  sourceIds?: string[],
): Promise<VisualSource[]> {
  if (sourceIds && !sourceIds.length) return [];
  let query = table("brand_visual_sources").select("*").eq("workspace_id", workspaceId);
  if (sourceIds) query = query.in("id", sourceIds);
  if (!includeRemoved) query = query.neq("status", "removed");
  const sources = checked(
    await query.order("created_at", { ascending: false }).limit(250),
  ) as VisualSource[];
  if (!sources.length) return [];
  const assets = checked(
    await table("assets")
      .select("id,storage_path,mime_type,thumbnail_path")
      .eq("workspace_id", workspaceId)
      .eq("status", "ready")
      .is("deleted_at", null)
      .in(
        "id",
        sources.map((s) => s.asset_id),
      ),
  ) as { id: string; storage_path: string; mime_type: string; thumbnail_path?: string | null }[];
  const owned = new Map(
    assets
      .filter((a) => a.storage_path && isWorkspaceStoragePath(a.storage_path, workspaceId))
      .map((a) => [a.id, a]),
  );
  return sources.flatMap((source) => {
    const asset = owned.get(source.asset_id);
    return asset ? [{ ...source, asset }] : [];
  });
}

export async function getVisualView(c: VisualCaller): Promise<VisualView> {
  try {
    const [rawProfiles, settings, sources, jobs, feedback] = await Promise.all([
      table("brand_visual_profiles")
        .select("*")
        .eq("workspace_id", c.workspaceId)
        .order("created_at", { ascending: false })
        .limit(15),
      table("brand_visual_settings")
        .select("active_profile_id")
        .eq("workspace_id", c.workspaceId)
        .maybeSingle(),
      readSources(c.workspaceId, true),
      table("brand_visual_capture_jobs")
        .select("*")
        .eq("workspace_id", c.workspaceId)
        .order("created_at", { ascending: false })
        .limit(5),
      table("brand_visual_feedback")
        .select("reason")
        .eq("workspace_id", c.workspaceId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    const profiles = (checked(rawProfiles) as ProfileRow[]).flatMap((row) => {
      const parsed = ProfileSchema.safeParse(row.profile);
      return parsed.success ? [{ ...row, profile: parsed.data }] : [];
    });
    const activeId = checked(settings)?.active_profile_id ?? null;
    if (activeId && !profiles.some((p) => p.id === activeId)) {
      const active = checked(
        await table("brand_visual_profiles")
          .select("*")
          .eq("workspace_id", c.workspaceId)
          .eq("id", activeId)
          .eq("status", "approved")
          .maybeSingle(),
      ) as ProfileRow | null;
      const parsed = ProfileSchema.safeParse(active?.profile);
      if (active && parsed.success) profiles.push({ ...active, profile: parsed.data });
    }
    const active = profiles.find((p) => p.id === activeId);
    const missingIds =
      active?.profile.directions[active.profile.selected]?.sourceIds.filter(
        (id) => !sources.some((s) => s.id === id),
      ) ?? [];
    if (missingIds.length) sources.push(...(await readSources(c.workspaceId, true, missingIds)));
    const signed = await Promise.all(
      sources.map(async (source) => ({
        ...source,
        asset: source.asset
          ? {
              ...source.asset,
              url: (await signStoragePath(db, source.asset.storage_path, 600)) ?? undefined,
              thumbnailUrl:
                source.asset.thumbnail_path &&
                isWorkspaceStoragePath(source.asset.thumbnail_path, c.workspaceId)
                  ? ((await signStoragePath(db, source.asset.thumbnail_path, 600)) ?? undefined)
                  : undefined,
            }
          : undefined,
      })),
    );
    const counts = new Map<string, number>();
    for (const row of checked(feedback) ?? [])
      counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
    return {
      available: true,
      canEdit: c.role !== "viewer",
      activeId,
      profiles,
      sources: signed,
      jobs: checked(jobs) as CaptureJob[],
      feedback: [...counts].map(([reason, count]) => ({ reason, count })),
    };
  } catch (error) {
    if (/does not exist|schema cache/i.test(error instanceof Error ? error.message : ""))
      return {
        available: false,
        canEdit: false,
        activeId: null,
        profiles: [],
        sources: [],
        jobs: [],
        feedback: [],
      };
    throw error;
  }
}

export async function startVisualCapture(
  c: VisualCaller,
  args: { url: string; idempotencyKey: string; maxPages: number },
) {
  editor(c);
  const url = assertPublicUrl(args.url).href;
  const existing = checked(
    await table("brand_visual_capture_jobs")
      .select("*")
      .eq("workspace_id", c.workspaceId)
      .eq("idempotency_key", args.idempotencyKey)
      .maybeSingle(),
  );
  if (existing) return existing as CaptureJob;
  const active = checked(
    await table("brand_visual_capture_jobs")
      .select("id")
      .eq("workspace_id", c.workspaceId)
      .in("status", ["queued", "running"])
      .limit(1),
  );
  if (active?.length) throw new HttpError(409, "A website scan is already running.");
  return checked(
    await table("brand_visual_capture_jobs")
      .insert({
        workspace_id: c.workspaceId,
        created_by: c.userId,
        url,
        idempotency_key: args.idempotencyKey,
        max_pages: args.maxPages,
        pages: [url],
      })
      .select("*")
      .single(),
  ) as CaptureJob;
}

export async function addVisualSource(
  c: VisualCaller,
  args: {
    assetId: string;
    label: string;
    purpose: VisualSource["purpose"];
    notes: string;
    formats: string[];
    campaign?: string;
    kind?: "upload" | "library";
    sourceUrl?: string;
  },
) {
  editor(c);
  const asset = checked(
    await table("assets")
      .select("id,storage_path,mime_type")
      .eq("id", args.assetId)
      .eq("workspace_id", c.workspaceId)
      .eq("status", "ready")
      .is("deleted_at", null)
      .maybeSingle(),
  );
  if (
    !asset ||
    !isWorkspaceStoragePath(asset.storage_path ?? "", c.workspaceId) ||
    !/^(image|video)\//.test(asset.mime_type ?? "")
  )
    throw new HttpError(404, "Choose an image or video from this brand's library.");
  const total = checked(
    await table("brand_visual_sources")
      .select("id,asset_id")
      .eq("workspace_id", c.workspaceId)
      .neq("kind", "website")
      .neq("status", "removed"),
  );
  if ((total?.length ?? 0) >= 80 && !total?.some((s) => s.asset_id === asset.id))
    throw new HttpError(409, "Remove an unused reference before adding another.");
  checked(
    await table("brand_visual_sources").upsert(
      {
        workspace_id: c.workspaceId,
        asset_id: asset.id,
        kind: args.kind ?? "library",
        source_url: args.sourceUrl ?? null,
        label: args.label,
        purpose: args.purpose,
        notes: args.notes,
        formats: args.formats,
        campaign: args.campaign ?? null,
        status: "approved",
      },
      { onConflict: "workspace_id,asset_id" },
    ),
  );
  await invalidateVisualLook(c.workspaceId);
}

export async function changeVisualSource(
  c: VisualCaller,
  args: {
    id: string;
    status: VisualSource["status"];
    notes?: string;
    purpose?: VisualSource["purpose"];
  },
) {
  editor(c);
  const source = checked(
    await table("brand_visual_sources")
      .select("asset_id")
      .eq("workspace_id", c.workspaceId)
      .eq("id", args.id)
      .maybeSingle(),
  );
  if (!source) throw new HttpError(404, "This reference is no longer available.");
  const children = checked(
    await table("assets")
      .select("id")
      .eq("workspace_id", c.workspaceId)
      .eq("parent_asset_id", source.asset_id),
  );
  checked(
    await table("brand_visual_sources")
      .update({
        status: args.status,
        ...(args.notes !== undefined ? { notes: args.notes } : {}),
        ...(args.purpose ? { purpose: args.purpose } : {}),
      })
      .eq("id", args.id)
      .eq("workspace_id", c.workspaceId),
  );
  // A clip and its sampled frames are one reference for removal/restore.
  if (children?.length)
    checked(
      await table("brand_visual_sources")
        .update({
          status: args.status,
          ...(args.notes !== undefined ? { notes: args.notes } : {}),
          ...(args.purpose ? { purpose: args.purpose } : {}),
        })
        .eq("workspace_id", c.workspaceId)
        .in(
          "asset_id",
          children.map((a) => a.id),
        ),
    );
  await invalidateVisualLook(c.workspaceId);
}

export async function startReferenceAnalysis(c: VisualCaller, key: string) {
  editor(c);
  if (
    !(await readSources(c.workspaceId)).some(
      (s) => s.status === "approved" && s.asset?.mime_type.startsWith("image/"),
    )
  )
    throw new HttpError(409, "Add an image reference first.");
  const existing = checked(
    await table("brand_visual_capture_jobs")
      .select("*")
      .eq("workspace_id", c.workspaceId)
      .eq("idempotency_key", key)
      .maybeSingle(),
  );
  if (existing) return existing as CaptureJob;
  const active = checked(
    await table("brand_visual_capture_jobs")
      .select("id")
      .eq("workspace_id", c.workspaceId)
      .in("status", ["queued", "running"])
      .limit(1),
  );
  if (active?.length) throw new HttpError(409, "A visual scan is already running.");
  return checked(
    await table("brand_visual_capture_jobs")
      .insert({
        workspace_id: c.workspaceId,
        created_by: c.userId,
        idempotency_key: key,
        url: "",
        mode: "references",
        pages: [],
        stage: "analysing",
      })
      .select("*")
      .single(),
  ) as CaptureJob;
}

/** Save an immutable version. Confirmation is an explicit user action. */
export async function saveVisualProfile(
  c: VisualCaller,
  args: {
    profile: VisualProfile;
    expectedActiveId: string | null;
    confirm: boolean;
    restoreId?: string;
  },
) {
  editor(c);
  const profile = ProfileSchema.parse(args.profile);
  if (!profile.directions[profile.selected]) throw new HttpError(400, "Choose a visual direction.");
  const sources = await readSources(c.workspaceId);
  const own = new Set(sources.map((s) => s.id));
  if (
    profile.directions.some((d) => d.sourceIds.some((id) => !own.has(id))) ||
    profile.observations.some((o) => o.sourceIds.some((id) => !own.has(id)))
  )
    throw new HttpError(409, "A reference is no longer available. Refresh your look.");
  let id = args.restoreId;
  if (id) {
    const existing = checked(
      await table("brand_visual_profiles")
        .select("id,status")
        .eq("id", id)
        .eq("workspace_id", c.workspaceId)
        .maybeSingle(),
    );
    if (!existing || existing.status !== "approved")
      throw new HttpError(404, "That approved direction is no longer available.");
  } else {
    const row = checked(
      await table("brand_visual_profiles")
        .insert({ workspace_id: c.workspaceId, created_by: c.userId, profile, status: "candidate" })
        .select("id")
        .single(),
    );
    if (!row) throw new Error("The direction could not be saved.");
    id = row.id;
  }
  if (args.confirm) {
    const result = await db.rpc("activate_brand_visual_profile", {
      p_workspace: c.workspaceId,
      p_profile: id,
      p_expected: args.expectedActiveId,
    });
    if (result.error)
      throw new HttpError(
        409,
        "The brand's direction changed. Refresh before applying this version.",
      );
    await invalidateVisualLook(c.workspaceId);
  }
  return id!;
}

export async function recordVisualFeedback(
  c: VisualCaller,
  args: { jobId: string; reason: string; note: string },
) {
  editor(c);
  const job = checked(
    await table("studio_jobs")
      .select("output")
      .eq("id", args.jobId)
      .eq("workspace_id", c.workspaceId)
      .maybeSingle(),
  );
  if (!job) throw new HttpError(404, "This creation is no longer available.");
  const output = job.output as { visualTaste?: VisualSnapshot };
  const snapshot = output?.visualTaste;
  // The source set is the saved generation's, never caller-supplied IDs.
  const result = await table("brand_visual_feedback").upsert(
    {
      workspace_id: c.workspaceId,
      job_id: args.jobId,
      created_by: c.userId,
      reason: args.reason,
      note: args.note,
      created_at: new Date().toISOString(),
      profile_id: snapshot?.profileId ?? null,
      source_ids: snapshot?.references?.map((r) => r.sourceId) ?? [],
    },
    { onConflict: "workspace_id,job_id,created_by" },
  );
  if (result.error) {
    console.error("[visual-taste] feedback save failed", result.error);
    throw new HttpError(
      503,
      "Your feedback could not be saved right now. Please try again in a moment.",
    );
  }
}

/** Feedback also applies to brands using the manual look, without an approved profile. */
export async function loadVisualFeedbackRules(workspaceId: string): Promise<string> {
  try {
    const feedback = checked(
      await table("brand_visual_feedback")
        .select("reason,note")
        .eq("workspace_id", workspaceId)
        .is("profile_id", null)
        .order("created_at", { ascending: false })
        .limit(100),
    );
    return visualFeedbackRules(feedback ?? []);
  } catch (error) {
    console.warn("[visual-taste] feedback unavailable", error);
    return "";
  }
}

export async function restoreManualVisualLook(c: VisualCaller, expectedActiveId: string | null) {
  editor(c);
  const result = await db.rpc("use_manual_visual_look", {
    p_workspace: c.workspaceId,
    p_expected: expectedActiveId,
  });
  if (result.error)
    throw new HttpError(409, "The brand's direction changed. Refresh before changing it.");
  await invalidateVisualLook(c.workspaceId);
}

export async function editVisualArtwork(
  c: VisualCaller,
  args: { jobId: string; headline: string },
) {
  editor(c);
  const job = checked(
    await table("studio_jobs")
      .select("id,output,content_item_ids,type,provider_tasks")
      .eq("workspace_id", c.workspaceId)
      .eq("id", args.jobId)
      .eq("status", "succeeded")
      .single(),
  );
  if (!job) throw new HttpError(404, "This image is no longer available.");
  const output = job.output as import("@/lib/studio/jobs").StudioJobOutput;
  if (
    !output.visualTaste ||
    !output.artwork?.artStoragePath ||
    !isWorkspaceStoragePath(output.artwork.artStoragePath, c.workspaceId)
  )
    throw new HttpError(409, "This image does not have editable text layers.");
  const rows = checked(
    await table("content_items")
      .select("id,status,meta")
      .eq("workspace_id", c.workspaceId)
      .in("id", job.content_item_ids),
  );
  if (!rows?.length || rows.some((r) => !["draft", "pending", "approved"].includes(r.status)))
    throw new HttpError(
      409,
      "This image has been scheduled or published. Create a new version to edit it.",
    );
  const [
    { downloadAssetObject },
    { composeVisualArtwork },
    { persistAsset },
    { overlayBrandLogo },
  ] = await Promise.all([
    import("@/server/assets/storage.server"),
    import("./compose.server"),
    import("@/server/assets/persist.server"),
    import("@/server/studio/logo-overlay.server"),
  ]);
  const art = await downloadAssetObject(db, output.artwork.artStoragePath);
  if (art.error || !art.data) throw new Error("The original artwork could not be opened.");
  const ratio = output.media?.find((m) => m.slot === "main")?.ratio ?? "1:1";
  const compositionWarnings: string[] = [];
  let bytes = await composeVisualArtwork({
    art: Buffer.from(await art.data.arrayBuffer()),
    snapshot: output.visualTaste,
    headline: args.headline,
    brandName: output.artwork.brandName,
    ratio,
    onWarning: (message) => compositionWarnings.push(message),
  });
  const tasks = job.provider_tasks as Array<{
    slot: string;
    logo?: { url: string; corner: import("@/server/studio/logo-overlay.server").LogoCorner };
  }> | null;
  const logo = tasks?.find((t) => t.slot === "main")?.logo;
  if (logo) {
    const composited = await overlayBrandLogo(
      `data:image/jpeg;base64,${bytes.toString("base64")}`,
      logo.url,
      logo.corner,
    );
    bytes = Buffer.from(composited.split(",")[1], "base64");
  }
  bytes = await (await import("sharp")).default(bytes).png().toBuffer();
  const saved = await persistAsset({
    workspaceId: c.workspaceId,
    idempotencyKey: `visual-edit:${args.jobId}:${crypto.randomUUID()}`,
    bytes,
    assetType: "image",
    mimeType: "image/png",
    metadata: {
      source: "visual_composition",
      job_id: job.id,
      profile_id: output.visualTaste.profileId,
    },
  });
  if (!saved.ok || !saved.asset.storage_path)
    throw new Error("The edited image could not be saved.");
  const next = {
    ...output,
    warnings: [...new Set([...(output.warnings ?? []), ...compositionWarnings])],
    artwork: { ...output.artwork, headline: args.headline },
    media: output.media?.map((m) =>
      m.slot === "main"
        ? { ...m, assetId: saved.asset.id, storagePath: saved.asset.storage_path, url: undefined }
        : m,
    ),
  };
  const replaced = await db.rpc("replace_visual_artwork", {
    p_workspace: c.workspaceId,
    p_job: job.id,
    p_expected: output,
    p_output: next,
    p_asset: saved.asset.id,
    p_headline: args.headline,
  });
  if (replaced.error)
    throw new HttpError(409, "This post changed while the image was edited. Refresh to continue.");
}

/** Optional generation layer: an unavailable evidence store never replaces the original flow. */
export async function loadGenerationVisualSnapshot(
  workspaceId: string,
  format: string,
  campaign?: string,
): Promise<VisualSnapshot | null> {
  try {
    return await compileVisualSnapshot(workspaceId, format, campaign);
  } catch (error) {
    console.warn("[visual-taste] evidence unavailable; using existing generation", error);
    return null;
  }
}

export async function compileVisualSnapshot(
  workspaceId: string,
  format: string,
  campaign?: string,
): Promise<VisualSnapshot | null> {
  const settings = await table("brand_visual_settings")
    .select("active_profile_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (settings.error) {
    if (/does not exist|schema cache/i.test(settings.error.message)) return null;
    throw new Error("The approved visual direction could not be loaded.");
  }
  if (!settings.data?.active_profile_id) return null;
  const row = checked(
    await table("brand_visual_profiles")
      .select("id,profile")
      .eq("id", settings.data.active_profile_id)
      .eq("workspace_id", workspaceId)
      .eq("status", "approved")
      .single(),
  );
  if (!row) throw new Error("The approved direction could not be loaded.");
  const profile = ProfileSchema.parse(row.profile);
  const direction = profile.directions[profile.selected];
  if (!direction) throw new Error("The approved direction is incomplete.");
  const [sources, feedback] = await Promise.all([
    readSources(workspaceId),
    table("brand_visual_feedback")
      .select("source_ids,reason,note")
      .eq("workspace_id", workspaceId)
      .or(`profile_id.eq.${row.id},profile_id.is.null`)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const pinned = await readSources(
    workspaceId,
    false,
    direction.sourceIds.filter((id) => !sources.some((s) => s.id === id)),
  );
  sources.push(...pinned);
  const weights: Record<string, number> = {};
  const seen: Record<string, number> = {};
  for (const f of checked(feedback) ?? [])
    for (const id of f.source_ids ?? []) {
      seen[id] = (seen[id] ?? 0) + 1;
      if (f.reason === "matches") weights[id] = (weights[id] ?? 0) + 1;
      else if (f.reason === "wrong-theme") weights[id] = (weights[id] ?? 0) - 1;
    }
  for (const id of Object.keys(weights)) if ((seen[id] ?? 0) < 3) delete weights[id];
  const selected = selectReferences(sources, {
    format,
    campaign,
    selectedIds: direction.sourceIds,
    weights,
  });
  return {
    profileId: row.id,
    direction,
    rules: [
      directionRules(direction, profile.observations),
      visualFeedbackRules(checked(feedback) ?? []),
      ...sources
        .filter(
          (s) =>
            s.purpose === "avoid" &&
            s.status === "approved" &&
            s.notes.trim() &&
            (!s.campaign || s.campaign === campaign) &&
            referenceFitsFormat(s.formats, format),
        )
        .slice(0, 4)
        .map((s) => `User's avoid instruction: ${s.notes}`),
    ].join("\n"),
    references: selected.map((s) => ({
      sourceId: s.id,
      assetId: s.asset_id,
      storagePath: s.asset!.storage_path,
      purpose: s.purpose,
    })),
    warnings: direction.sourceIds.some(
      (id) => !sources.some((s) => s.id === id && s.status === "approved"),
    )
      ? ["Some approved references were removed. The current brand rules are still applied."]
      : [],
  };
}

export async function resolveVisualReferenceUrls(
  workspaceId: string,
  snapshot: VisualSnapshot | null,
): Promise<string[]> {
  if (!snapshot?.references.length) return [];
  try {
    // Re-check active ownership/removal on every submit and retry. Signed URLs are never persisted.
    const sources = await readSources(
      workspaceId,
      false,
      snapshot.references.map((r) => r.sourceId),
    );
    const valid = new Map(sources.filter((s) => s.status === "approved").map((s) => [s.id, s]));
    const urls = await Promise.all(
      snapshot.references.flatMap((r) => {
        const s = valid.get(r.sourceId);
        return s?.asset_id === r.assetId && s.asset?.storage_path === r.storagePath
          ? [signStoragePath(db, r.storagePath, 3600)]
          : [];
      }),
    );
    return urls.filter((url): url is string => !!url);
  } catch (error) {
    // Optional style evidence must never discard an otherwise valid/paid render.
    console.warn("[visual-taste] reference images unavailable; retaining saved brand rules", error);
    return [];
  }
}
