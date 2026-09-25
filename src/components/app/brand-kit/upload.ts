"use client";
// Browser half of Brand Kit uploads.
//
// Big example images are shrunk first (the model studies at most ~1600 px, and
// Claude refuses images over 5 MB), a video contributes four still frames
// grabbed here, and every file goes straight to Storage through a one-time
// signed URL the server issued for a path it chose. The server then checks
// what landed before recording it (finishKitUpload).
import { supabase } from "@/integrations/supabase/client";
import { finishKitUpload, startKitUpload } from "@/lib/brand-kit.functions";
import { KIT_UPLOAD_RULES, MAX_VIDEO_FRAMES } from "@/lib/brand-kit/contracts";
import type { KitAssetKind } from "@/lib/brand-kit/spec";

const BUCKET = "generated-assets";
const STUDY_MAX_DIM = 1600;
const STUDY_MAX_BYTES = 4_500_000;

type FileKind = Exclude<KitAssetKind, "writing_sample">;

const FONT_MIME: Record<string, string> = {
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
};

/** Kinds the model studies — shrink them so analysis never fails on size. */
const STUDIED: ReadonlySet<FileKind> = new Set([
  "inspiration_image",
  "product_photo",
  "element",
  "pattern",
]);

export function mimeFor(file: File, kind: FileKind): string {
  if (kind === "font_file") {
    const ext = file.name.toLowerCase().split(".").pop() ?? "";
    return FONT_MIME[ext] ?? "application/octet-stream";
  }
  return file.type;
}

/** Client-side check with the same rules the server applies. */
export function checkFile(file: File, kind: FileKind): string | null {
  const rule = KIT_UPLOAD_RULES[kind];
  const mime = mimeFor(file, kind);
  if (!rule.mimes.includes(mime)) {
    return kind === "font_file"
      ? "Use a WOFF2, WOFF, TTF or OTF font file."
      : kind === "inspiration_video"
        ? "Use an MP4, WebM or MOV video."
        : "Use a PNG, JPEG or WebP image.";
  }
  // Studied images are shrunk before upload, so only the hard cap matters for them.
  if (!STUDIED.has(kind) && file.size > rule.maxBytes) {
    return `${rule.label} files must be under ${Math.round(rule.maxBytes / 1024 / 1024)} MB.`;
  }
  return null;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't open that image."));
    img.src = url;
  });
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Couldn't prepare the image."))),
      type,
      quality,
    ),
  );
}

/** Measure an image, and shrink it if it's bigger than the model can study. */
export async function prepareImage(
  file: File,
  shrink: boolean,
): Promise<{ blob: Blob; mime: string; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const { naturalWidth: w, naturalHeight: h } = img;
    const tooBig = Math.max(w, h) > STUDY_MAX_DIM || file.size > STUDY_MAX_BYTES;
    if (!shrink || !tooBig) return { blob: file, mime: file.type, width: w, height: h };
    const scale = Math.min(1, STUDY_MAX_DIM / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return { blob: file, mime: file.type, width: w, height: h };
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    // PNG keeps transparency (elements, logos); photos become compact JPEG.
    const keepAlpha = file.type === "image/png" && file.size < STUDY_MAX_BYTES * 2;
    const mime = keepAlpha ? "image/png" : "image/jpeg";
    let blob = await canvasBlob(canvas, mime, 0.88);
    if (blob.size > STUDY_MAX_BYTES) blob = await canvasBlob(canvas, "image/jpeg", 0.8);
    return { blob, mime: blob.type || mime, width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Grab evenly spaced still frames from a video, as JPEG blobs. */
export async function captureVideoFrames(
  file: File,
  count = MAX_VIDEO_FRAMES,
): Promise<{ frames: Blob[]; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Couldn't open that video."));
      setTimeout(() => reject(new Error("The video took too long to open.")), 20_000);
    });
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
    const scale = Math.min(1, 1280 / Math.max(video.videoWidth || 1, video.videoHeight || 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((video.videoWidth || 1280) * scale));
    canvas.height = Math.max(1, Math.round((video.videoHeight || 720) * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return { frames: [], width: canvas.width, height: canvas.height };
    const frames: Blob[] = [];
    for (let i = 0; i < count; i++) {
      // 10%, 35%, 60%, 85% — skips black intro and outro frames.
      const t = Math.min(duration - 0.05, duration * (0.1 + (0.75 * i) / Math.max(1, count - 1)));
      await new Promise<void>((resolve) => {
        const done = () => {
          video.removeEventListener("seeked", done);
          resolve();
        };
        video.addEventListener("seeked", done);
        video.currentTime = Math.max(0, t);
        setTimeout(done, 4000);
      });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(await canvasBlob(canvas, "image/jpeg", 0.85));
    }
    return { frames, width: video.videoWidth, height: video.videoHeight };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function putSigned(path: string, token: string, body: Blob, contentType: string) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .uploadToSignedUrl(path, token, body, { contentType, upsert: false });
  if (error) throw new Error(error.message || "Upload failed");
}

export type UploadProgress = (stage: "preparing" | "uploading" | "saving") => void;

/** Upload one file into the kit. Returns the new asset id. */
export async function uploadKitFile(args: {
  workspaceId: string;
  kind: FileKind;
  file: File;
  label?: string | null;
  styleId?: string | null;
  onProgress?: UploadProgress;
}): Promise<{ assetId: string; analyze: boolean }> {
  const { workspaceId, kind, file } = args;
  const problem = checkFile(file, kind);
  if (problem) throw new Error(problem);
  args.onProgress?.("preparing");

  let body: Blob = file;
  let mime = mimeFor(file, kind);
  let width: number | null = null;
  let height: number | null = null;
  let frames: Blob[] = [];
  if (kind === "inspiration_video") {
    const captured = await captureVideoFrames(file).catch(() => ({
      frames: [],
      width: 0,
      height: 0,
    }));
    frames = captured.frames;
    width = captured.width || null;
    height = captured.height || null;
  } else if (kind !== "font_file") {
    const prepared = await prepareImage(file, STUDIED.has(kind));
    body = prepared.blob;
    mime = prepared.mime;
    width = prepared.width;
    height = prepared.height;
  }

  const ticket = await startKitUpload({
    data: {
      workspaceId,
      kind,
      mime,
      bytes: body.size,
      fileName: file.name.slice(0, 200),
      frameCount: frames.length,
    },
  });
  args.onProgress?.("uploading");
  await putSigned(ticket.path, ticket.token, body, mime);
  const framePaths: string[] = [];
  for (let i = 0; i < ticket.frames.length && i < frames.length; i++) {
    try {
      await putSigned(ticket.frames[i].path, ticket.frames[i].token, frames[i], "image/jpeg");
      framePaths.push(ticket.frames[i].path);
    } catch {
      // A missing frame only means less to study; the video itself is saved.
    }
  }
  args.onProgress?.("saving");
  return finishKitUpload({
    data: {
      workspaceId,
      assetId: ticket.assetId,
      kind,
      path: ticket.path,
      framePaths,
      label: args.label ?? file.name.replace(/\.[^.]+$/, "").slice(0, 120),
      styleId: args.styleId ?? null,
      width: width && width > 0 ? Math.round(width) : null,
      height: height && height > 0 ? Math.round(height) : null,
    },
  });
}
