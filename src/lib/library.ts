export type LibraryAssetType = "image" | "video" | "file" | "brand" | "download";
export type LibraryAssetSource = "generated" | "uploaded" | "imported" | "saved";

export type LibraryAsset = {
  id: string;
  workspaceId: string | null;
  name: string;
  type: LibraryAssetType;
  source: LibraryAssetSource;
  url: string | null;
  thumbnailUrl: string | null;
  mimeType: string | null;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  projectId: string | null;
  campaignId: string | null;
  platform: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  isFavorite: boolean;
  status: string | null;
  provider: string | null;
  model: string | null;
  generationId: string | null;
  metadata: Record<string, unknown>;
};

const imageExts = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".bmp"]);
const videoExts = new Set([".mp4", ".mov", ".webm", ".m4v", ".avi", ".mkv", ".mpeg", ".mpg"]);

export function inferLibraryAssetType(
  url?: string | null,
  mimeType?: string | null,
): LibraryAssetType {
  const normalized = (url ?? "").toLowerCase();
  const mime = (mimeType ?? "").toLowerCase();

  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  if (videoExts.has(getExtension(normalized))) return "video";
  if (imageExts.has(getExtension(normalized))) return "image";

  return "file";
}

export function getExtension(url: string): string {
  if (!url) return "";
  const match = url.match(/\.([a-z0-9]+)(?:\?.*)?$/i);
  return match ? `.${match[1].toLowerCase()}` : "";
}

export function normalizeLibraryAsset(input: {
  id: string;
  title?: string | null;
  media_url?: string | null;
  kind?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  workspace_id?: string | null;
  project_id?: string | null;
  campaign_id?: string | null;
  channel?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  source?: string | null;
  provider?: string | null;
  model?: string | null;
  generation_id?: string | null;
  is_favorite?: boolean | null;
  metadata?: Record<string, unknown> | null;
}): LibraryAsset {
  const url = input.media_url ?? null;
  const type = inferLibraryAssetType(url, input.mime_type ?? null);
  const name =
    (input.title ?? getFilenameFromUrl(url) ?? "Untitled asset").trim() || "Untitled asset";

  return {
    id: input.id,
    workspaceId: input.workspace_id ?? null,
    name,
    type,
    source: (input.source as LibraryAssetSource) ?? "generated",
    url,
    thumbnailUrl: url,
    mimeType: input.mime_type ?? null,
    fileSize: input.file_size ?? null,
    width: input.width ?? null,
    height: input.height ?? null,
    duration: input.duration ?? null,
    projectId: input.project_id ?? null,
    campaignId: input.campaign_id ?? null,
    platform: input.channel ?? null,
    createdAt: input.created_at ?? null,
    updatedAt: input.updated_at ?? null,
    isFavorite: Boolean(input.is_favorite),
    status: input.status ?? null,
    provider: input.provider ?? null,
    model: input.model ?? null,
    generationId: input.generation_id ?? null,
    metadata: input.metadata ?? {},
  };
}

export function getFilenameFromUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const pathname = new URL(url).pathname;
    const basename = pathname.split("/").filter(Boolean).pop() ?? "asset";
    return basename.replace(/\.[a-z0-9]+$/i, "") || basename;
  } catch {
    return url.split("/").filter(Boolean).pop() ?? null;
  }
}
