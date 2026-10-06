import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { encryptWithKey, decryptWithKeys } from "@/server/crypto/secret-box.server";
import { isWorkspaceStoragePath } from "@/lib/workspace/storage-path";
import { ASSET_BUCKET, persistAsset } from "@/server/assets/persist.server";
import { safeFetch } from "@/server/safe-fetch";
import { mergeMeta } from "@/lib/content-lifecycle";
import { recordAudit } from "@/server/audit.server";
import { HttpError } from "@/server/http-error";
import {
  canvaConfig,
  canvaConfigured,
  canvaConfigurationMessage,
  canvaMagicLayersEnabled,
  CANVA_SCOPES,
} from "./config.server";
import { consumeCanvaState } from "./oauth.server";
import {
  tokenGrant,
  revokeCanvaToken,
  uploadImage,
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

function decryptCanvaToken(payload: string, keys: readonly Buffer[]) {
  try {
    return decryptWithKeys(payload, keys);
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
          const { readKeys } = canvaConfig();
          decryptWithKeys(data.access_token_enc, readKeys);
          decryptWithKeys(data.refresh_token_enc, readKeys);
        } catch {
          status = "error";
        }
      }
    }
  }
  return {
    configured,
    configurationMessage: configured ? null : canvaConfigurationMessage(),
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

export async function canvaAccessToken(workspaceId: string) {
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
    return decryptCanvaToken(data.access_token_enc, config.readKeys);
  const inFlight = refreshes.get(connected.id);
  if (inFlight) return inFlight;
  const refreshing = (async () => {
    try {
      const tokens = await tokenGrant({
        grant_type: "refresh_token",
        refresh_token: decryptCanvaToken(data.refresh_token_enc, config.readKeys),
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
        return decryptCanvaToken(rotated.access_token_enc, config.readKeys);
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
      await revokeCanvaToken(decryptWithKeys(data.refresh_token_enc, canvaConfig().readKeys));
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

type Mode = "magic_layers" | "flat_image" | "design_import";
type Page = { id: string; storage_path: string };
type Mapping = {
  id: string;
  canva_design_id: string;
  mode: Mode;
  content_item_id: string | null;
  asset_id: string | null;
  source_key: string;
};
const MAPPING_COLS = "id, canva_design_id, mode, content_item_id, asset_id, source_key";
/** Bumped when designs are built differently, so an older flat design is not reused. */
const SOURCE_VERSION = "editable-2";
const LOCKED = ["scheduled", "publishing", "published", "partial_failed"];

/** Canva limits each person's requests per minute, so work goes a few at a time. */
async function inBatches<T, R>(
  items: T[],
  size: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(...(await Promise.all(items.slice(i, i + size).map((item, j) => run(item, i + j)))));
  return out;
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
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
    let contentId = (data.content_item_id as string | null) ?? null;
    if (source.contentId) {
      const { data: item } = await db
        .from("content_items")
        .select("id")
        .eq("id", source.contentId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (item) contentId = item.id as string;
    }
    return {
      ids: [data.id as string],
      paths: [data.storage_path as string],
      title: data.filename as string,
      contentId,
      meta: {} as Row,
    };
  }
  if (!source.contentId) throw new HttpError(400, "An asset or content item is required.");
  const { data: item } = await db
    .from("content_items")
    .select("id, title, meta, kind, workspace_id")
    .eq("id", source.contentId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!item) throw new HttpError(404, "Content is unavailable.");
  const meta = record(item.meta);
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
  } else if (Array.isArray(meta.asset_storage_paths) && meta.asset_storage_paths.length > 1) {
    // A Story: every frame, in order.
    paths = meta.asset_storage_paths;
  } else {
    paths = [meta.asset_storage_path];
  }
  if (
    !paths.length ||
    paths.length > 30 ||
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

/**
 * The Canva design an image belongs to: the one it was brought back from, or
 * the newest one made from it. Looking it up by the image (not by the post)
 * means a post that got a new picture never offers the old picture's design.
 */
async function mappingForAsset(workspaceId: string, assetId: string) {
  const { data: page } = await db
    .from("canva_import_pages")
    .select("version_id")
    .eq("workspace_id", workspaceId)
    .eq("asset_id", assetId)
    .limit(1)
    .maybeSingle();
  if (page) {
    const { data: version } = await db
      .from("canva_import_versions")
      .select("id, mapping_id, version_number")
      .eq("id", page.version_id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (version) {
      const { data: mapping } = await db
        .from("canva_design_mappings")
        .select(MAPPING_COLS)
        .eq("id", version.mapping_id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (mapping)
        return {
          mapping: mapping as Mapping,
          version: { id: version.id as string, number: version.version_number as number },
        };
    }
  }
  const { data: pages } = await db
    .from("canva_design_source_pages")
    .select("mapping_id")
    .eq("workspace_id", workspaceId)
    .eq("source_asset_id", assetId);
  if (!pages?.length) return null;
  const { data: mapping } = await db
    .from("canva_design_mappings")
    .select(MAPPING_COLS)
    .eq("workspace_id", workspaceId)
    .in(
      "id",
      pages.map((p) => p.mapping_id),
    )
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return mapping ? { mapping: mapping as Mapping, version: null } : null;
}

async function slideDesignRows(workspaceId: string, mappingId: string) {
  const { data } = await db
    .from("canva_fallback_slide_designs")
    .select("page_number, canva_design_id")
    .eq("mapping_id", mappingId)
    .eq("workspace_id", workspaceId)
    .order("page_number", { ascending: true });
  return (data ?? []) as Array<{ page_number: number; canva_design_id: string }>;
}

async function openExisting(workspaceId: string, token: string, mapping: Mapping, pages: number) {
  const editUrl = await getDesignEditUrl(token, mapping.canva_design_id);
  const rows = await slideDesignRows(workspaceId, mapping.id);
  const slideDesigns = await inBatches(rows, 3, async (row) => ({
    page: row.page_number,
    editUrl: row.page_number === 1 ? editUrl : await getDesignEditUrl(token, row.canva_design_id),
  }));
  await db
    .from("canva_design_mappings")
    .update({ last_opened_at: new Date().toISOString() })
    .eq("id", mapping.id)
    .eq("workspace_id", workspaceId);
  return {
    mappingId: mapping.id,
    editUrl,
    designId: mapping.canva_design_id,
    slideCount: pages,
    mode: mapping.mode,
    slideDesigns,
  };
}

async function createOrOpenCanvaEdit(args: {
  workspaceId: string;
  userId: string;
  assetId?: string;
  contentId?: string;
}) {
  const source = await sourceImages(args.workspaceId, args);
  const token = await canvaAccessToken(args.workspaceId);
  const grant = await connection(args.workspaceId);
  if (!grant) throw new HttpError(409, "Reconnect Canva to continue.");
  const sourceKey = createHash("sha256")
    .update(JSON.stringify([SOURCE_VERSION, source.paths, grant.updated_at]))
    .digest("hex");
  const found = await mappingForAsset(args.workspaceId, source.ids[0]);
  // An image brought back from Canva reopens the design it came from.
  if (found && (found.version || found.mapping.source_key === sourceKey)) {
    try {
      return await openExisting(args.workspaceId, token, found.mapping, source.paths.length);
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 404)) throw error;
      // Deleted in Canva: set it aside and make a new design below.
      await db
        .from("canva_design_mappings")
        .update({ source_key: `${found.mapping.source_key}:gone:${found.mapping.id}` })
        .eq("id", found.mapping.id)
        .eq("workspace_id", args.workspaceId);
    }
  }
  let dimensions: { width: number; height: number } | null = null;
  const files: Buffer[] = [];
  for (const path of source.paths) {
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
    dimensions ??= { width: info.width, height: info.height };
    files.push(bytes);
  }
  if (!dimensions) throw new HttpError(404, "No images to edit.");
  const size = dimensions;
  const uploaded = await inBatches(files, 3, (bytes, i) =>
    uploadImage(token, bytes, `Mellox slide ${i + 1}`),
  );
  const { data: workspace } = await db
    .from("workspaces")
    .select("name")
    .eq("id", args.workspaceId)
    .maybeSingle();
  const title = `Mellox - ${workspace?.name ?? "Brand"} - ${source.title}`;
  let design: { id: string; editUrl: string } | undefined;
  let mode: Mode = "flat_image";
  let slideDesigns: Array<{ page: number; editUrl: string; id: string }> = [];
  const stored = record(source.meta.carousel);
  const slides = source.meta.slides;
  // Each picture is converted by Canva into text and elements, so what opens
  // there looks like what was approved. Only when that is unavailable is a
  // carousel Mellox drew itself rebuilt from its words as one presentation:
  // editable, but a plainer layout.
  const rebuild = async () => {
    if (
      source.paths.length < 2 ||
      stored.render_mode === "model" ||
      !stored.theme ||
      !Array.isArray(slides)
    )
      return null;
    try {
      const coverPath = stored.cover_path;
      let coverArt: Buffer | null = null;
      if (typeof coverPath === "string" && isWorkspaceStoragePath(coverPath, args.workspaceId)) {
        const { data: cover } = await db.storage.from(ASSET_BUCKET).download(coverPath);
        if (cover) coverArt = Buffer.from(await cover.arrayBuffer());
      }
      const pptx = await buildCarouselPptx(slides, stored as never, coverArt);
      const imported = await importPptx(token, pptx, title);
      return imported.pageCount === source.paths.length ? imported : null;
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) throw error;
      return null;
    }
  };
  const convert = canvaMagicLayersEnabled();
  if (!convert) {
    design = (await rebuild()) ?? undefined;
    if (design) mode = "design_import";
  }
  if (!design) {
    const pages = await inBatches(uploaded, 3, (assetId, i) =>
      createSingleImageDesign(
        token,
        { assetId, ...size, title: uploaded.length > 1 ? `${title} - slide ${i + 1}` : title },
        convert,
      ),
    );
    const rebuilt = pages.some((page) => page.mode === "magic_layers") ? null : await rebuild();
    if (rebuilt) {
      design = rebuilt;
      mode = "design_import";
    } else {
      design = pages[0];
      if (pages.some((page) => page.mode === "magic_layers")) mode = "magic_layers";
      if (pages.length > 1)
        slideDesigns = pages.map((page, i) => ({
          page: i + 1,
          editUrl: page.editUrl,
          id: page.id,
        }));
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
    payload: { designId: design.id, slideCount: uploaded.length, mode },
  });
  return {
    mappingId: mapping.id as string,
    editUrl: design.editUrl,
    designId: design.id,
    slideCount: uploaded.length,
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

/** The image a post or asset shows right now. */
async function currentAssetId(
  workspaceId: string,
  source: { assetId?: string; contentId?: string },
): Promise<string | null> {
  if (source.assetId) return source.assetId;
  if (!source.contentId) return null;
  const { data: item } = await db
    .from("content_items")
    .select("meta")
    .eq("id", source.contentId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const meta = record(item?.meta);
  if (typeof meta.asset_id === "string") return meta.asset_id;
  if (typeof meta.asset_storage_path !== "string") return null;
  const { data: asset } = await db
    .from("assets")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("storage_path", meta.asset_storage_path)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  return (asset?.id as string | undefined) ?? null;
}

export async function canvaEditState(
  workspaceId: string,
  source: { assetId?: string; contentId?: string },
) {
  const assetId = await currentAssetId(workspaceId, source);
  const found = assetId ? await mappingForAsset(workspaceId, assetId) : null;
  if (!found)
    return {
      mappingId: null,
      mode: null,
      slideCount: 0,
      usingCanva: false,
      versionNumber: null,
    };
  const slides = await slideDesignRows(workspaceId, found.mapping.id);
  return {
    mappingId: found.mapping.id as string | null,
    mode: found.mapping.mode as Mode | null,
    slideCount: slides.length || 1,
    /** The post is showing an edit brought back from Canva. */
    usingCanva: !!found.version,
    versionNumber: found.version?.number ?? null,
  };
}

/**
 * Point every post that shows this design's picture at `pages` (a brought-back
 * edit, or the originals), and the Studio job with it so the preview follows.
 * Scheduled and published posts are left alone; an approved one goes back to
 * draft, because what was approved is no longer what would go out.
 */
async function pointPostsAt(args: {
  workspaceId: string;
  mapping: Pick<Mapping, "id" | "content_item_id">;
  pages: Page[];
  versionId: string | null;
}) {
  const { workspaceId, mapping, pages } = args;
  const { data: sources } = await db
    .from("canva_design_source_pages")
    .select("page_number, source_asset_id")
    .eq("mapping_id", mapping.id)
    .eq("workspace_id", workspaceId);
  const { data: versions } = await db
    .from("canva_import_versions")
    .select("id")
    .eq("mapping_id", mapping.id)
    .eq("workspace_id", workspaceId);
  const { data: imported } = versions?.length
    ? await db
        .from("canva_import_pages")
        .select("page_number, asset_id")
        .eq("workspace_id", workspaceId)
        .in(
          "version_id",
          versions.map((v) => v.id),
        )
    : { data: [] };
  // Every image that has ever stood for page n of this design.
  const pageOf = new Map<string, number>();
  for (const row of sources ?? [])
    if (row.source_asset_id) pageOf.set(row.source_asset_id, row.page_number);
  for (const row of imported ?? []) pageOf.set(row.asset_id, row.page_number);
  const ids = [...pageOf.keys()];
  if (!ids.length) return { applied: 0, locked: 0 };
  const { data: known } = await db
    .from("assets")
    .select("id, storage_path")
    .eq("workspace_id", workspaceId)
    .in("id", ids);
  const byId = new Map<string, Page>();
  const byPath = new Map<string, Page>();
  for (const [id, page] of pageOf) {
    const target = pages[page - 1];
    if (!target) continue;
    byId.set(id, target);
    const path = known?.find((a) => a.id === id)?.storage_path;
    if (typeof path === "string") byPath.set(path, target);
  }

  type PostRow = { id: string; status: string; meta: unknown };
  const { data: byAsset } = await db
    .from("content_items")
    .select("id, status, meta")
    .eq("workspace_id", workspaceId)
    .in("meta->>asset_id", ids);
  const rows = [...((byAsset ?? []) as PostRow[])];
  if (mapping.content_item_id && !rows.some((r) => r.id === mapping.content_item_id)) {
    const { data: own } = await db
      .from("content_items")
      .select("id, status, meta")
      .eq("id", mapping.content_item_id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (own) rows.push(own as PostRow);
  }

  let applied = 0;
  let locked = 0;
  const changed: string[] = [];
  for (const row of rows) {
    const meta = record(row.meta);
    const first =
      (typeof meta.asset_id === "string" ? byId.get(meta.asset_id) : undefined) ??
      (typeof meta.asset_storage_path === "string"
        ? byPath.get(meta.asset_storage_path)
        : undefined);
    // The post has a different picture now; this design is not about it.
    if (!first) continue;
    if (LOCKED.includes(row.status)) {
      locked++;
      continue;
    }
    const patch: Record<string, unknown> = {
      asset_id: first.id,
      asset_storage_path: first.storage_path,
      asset_status: "ready",
      media_type: "image",
      canva_selected_version_id: args.versionId,
    };
    if (Array.isArray(meta.asset_storage_paths)) {
      const next = meta.asset_storage_paths.map((p) =>
        typeof p === "string" ? byPath.get(p)?.storage_path : undefined,
      );
      if (next.some((p) => !p)) continue;
      patch.asset_storage_paths = next;
    }
    const { error } = await db
      .from("content_items")
      .update({
        meta: mergeMeta(meta, patch),
        media_url: null,
        status: ["approved", "pending"].includes(row.status) ? "draft" : row.status,
      })
      .eq("id", row.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new HttpError(500, "Could not update the post with the Canva edit.");
    applied++;
    changed.push(row.id);
  }

  if (changed.length) {
    const { data: jobs } = await db
      .from("studio_jobs")
      .select("id, output")
      .eq("workspace_id", workspaceId)
      .overlaps("content_item_ids", changed);
    for (const job of (jobs ?? []) as Array<{ id: string; output: unknown }>) {
      const output = record(job.output);
      if (!Array.isArray(output.media)) continue;
      let moved = false;
      const media = (output.media as Row[]).map((entry) => {
        const target =
          (typeof entry.assetId === "string" ? byId.get(entry.assetId) : undefined) ??
          (typeof entry.storagePath === "string" ? byPath.get(entry.storagePath) : undefined);
        if (!target || target.id === entry.assetId) return entry;
        moved = true;
        return { ...entry, url: undefined, assetId: target.id, storagePath: target.storage_path };
      });
      if (moved)
        await db
          .from("studio_jobs")
          .update({ output: { ...output, media } })
          .eq("id", job.id)
          .eq("workspace_id", workspaceId);
    }
  }
  return { applied, locked };
}

async function loadMapping(workspaceId: string, mappingId: string) {
  const { data } = await db
    .from("canva_design_mappings")
    .select(MAPPING_COLS)
    .eq("id", mappingId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!data) throw new HttpError(404, "Canva design is unavailable.");
  return data as Mapping;
}

/**
 * Bring the Canva edit back: export it, keep it as a new version beside the
 * original, and make the post use it. One step for the person.
 */
export async function importCanvaChanges(args: {
  workspaceId: string;
  userId: string;
  mappingId: string;
}) {
  const mapping = await loadMapping(args.workspaceId, args.mappingId);
  const token = await canvaAccessToken(args.workspaceId);
  const slides = await slideDesignRows(args.workspaceId, mapping.id);
  const { data: sources } = await db
    .from("canva_design_source_pages")
    .select("page_number, source_asset_id")
    .eq("mapping_id", mapping.id)
    .eq("workspace_id", args.workspaceId)
    .order("page_number", { ascending: true });
  const expected = sources?.length || 1;
  let urls: string[];
  if (slides.length) {
    // One design per slide: the first page of each is the slide.
    urls = await inBatches(slides, 3, async (slide) => {
      const pages = await exportPngPages(token, slide.canva_design_id, { pages: [1] });
      if (pages.length !== 1)
        throw new HttpError(422, `Canva could not export slide ${slide.page_number}.`);
      return pages[0];
    });
  } else if (expected === 1) {
    urls = await exportPngPages(token, mapping.canva_design_id, { pages: [1] });
  } else {
    urls = await exportPngPages(token, mapping.canva_design_id);
  }
  if (urls.length !== expected || urls.length > 30)
    throw new HttpError(
      422,
      `The Canva design has ${urls.length} pages and this post has ${expected}. Make them match in Canva, then bring it back again.`,
    );
  // Validate and download the entire export before persisting any version rows.
  const pages = await inBatches(urls, 3, async (url) => {
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
    // Social networks take JPEG everywhere; a see-through design stays PNG.
    const opaque = await sharp(bytes)
      .stats()
      .then((stats) => stats.isOpaque)
      .catch(() => false);
    // An imported presentation is 960 wide in Canva; slides go out at 1080.
    // (Canva refuses to export larger on a free plan, so it is done here.)
    const sized =
      mapping.mode === "design_import" && info.width < 1080
        ? await sharp(bytes).resize({ width: 1080 }).png().toBuffer()
        : bytes;
    return opaque
      ? {
          bytes: await sharp(sized).jpeg({ quality: 92, mozjpeg: true }).toBuffer(),
          mime: "image/jpeg",
          ext: "jpg",
        }
      : { bytes: sized, mime: "image/png", ext: "png" };
  });
  const { data: last } = await db
    .from("canva_import_versions")
    .select("version_number")
    .eq("mapping_id", mapping.id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextNumber = (last?.version_number ?? 0) + 1;
  const versionId = crypto.randomUUID();
  const saved: Page[] = [];
  try {
    for (const [index, page] of pages.entries()) {
      const parentAssetId =
        sources?.[index]?.source_asset_id ?? (index === 0 ? mapping.asset_id : null);
      const result = await persistAsset({
        workspaceId: args.workspaceId,
        idempotencyKey: `canva:${versionId}:${index + 1}`,
        dataUrl: `data:${page.mime};base64,${page.bytes.toString("base64")}`,
        assetType: "image",
        provider: "canva",
        parentAssetId,
        filename: `canva-version-${nextNumber}-page-${index + 1}.${page.ext}`,
        metadata: {
          source: "canva",
          canva_design_id: slides[index]?.canva_design_id ?? mapping.canva_design_id,
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
  const { applied, locked } = await pointPostsAt({
    workspaceId: args.workspaceId,
    mapping,
    pages: saved,
    versionId,
  });
  const now = new Date().toISOString();
  await db
    .from("canva_design_mappings")
    .update({ last_imported_at: now })
    .eq("id", mapping.id)
    .eq("workspace_id", args.workspaceId);
  if (applied)
    await db
      .from("canva_import_versions")
      .update({ selected_at: now })
      .eq("id", versionId)
      .eq("workspace_id", args.workspaceId);
  await recordAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    action: "connector.canva.version_imported",
    entity: "connector",
    payload: { mappingId: mapping.id, versionId, pageCount: saved.length, applied },
  });
  return { versionId, versionNumber: nextNumber, pageCount: saved.length, applied, locked };
}

async function readyPages(workspaceId: string, ids: Array<string | null>): Promise<Page[]> {
  const wanted = ids.filter((id): id is string => !!id);
  if (!wanted.length || wanted.length !== ids.length)
    throw new HttpError(404, "That version is no longer available.");
  const { data: assets } = await db
    .from("assets")
    .select("id, storage_path, status")
    .eq("workspace_id", workspaceId)
    .in("id", wanted)
    .is("deleted_at", null);
  return wanted.map((id) => {
    const asset = assets?.find((a) => a.id === id);
    if (!asset || asset.status !== "ready" || !asset.storage_path)
      throw new HttpError(404, "That version is no longer available.");
    return { id, storage_path: asset.storage_path as string };
  });
}

function outcome(result: { applied: number; locked: number }) {
  if (!result.applied && result.locked)
    throw new HttpError(409, "Scheduled or published content cannot be changed here.");
  return result;
}

export async function selectCanvaVersion(args: {
  workspaceId: string;
  userId: string;
  versionId: string;
}) {
  const { data: version } = await db
    .from("canva_import_versions")
    .select("id, mapping_id")
    .eq("id", args.versionId)
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();
  if (!version) throw new HttpError(404, "Canva version is unavailable.");
  const mapping = await loadMapping(args.workspaceId, version.mapping_id);
  const { data: pageRows } = await db
    .from("canva_import_pages")
    .select("page_number, asset_id")
    .eq("version_id", version.id)
    .eq("workspace_id", args.workspaceId)
    .order("page_number", { ascending: true });
  const pages = await readyPages(
    args.workspaceId,
    (pageRows ?? []).map((p) => p.asset_id as string),
  );
  const result = outcome(
    await pointPostsAt({ workspaceId: args.workspaceId, mapping, pages, versionId: version.id }),
  );
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
    payload: { versionId: version.id, applied: result.applied },
  });
  return { selected: true, ...result };
}

/** Put the picture Mellox made back on the post. The Canva edits stay in the Library. */
export async function restoreCanvaOriginal(args: {
  workspaceId: string;
  userId: string;
  mappingId: string;
}) {
  const mapping = await loadMapping(args.workspaceId, args.mappingId);
  const { data: sources } = await db
    .from("canva_design_source_pages")
    .select("page_number, source_asset_id")
    .eq("mapping_id", mapping.id)
    .eq("workspace_id", args.workspaceId)
    .order("page_number", { ascending: true });
  const pages = await readyPages(
    args.workspaceId,
    (sources ?? []).map((s) => s.source_asset_id as string | null),
  );
  const result = outcome(
    await pointPostsAt({ workspaceId: args.workspaceId, mapping, pages, versionId: null }),
  );
  await recordAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    action: "connector.canva.original_restored",
    entity: "connector",
    payload: { mappingId: mapping.id, applied: result.applied },
  });
  return { restored: true, ...result };
}
