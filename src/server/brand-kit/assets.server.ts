// assets.server.ts — adding files and writing samples to the Brand Kit.
//
// Files go straight from the browser to Storage with a one-time signed upload
// URL for a path this server chose (workspace/<id>/assets/brand-kit/<asset>/…),
// so large videos never pass through the RPC. `finishUpload` then checks what
// actually landed (size, type) before the row is written; a file that doesn't
// match the ticket is deleted, never recorded.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { workspaceStoragePrefix, isWorkspaceStoragePath } from "@/lib/workspace/storage-path";
import {
  FONT_EXTENSIONS,
  KIT_UPLOAD_RULES,
  MAX_KIT_ASSETS_PER_WORKSPACE,
  MAX_VIDEO_FRAMES,
  MAX_WRITING_SAMPLE_CHARS,
  type UploadTicket,
} from "@/lib/brand-kit/contracts";
import { ANALYZABLE_KINDS, type KitAssetKind } from "@/lib/brand-kit/spec";
import { safeFetch, assertPublicUrl } from "@/server/safe-fetch";
import { extractMeta, stripHtml } from "@/lib/crawl/html";
import { BrandKitError, KIT_BUCKET, getStyleRow, invalidateResolvedStyles } from "./store.server";

const admin = () => supabaseAdmin as unknown as SupabaseClient;

type FileKind = Exclude<KitAssetKind, "writing_sample">;

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

export function kitAssetPrefix(workspaceId: string, assetId: string) {
  return `${workspaceStoragePrefix(workspaceId)}brand-kit/${assetId}/`;
}

function extensionFor(kind: FileKind, mime: string, fileName: string): string {
  if (kind === "font_file") {
    const ext = fileName.toLowerCase().split(".").pop() ?? "";
    if (!(FONT_EXTENSIONS as readonly string[]).includes(ext)) {
      throw new BrandKitError("Use a WOFF2, WOFF, TTF or OTF font file.");
    }
    return ext;
  }
  const ext = EXT_BY_MIME[mime];
  if (!ext) throw new BrandKitError("That file type isn't supported here.");
  return ext;
}

async function assertCapacity(workspaceId: string) {
  const { count } = await admin()
    .from("brand_kit_assets")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  if ((count ?? 0) >= MAX_KIT_ASSETS_PER_WORKSPACE) {
    throw new BrandKitError(
      `The kit is full (${MAX_KIT_ASSETS_PER_WORKSPACE} files). Remove some first.`,
    );
  }
}

/** Step 1: validate the declared file and hand back one-time upload URLs. */
export async function startUpload(args: {
  workspaceId: string;
  kind: FileKind;
  mime: string;
  bytes: number;
  fileName: string;
  frameCount?: number;
}): Promise<UploadTicket> {
  const rule = KIT_UPLOAD_RULES[args.kind];
  if (!rule) throw new BrandKitError("Unknown file kind.");
  if (!rule.mimes.includes(args.mime))
    throw new BrandKitError(`That file type isn't supported for ${rule.label.toLowerCase()}.`);
  if (!(args.bytes > 0) || args.bytes > rule.maxBytes) {
    throw new BrandKitError(
      `${rule.label} files must be under ${Math.round(rule.maxBytes / 1024 / 1024)} MB.`,
    );
  }
  await assertCapacity(args.workspaceId);
  const assetId = randomUUID();
  const prefix = kitAssetPrefix(args.workspaceId, assetId);
  const path = `${prefix}original.${extensionFor(args.kind, args.mime, args.fileName)}`;
  const bucket = admin().storage.from(KIT_BUCKET);
  const main = await bucket.createSignedUploadUrl(path);
  if (main.error || !main.data)
    throw new Error(main.error?.message ?? "Could not prepare the upload");
  const frames: UploadTicket["frames"] = [];
  const frameCount =
    args.kind === "inspiration_video" ? Math.min(args.frameCount ?? 0, MAX_VIDEO_FRAMES) : 0;
  for (let i = 0; i < frameCount; i++) {
    const framePath = `${prefix}frame-${i + 1}.jpg`;
    const f = await bucket.createSignedUploadUrl(framePath);
    if (f.error || !f.data) throw new Error(f.error?.message ?? "Could not prepare the upload");
    frames.push({ path: framePath, token: f.data.token });
  }
  return { assetId, path, token: main.data.token, frames };
}

async function objectInfo(path: string): Promise<{ size: number; mime: string } | null> {
  const dir = path.slice(0, path.lastIndexOf("/"));
  const name = path.slice(path.lastIndexOf("/") + 1);
  const { data, error } = await admin()
    .storage.from(KIT_BUCKET)
    .list(dir, { search: name, limit: 10 });
  if (error) return null;
  const hit = (data ?? []).find((o) => o.name === name);
  if (!hit) return null;
  const meta = (hit.metadata ?? {}) as { size?: number; mimetype?: string };
  return { size: Number(meta.size ?? 0), mime: String(meta.mimetype ?? "") };
}

/** Step 2: the browser finished uploading — verify and record. */
export async function finishUpload(args: {
  workspaceId: string;
  userId: string;
  assetId: string;
  kind: FileKind;
  path: string;
  framePaths?: string[];
  label?: string | null;
  styleId?: string | null;
  width?: number | null;
  height?: number | null;
}): Promise<{ assetId: string; analyze: boolean }> {
  const prefix = kitAssetPrefix(args.workspaceId, args.assetId);
  const inPrefix = (p: string) =>
    p.startsWith(prefix) && isWorkspaceStoragePath(p, args.workspaceId);
  if (!inPrefix(args.path))
    throw new BrandKitError("That upload doesn't belong to this workspace.", 403);
  const framePaths = (args.framePaths ?? []).slice(0, MAX_VIDEO_FRAMES);
  if (framePaths.some((p) => !inPrefix(p) || !/\/frame-\d\.jpg$/.test(p))) {
    throw new BrandKitError("That upload doesn't belong to this workspace.", 403);
  }
  if (args.styleId) await getStyleRow(args.workspaceId, args.styleId);

  const rule = KIT_UPLOAD_RULES[args.kind];
  const info = await objectInfo(args.path);
  const cleanup = () =>
    admin()
      .storage.from(KIT_BUCKET)
      .remove([args.path, ...framePaths])
      .catch(() => null);
  if (!info) throw new BrandKitError("The upload didn't finish. Try again.");
  const mimeOk =
    args.kind === "font_file" ? true : rule.mimes.includes(info.mime.split(";")[0].trim());
  if (!mimeOk || info.size <= 0 || info.size > rule.maxBytes) {
    await cleanup();
    throw new BrandKitError("That file doesn't match what was expected. Try again.");
  }
  const frames: string[] = [];
  for (const p of framePaths) {
    const fi = await objectInfo(p);
    if (fi && fi.size > 0 && fi.size <= 5 * 1024 * 1024) frames.push(p);
  }

  const analyze =
    ANALYZABLE_KINDS.has(args.kind) && (args.kind !== "inspiration_video" || frames.length > 0);
  const { error } = await admin()
    .from("brand_kit_assets")
    .insert({
      id: args.assetId,
      workspace_id: args.workspaceId,
      style_id: args.styleId ?? null,
      kind: args.kind,
      label: args.label?.trim().slice(0, 120) || null,
      storage_path: args.path,
      frame_paths: frames,
      mime: info.mime || null,
      bytes: info.size,
      width: args.width ?? null,
      height: args.height ?? null,
      analysis_status: analyze ? "pending" : "none",
      created_by: args.userId,
    });
  if (error) {
    // A retried finish for a row that already exists: the files are that row's.
    if (error.code === "23505") return { assetId: args.assetId, analyze: false };
    await cleanup();
    throw new Error(error.message);
  }
  invalidateResolvedStyles(args.workspaceId);
  return { assetId: args.assetId, analyze };
}

/** Pull readable text from a public post or article URL. */
export async function readSampleFromUrl(raw: string): Promise<{ text: string; url: string }> {
  let url: URL;
  try {
    url = assertPublicUrl(raw);
  } catch {
    throw new BrandKitError("That link can't be opened. Paste the text instead.");
  }
  let html = "";
  let finalUrl = url.toString();
  try {
    const res = await safeFetch(url, {
      timeoutMs: 10_000,
      maxBytes: 2 * 1024 * 1024,
      onOverflow: "truncate",
    });
    if (res.ok) {
      html = res.text();
      finalUrl = res.url;
    }
  } catch {
    html = "";
  }
  if (!html) throw new BrandKitError("Couldn't read that page. Paste the text instead.");
  const meta = extractMeta(html);
  const article = stripHtml(html, MAX_WRITING_SAMPLE_CHARS);
  const description =
    meta["og:description"] || meta.description || meta["twitter:description"] || "";
  // Social sites often serve a login wall: the post text only survives in the meta description.
  const text = article.length > 400 ? article : [description, article].filter(Boolean).join("\n\n");
  if (text.trim().length < 40)
    throw new BrandKitError("Couldn't find the post text on that page. Paste it instead.");
  return { text: text.slice(0, MAX_WRITING_SAMPLE_CHARS), url: finalUrl };
}

export async function addWritingSample(args: {
  workspaceId: string;
  userId: string;
  text?: string;
  url?: string;
  label?: string | null;
  styleId?: string | null;
}): Promise<{ assetId: string }> {
  await assertCapacity(args.workspaceId);
  if (args.styleId) await getStyleRow(args.workspaceId, args.styleId);
  let text = (args.text ?? "").trim();
  let sourceUrl: string | null = null;
  if (!text && args.url) {
    const read = await readSampleFromUrl(args.url);
    text = read.text;
    sourceUrl = read.url;
  }
  if (text.length < 40)
    throw new BrandKitError("Add at least a few sentences so there's a style to learn.");
  const { data, error } = await admin()
    .from("brand_kit_assets")
    .insert({
      workspace_id: args.workspaceId,
      style_id: args.styleId ?? null,
      kind: "writing_sample",
      label: args.label?.trim().slice(0, 120) || text.split("\n")[0].slice(0, 60),
      text_content: text.slice(0, MAX_WRITING_SAMPLE_CHARS),
      source_url: sourceUrl,
      analysis_status: "pending",
      created_by: args.userId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  invalidateResolvedStyles(args.workspaceId);
  return { assetId: data.id };
}

/** Download a kit file's bytes (service role), refusing anything outside the workspace. */
export async function downloadKitFile(workspaceId: string, path: string): Promise<Buffer | null> {
  if (!isWorkspaceStoragePath(path, workspaceId) || !path.includes("/assets/brand-kit/"))
    return null;
  const { data, error } = await admin().storage.from(KIT_BUCKET).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}
