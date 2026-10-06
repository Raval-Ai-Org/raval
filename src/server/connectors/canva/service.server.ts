import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { encryptWithKey, decryptWithKey } from "@/server/crypto/secret-box.server";
import { isWorkspaceStoragePath } from "@/lib/workspace/storage-path";
import { ASSET_BUCKET, persistAsset } from "@/server/assets/persist.server";
import { safeFetch } from "@/server/safe-fetch";
import { mergeMeta } from "@/lib/content-lifecycle";
import { recordAudit } from "@/server/audit.server";
import { HttpError } from "@/server/http-error";
import { canvaConfig, canvaConfigured, CANVA_SCOPES } from "./config.server";
import { consumeCanvaState } from "./oauth.server";
import {
  tokenGrant,
  revokeCanvaToken,
  uploadImage,
  createDesign,
  getDesignEditUrl,
  createSingleImageDesign,
  importPptx,
  exportPngPages,
} from "./api.server";
import { buildCarouselPptx } from "./carousel-pptx.server";
import { validCanvaDownloadUrl } from "./download-url";

type Row = Record<string, unknown>;
const db = supabaseAdmin as unknown as SupabaseClient;
const refreshes = new Map<string, Promise<string>>();

function decryptCanvaToken(payload: string, key: Buffer) {
  try {
    return decryptWithKey(payload, key);
  } catch {
    throw new HttpError(409, "Canva credentials cannot be read. Reconnect Canva to continue.");
  }
}

async function connection(workspaceId: string) {
  const { data, error } = await db
    .from("workspace_connections")
    .select("id, status, account_login, updated_at")
    .eq("workspace_id", workspaceId)
    .eq("provider", "canva")
    .neq("status", "revoked")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error)
    throw new HttpError(503, "Canva connections are unavailable. Check the database migration.");
  return data as { id: string; status: string; account_login: string; updated_at: string } | null;
}

export async function canvaStatus(workspaceId: string) {
  const row = await connection(workspaceId);
  const configured = canvaConfigured();
  let status = row?.status ?? "disconnected";
  if (status === "active") {
    if (!configured) {
      status = "error";
    } else {
      const { data, error } = await db
        .from("canva_oauth_credentials")
        .select("access_token_enc, refresh_token_enc")
        .eq("connection_id", row!.id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (error)
        throw new HttpError(
          503,
          "Canva credentials are unavailable. Check the database migration.",
        );
      if (!data) status = "error";
      else {
        try {
          const { key } = canvaConfig();
          decryptWithKey(data.access_token_enc, key);
          decryptWithKey(data.refresh_token_enc, key);
        } catch {
          status = "error";
        }
      }
    }
  }
  return {
    configured,
    status,
    accountName: row?.account_login ?? null,
  };
}

export async function completeCanvaOAuth(args: {
  state: string;
  code: string;
  userId: string;
  authorize: (workspaceId: string) => Promise<void>;
}) {
  const txn = await consumeCanvaState(args.state, args.userId);
  await args.authorize(txn.workspaceId);
  const config = canvaConfig();
  const tokens = await tokenGrant({
    grant_type: "authorization_code",
    code: args.code,
    code_verifier: txn.verifier,
    redirect_uri: config.redirectUri,
  });
  const { data: prior } = await db
    .from("workspace_connections")
    .select("id")
    .eq("workspace_id", txn.workspaceId)
    .eq("provider", "canva")
    .eq("external_account_id", "workspace")
    .maybeSingle();
  const existing = prior as { id: string } | null;
  const values = {
    workspace_id: txn.workspaceId,
    provider: "canva",
    status: "active",
    external_account_id: "workspace",
    account_login: "Canva",
    verification: "oauth",
    connected_by: args.userId,
    revoked_at: null,
    last_error: null,
    permissions: { scopes: tokens.scope?.split(" ") ?? [...CANVA_SCOPES] },
    updated_at: new Date().toISOString(),
  };
  let connectionId = existing?.id;
  if (connectionId) {
    const { error } = await db
      .from("workspace_connections")
      .update(values)
      .eq("id", connectionId)
      .eq("workspace_id", txn.workspaceId);
    if (error) throw new HttpError(500, "Could not save Canva connection.");
  } else {
    const { data, error } = await db
      .from("workspace_connections")
      .insert(values)
      .select("id")
      .single();
    if (error || !data) throw new HttpError(500, "Could not save Canva connection.");
    connectionId = data.id;
  }
  const { error } = await db.from("canva_oauth_credentials").upsert(
    {
      connection_id: connectionId,
      workspace_id: txn.workspaceId,
      access_token_enc: encryptWithKey(tokens.access_token, config.key),
      refresh_token_enc: encryptWithKey(tokens.refresh_token, config.key),
      access_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      scopes: tokens.scope?.split(" ") ?? [...CANVA_SCOPES],
      updated_at: new Date().toISOString(),
    },
    { onConflict: "connection_id" },
  );
  if (error) throw new HttpError(500, "Could not save Canva credentials.");
  await recordAudit({
    workspaceId: txn.workspaceId,
    userId: args.userId,
    action: "connector.canva.connected",
    entity: "connector",
  });
  return { workspaceId: txn.workspaceId, returnPath: txn.returnPath };
}

async function freshToken(workspaceId: string) {
  const connected = await connection(workspaceId);
  if (!connected || connected.status !== "active")
    throw new HttpError(409, "Connect Canva to edit this image.");
  const { data, error: credentialsError } = await db
    .from("canva_oauth_credentials")
    .select("workspace_id, access_token_enc, refresh_token_enc, access_token_expires_at")
    .eq("connection_id", connected.id)
    .maybeSingle();
  if (credentialsError)
    throw new HttpError(503, "Canva credentials are unavailable. Check the database migration.");
  if (!data || data.workspace_id !== workspaceId)
    throw new HttpError(409, "Reconnect Canva to continue.");
  const config = canvaConfig();
  if (Date.parse(data.access_token_expires_at) > Date.now() + 60_000)
    return decryptCanvaToken(data.access_token_enc, config.key);
  const inFlight = refreshes.get(connected.id);
  if (inFlight) return inFlight;
  const refreshing = (async () => {
    try {
      const tokens = await tokenGrant({
        grant_type: "refresh_token",
        refresh_token: decryptCanvaToken(data.refresh_token_enc, config.key),
      });
      const { error } = await db
        .from("canva_oauth_credentials")
        .update({
          access_token_enc: encryptWithKey(tokens.access_token, config.key),
          refresh_token_enc: encryptWithKey(tokens.refresh_token, config.key),
          access_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("connection_id", connected.id)
        .eq("workspace_id", workspaceId);
      if (error) throw new HttpError(500, "Could not refresh Canva connection.");
      return tokens.access_token;
    } catch (error) {
      if (error instanceof HttpError && error.status !== 409) throw error;
      // Another server instance may already have consumed Canva's one-use refresh token.
      const { data: rotated } = await db
        .from("canva_oauth_credentials")
        .select("access_token_enc, access_token_expires_at")
        .eq("connection_id", connected.id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (
        rotated?.access_token_enc &&
        Date.parse(rotated.access_token_expires_at) > Date.now() + 60_000
      ) {
        return decryptCanvaToken(rotated.access_token_enc, config.key);
      }
      await db
        .from("workspace_connections")
        .update({ status: "error", last_error: "Reconnect Canva to continue." })
        .eq("id", connected.id);
      throw new HttpError(409, "Reconnect Canva to continue.");
    }
  })().finally(() => refreshes.delete(connected.id));
  refreshes.set(connected.id, refreshing);
  return refreshing;
}

export async function disconnectCanva(workspaceId: string, userId: string) {
  const row = await connection(workspaceId);
  if (!row) return;
  const { data } = await db
    .from("canva_oauth_credentials")
    .select("refresh_token_enc")
    .eq("connection_id", row.id)
    .maybeSingle();
  await db
    .from("canva_oauth_credentials")
    .delete()
    .eq("connection_id", row.id)
    .eq("workspace_id", workspaceId);
  await db
    .from("workspace_connections")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("workspace_id", workspaceId);
  if (data?.refresh_token_enc) {
    try {
      await revokeCanvaToken(decryptWithKey(data.refresh_token_enc, canvaConfig().key));
    } catch {
      /* local credentials removed */
    }
  }
  await recordAudit({
    workspaceId,
    userId,
    action: "connector.canva.disconnected",
    entity: "connector",
  });
}

async function sourceImages(workspaceId: string, source: { assetId?: string; contentId?: string }) {
  if (source.assetId) {
    const { data } = await db
      .from("assets")
      .select("id, storage_path, filename, asset_type, status, content_item_id")
      .eq("id", source.assetId)
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!data || data.asset_type !== "image" || data.status !== "ready" || !data.storage_path)
      throw new HttpError(404, "Image is unavailable.");
    return {
      ids: [data.id as string],
      paths: [data.storage_path as string],
      title: data.filename as string,
      contentId: (data.content_item_id as string | null) ?? null,
      meta: {} as Row,
    };
  }
  if (!source.contentId) throw new HttpError(400, "An asset or content item is required.");
  const { data: item } = await db
    .from("content_items")
    .select("id, title, meta, media_type, kind, workspace_id")
    .eq("id", source.contentId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!item) throw new HttpError(404, "Content is unavailable.");
  const meta = (item.meta && typeof item.meta === "object" ? item.meta : {}) as Row;
  let paths: unknown[];
  if (item.kind === "carousel" || meta.studio_type === "carousel") {
    const { ensureCarouselMedia } = await import("@/server/studio/carousel-assets.server");
    const current = await ensureCarouselMedia({
      id: item.id,
      workspace_id: workspaceId,
      kind: item.kind,
      meta: item.meta,
    });
    if (!current) throw new HttpError(404, "Carousel slides are unavailable.");
    paths = current;
  } else {
    paths = [meta.asset_storage_path];
  }
  if (
    !paths.length ||
    paths.some((p) => typeof p !== "string" || !isWorkspaceStoragePath(p, workspaceId))
  )
    throw new HttpError(404, "Stored slide images are unavailable.");
  const { data: assets } = await db
    .from("assets")
    .select("id, storage_path, asset_type, status")
    .eq("workspace_id", workspaceId)
    .in("storage_path", paths as string[])
    .is("deleted_at", null);
  const ordered = paths.map((path) => assets?.find((a) => a.storage_path === path));
  if (ordered.some((a) => !a || a.asset_type !== "image" || a.status !== "ready"))
    throw new HttpError(404, "A carousel slide is unavailable.");
  return {
    ids: ordered.map((a) => a!.id as string),
    paths: paths as string[],
    title: (item.title as string | null) ?? "Carousel",
    contentId: item.id as string,
    meta,
  };
}

async function createOrOpenCanvaEdit(args: {
  workspaceId: string;
  userId: string;
  assetId?: string;
  contentId?: string;
}) {
  const source = await sourceImages(args.workspaceId, args);
  const token = await freshToken(args.workspaceId);
  const grant = await connection(args.workspaceId);
  if (!grant) throw new HttpError(409, "Reconnect Canva to continue.");
  const sourceKey = createHash("sha256")
    .update(JSON.stringify([args.assetId, args.contentId, source.paths, grant.updated_at]))
    .digest("hex");
  const { data: existing } = await db
    .from("canva_design_mappings")
    .select("id, canva_design_id, mode")
    .eq("workspace_id", args.workspaceId)
    .eq("source_key", sourceKey)
    .maybeSingle();
  if (existing) {
    const editUrl = await getDesignEditUrl(token, existing.canva_design_id);
    const { data: fallbackRows } = await db
      .from("canva_fallback_slide_designs")
      .select("page_number, canva_design_id")
      .eq("mapping_id", existing.id)
      .eq("workspace_id", args.workspaceId)
      .order("page_number", { ascending: true });
    const slideDesigns = fallbackRows?.length
      ? await Promise.all(
          fallbackRows.map(async (row) => ({
            page: row.page_number as number,
            editUrl:
              row.page_number === 1 ? editUrl : await getDesignEditUrl(token, row.canva_design_id),
          })),
        )
      : [];
    await db
      .from("canva_design_mappings")
      .update({ last_opened_at: new Date().toISOString() })
      .eq("id", existing.id);
    return {
      editUrl,
      designId: existing.canva_design_id,
      slideCount: source.paths.length,
      multiPage: existing.mode === "design_import",
      mode: existing.mode as "magic_layers" | "flat_image" | "design_import",
      slideDesigns,
    };
  }
  const uploaded: string[] = [];
  let dimensions: { width: number; height: number } | null = null;
  for (const [i, path] of source.paths.entries()) {
    if (!isWorkspaceStoragePath(path, args.workspaceId))
      throw new HttpError(403, "Invalid asset path.");
    const { data, error } = await db.storage.from(ASSET_BUCKET).download(path);
    if (error || !data) throw new HttpError(404, "A stored image is unavailable.");
    const bytes = Buffer.from(await data.arrayBuffer());
    const info = await sharp(bytes)
      .metadata()
      .catch(() => null);
    if (
      !info?.width ||
      !info.height ||
      info.width < 40 ||
      info.height < 40 ||
      info.width > 8000 ||
      info.height > 8000 ||
      info.width * info.height > 25_000_000
    )
      throw new HttpError(422, "Image dimensions are not supported by Canva.");
    if (dimensions && (dimensions.width !== info.width || dimensions.height !== info.height))
      throw new HttpError(422, "Carousel slides must have matching dimensions.");
    dimensions = { width: info.width, height: info.height };
    uploaded.push(await uploadImage(token, bytes, `Mellox slide ${i + 1}`));
  }
  if (!dimensions) throw new HttpError(404, "No images to edit.");
  const { data: workspace } = await db
    .from("workspaces")
    .select("name")
    .eq("id", args.workspaceId)
    .maybeSingle();
  const title = `Mellox - ${workspace?.name ?? "Brand"} - ${source.title}`;
  let design: { id: string; editUrl: string } | undefined;
  let mode: "magic_layers" | "flat_image" | "design_import" = "flat_image";
  let multiPage = false;
  let slideDesigns: Array<{ page: number; editUrl: string; id: string }> = [];
  if (source.paths.length > 1) {
    const stored = source.meta.carousel as Record<string, unknown> | undefined;
    const slides = source.meta.slides;
    if (stored && Array.isArray(slides)) {
      try {
        const coverPath = stored.cover_path;
        let coverArt: Buffer | null = null;
        if (typeof coverPath === "string" && isWorkspaceStoragePath(coverPath, args.workspaceId)) {
          const { data: cover } = await db.storage.from(ASSET_BUCKET).download(coverPath);
          if (cover) coverArt = Buffer.from(await cover.arrayBuffer());
        }
        const pptx = await buildCarouselPptx(slides, stored as never, coverArt);
        const imported = await importPptx(token, pptx, title);
        if (imported.pageCount != null && imported.pageCount !== source.paths.length)
          throw new HttpError(502, "Canva imported an unexpected number of slides.");
        design = imported;
        mode = "design_import";
        multiPage = true;
      } catch {
        // The public Create Design flow remains available if presentation import fails.
      }
    }
  } else {
    const single = await createSingleImageDesign(token, {
      assetId: uploaded[0],
      ...dimensions,
      title,
    });
    design = single;
    mode = single.mode;
  }
  design ??= await createDesign(token, { assetId: uploaded[0], ...dimensions, title });
  if (source.paths.length > 1 && !multiPage) {
    slideDesigns = [{ page: 1, editUrl: design.editUrl, id: design.id }];
    for (let index = 1; index < uploaded.length; index++) {
      const slide = await createDesign(token, {
        assetId: uploaded[index],
        ...dimensions,
        title: `${title} - slide ${index + 1}`,
      });
      slideDesigns.push({ page: index + 1, editUrl: slide.editUrl, id: slide.id });
    }
  }
  const { data: mapping, error: mappingError } = await db
    .from("canva_design_mappings")
    .insert({
      workspace_id: args.workspaceId,
      content_item_id: source.contentId,
      asset_id: args.assetId ?? source.ids[0],
      source_key: sourceKey,
      canva_design_id: design.id,
      canva_asset_ids: uploaded,
      mode,
      title,
      created_by: args.userId,
    })
    .select("id")
    .single();
  if (mappingError || !mapping)
    throw new HttpError(500, "Canva design was created but could not be saved in Mellox.");
  const { error: pagesError } = await db.from("canva_design_source_pages").insert(
    source.ids.map((id, index) => ({
      mapping_id: mapping.id,
      workspace_id: args.workspaceId,
      page_number: index + 1,
      source_asset_id: id,
      canva_asset_id: uploaded[index],
    })),
  );
  if (pagesError) throw new HttpError(500, "Canva source pages could not be saved.");
  if (slideDesigns.length) {
    const { error } = await db.from("canva_fallback_slide_designs").insert(
      slideDesigns.map((slide) => ({
        mapping_id: mapping.id,
        workspace_id: args.workspaceId,
        page_number: slide.page,
        canva_design_id: slide.id,
      })),
    );
    if (error) throw new HttpError(500, "Canva slide designs could not be saved.");
  }
  await recordAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    action: "connector.canva.design_created",
    entity: "connector",
    payload: { designId: design.id, slideCount: uploaded.length },
  });
  return {
    editUrl: design.editUrl,
    designId: design.id,
    slideCount: uploaded.length,
    multiPage,
    mode,
    slideDesigns: slideDesigns.map(({ page, editUrl }) => ({ page, editUrl })),
  };
}

export async function editInCanva(args: {
  workspaceId: string;
  userId: string;
  assetId?: string;
  contentId?: string;
}) {
  try {
    return await createOrOpenCanvaEdit(args);
  } catch (error) {
    if (error instanceof HttpError && error.status === 409) {
      await db
        .from("workspace_connections")
        .update({ status: "error", last_error: "Reconnect Canva to continue." })
        .eq("workspace_id", args.workspaceId)
        .eq("provider", "canva")
        .eq("status", "active");
    }
    throw error;
  }
}

export async function canvaEditState(
  workspaceId: string,
  source: { assetId?: string; contentId?: string },
) {
  const query = db
    .from("canva_design_mappings")
    .select("id, mode, content_item_id, canva_design_id")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1);
  const { data: mapping } = await (
    source.contentId
      ? query.eq("content_item_id", source.contentId)
      : query.eq("asset_id", source.assetId ?? "")
  ).maybeSingle();
  if (!mapping) return { mappingId: null, mode: null, versionId: null, versionNumber: null };
  const { data: version } = await db
    .from("canva_import_versions")
    .select("id, version_number")
    .eq("mapping_id", mapping.id)
    .eq("workspace_id", workspaceId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    mappingId: mapping.id as string,
    mode: mapping.mode as string,
    versionId: (version?.id as string | undefined) ?? null,
    versionNumber: (version?.version_number as number | undefined) ?? null,
    canSelect: !!mapping.content_item_id,
  };
}

export async function importCanvaChanges(args: {
  workspaceId: string;
  userId: string;
  mappingId: string;
}) {
  const { data: mapping } = await db
    .from("canva_design_mappings")
    .select("id, canva_design_id, content_item_id, asset_id")
    .eq("id", args.mappingId)
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();
  if (!mapping) throw new HttpError(404, "Canva design is unavailable.");
  const token = await freshToken(args.workspaceId);
  const { data: fallback } = await db
    .from("canva_fallback_slide_designs")
    .select("page_number, canva_design_id")
    .eq("mapping_id", mapping.id)
    .eq("workspace_id", args.workspaceId)
    .order("page_number", { ascending: true });
  const urls = fallback?.length
    ? await Promise.all(
        fallback.map(async (slide) => {
          const pages = await exportPngPages(token, slide.canva_design_id);
          if (pages.length !== 1)
            throw new HttpError(422, "A Canva slide export has an unexpected page count.");
          return pages[0];
        }),
      )
    : await exportPngPages(token, mapping.canva_design_id);
  const { data: sources } = await db
    .from("canva_design_source_pages")
    .select("page_number, source_asset_id")
    .eq("mapping_id", mapping.id)
    .eq("workspace_id", args.workspaceId)
    .order("page_number", { ascending: true });
  const expected = sources?.length || 1;
  if (urls.length !== expected || urls.length > 30)
    throw new HttpError(
      422,
      "Canva returned an unexpected number of pages. The original remains unchanged.",
    );
  // Validate and download the entire export before persisting any version rows.
  const pages: Buffer[] = [];
  for (const url of urls) {
    if (!validCanvaDownloadUrl(url))
      throw new HttpError(502, "Canva returned an unsafe download link.");
    let bytes: Buffer;
    try {
      const response = await safeFetch(url, {
        timeoutMs: 30_000,
        maxBytes: 50 * 1024 * 1024,
        onOverflow: "error",
      });
      if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "image/png")
        throw new Error("Invalid export");
      bytes = Buffer.from(response.bytes);
    } catch {
      throw new HttpError(502, "Canva export could not be downloaded.");
    }
    const info = await sharp(bytes)
      .metadata()
      .catch(() => null);
    if (
      info?.format !== "png" ||
      !info.width ||
      !info.height ||
      info.width > 8000 ||
      info.height > 8000 ||
      info.width * info.height > 25_000_000
    )
      throw new HttpError(422, "Canva returned an invalid image.");
    pages.push(bytes);
  }
  const { data: last } = await db
    .from("canva_import_versions")
    .select("version_number")
    .eq("mapping_id", mapping.id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextNumber = (last?.version_number ?? 0) + 1;
  const versionId = crypto.randomUUID();
  const saved: Array<{ id: string; storage_path: string }> = [];
  try {
    for (const [index, bytes] of pages.entries()) {
      const parentAssetId =
        sources?.[index]?.source_asset_id ?? (index === 0 ? mapping.asset_id : null);
      const result = await persistAsset({
        workspaceId: args.workspaceId,
        idempotencyKey: `canva:${versionId}:${index + 1}`,
        dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
        assetType: "image",
        provider: "canva",
        parentAssetId,
        filename: `canva-version-${nextNumber}-page-${index + 1}.png`,
        metadata: {
          source: "canva",
          canva_design_id: mapping.canva_design_id,
          parent_asset_id: parentAssetId,
          parent_content_id: mapping.content_item_id,
          imported_at: new Date().toISOString(),
          imported_by: args.userId,
          page_number: index + 1,
        },
      });
      if (!result.ok || !result.asset.storage_path)
        throw new HttpError(
          502,
          "Canva version could not be saved. The original remains unchanged.",
        );
      saved.push({ id: result.asset.id, storage_path: result.asset.storage_path });
    }
    const { error: versionError } = await db.from("canva_import_versions").insert({
      id: versionId,
      workspace_id: args.workspaceId,
      mapping_id: mapping.id,
      version_number: nextNumber,
      imported_by: args.userId,
    });
    if (versionError) throw new HttpError(500, "Canva version could not be recorded.");
    const { error: pageError } = await db.from("canva_import_pages").insert(
      saved.map((asset, index) => ({
        version_id: versionId,
        workspace_id: args.workspaceId,
        page_number: index + 1,
        asset_id: asset.id,
      })),
    );
    if (pageError) throw new HttpError(500, "Canva pages could not be recorded.");
  } catch (error) {
    // An incomplete carousel never becomes a selectable version or publishing source.
    await db
      .from("canva_import_versions")
      .delete()
      .eq("id", versionId)
      .eq("workspace_id", args.workspaceId);
    if (saved.length) {
      await db.storage.from(ASSET_BUCKET).remove(saved.map((asset) => asset.storage_path));
      await db
        .from("assets")
        .delete()
        .eq("workspace_id", args.workspaceId)
        .in(
          "id",
          saved.map((asset) => asset.id),
        );
    }
    throw error;
  }
  await db
    .from("canva_design_mappings")
    .update({ last_imported_at: new Date().toISOString() })
    .eq("id", mapping.id)
    .eq("workspace_id", args.workspaceId);
  await recordAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    action: "connector.canva.version_imported",
    entity: "connector",
    payload: { mappingId: mapping.id, versionId, pageCount: saved.length },
  });
  return {
    versionId,
    versionNumber: nextNumber,
    pageCount: saved.length,
    canSelect: !!mapping.content_item_id,
  };
}

export async function selectCanvaVersion(args: {
  workspaceId: string;
  userId: string;
  versionId: string;
}) {
  const { data: version } = await db
    .from("canva_import_versions")
    .select("id, mapping_id, selected_at")
    .eq("id", args.versionId)
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();
  if (!version) throw new HttpError(404, "Canva version is unavailable.");
  const { data: mapping } = await db
    .from("canva_design_mappings")
    .select("content_item_id")
    .eq("id", version.mapping_id)
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();
  if (!mapping?.content_item_id)
    throw new HttpError(422, "This asset has no content item to update.");
  const { data: item } = await db
    .from("content_items")
    .select("id, status, kind, meta")
    .eq("id", mapping.content_item_id)
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();
  if (!item) throw new HttpError(404, "Content is unavailable.");
  if (["scheduled", "publishing", "published"].includes(item.status))
    throw new HttpError(409, "Scheduled or published content cannot be changed here.");
  const { data: pageRows } = await db
    .from("canva_import_pages")
    .select("page_number, asset_id")
    .eq("version_id", version.id)
    .eq("workspace_id", args.workspaceId)
    .order("page_number", { ascending: true });
  if (!pageRows?.length) throw new HttpError(404, "Canva version has no pages.");
  const { data: assets } = await db
    .from("assets")
    .select("id, storage_path, status")
    .eq("workspace_id", args.workspaceId)
    .in(
      "id",
      pageRows.map((p) => p.asset_id),
    )
    .is("deleted_at", null);
  const ordered = pageRows.map((page) => assets?.find((a) => a.id === page.asset_id));
  if (ordered.some((asset) => !asset || asset.status !== "ready" || !asset.storage_path))
    throw new HttpError(404, "A Canva version page is unavailable.");
  const paths = ordered.map((asset) => asset!.storage_path as string);
  const meta = item.meta as Record<string, unknown> | null;
  const patch: Record<string, unknown> = {
    asset_id: pageRows[0].asset_id,
    asset_storage_path: paths[0],
    asset_status: "ready",
    media_type: "image",
    canva_selected_version_id: version.id,
  };
  if (paths.length > 1) patch.asset_storage_paths = paths;
  const { error } = await db
    .from("content_items")
    .update({
      meta: mergeMeta(meta, patch),
      media_url: null,
      status: ["approved", "pending"].includes(item.status) ? "draft" : item.status,
    })
    .eq("id", item.id)
    .eq("workspace_id", args.workspaceId);
  if (error) throw new HttpError(500, "Could not select Canva version.");
  await db
    .from("canva_import_versions")
    .update({ selected_at: new Date().toISOString() })
    .eq("id", version.id)
    .eq("workspace_id", args.workspaceId);
  await recordAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    action: "connector.canva.version_selected",
    entity: "connector",
    payload: { versionId: version.id, contentId: item.id },
  });
  return { selected: true };
}
