import "server-only";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const ASSET_BUCKET = "generated-assets";

type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
};

let cachedClient: { config: R2Config; client: S3Client } | null = null;

function r2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET_NAME?.trim();

  if (!accessKeyId && !secretAccessKey) return null;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("R2 storage configuration is incomplete");
  }

  const endpoint =
    process.env.R2_ENDPOINT?.trim() || `https://${accountId}.r2.cloudflarestorage.com`;
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("R2_ENDPOINT must be a valid HTTPS Cloudflare R2 endpoint");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== `${accountId}.r2.cloudflarestorage.com` ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "" && parsed.pathname !== "/")
  ) {
    throw new Error("R2_ENDPOINT must match the configured Cloudflare account");
  }

  return { accountId, accessKeyId, secretAccessKey, bucket, endpoint };
}

export function isR2StorageEnabled(): boolean {
  return r2Config() !== null;
}

function r2Client(config: R2Config): S3Client {
  if (
    !cachedClient ||
    cachedClient.config.endpoint !== config.endpoint ||
    cachedClient.config.bucket !== config.bucket ||
    cachedClient.config.accessKeyId !== config.accessKeyId ||
    cachedClient.config.secretAccessKey !== config.secretAccessKey
  ) {
    cachedClient?.client.destroy();
    cachedClient = {
      config,
      client: new S3Client({
        region: "auto",
        endpoint: config.endpoint,
        forcePathStyle: true,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      }),
    };
  }
  return cachedClient.client;
}

export function isR2AssetPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    /^workspace\/[0-9a-f-]{36}\/assets\/r2\/[A-Za-z0-9._/-]+$/i.test(path) &&
    !path.includes("..") &&
    !path.includes("//")
  );
}

function isMarkedR2Path(path: string): boolean {
  return path.includes("/assets/r2/");
}

function invalidR2Path(paths: string[]): string | null {
  return paths.find((path) => isMarkedR2Path(path) && !isR2AssetPath(path)) ?? null;
}

export function r2AssetPath(workspaceId: string, assetId: string, filename: string): string {
  return `workspace/${workspaceId}/assets/r2/${assetId}/${filename}`;
}

export async function uploadAssetObject(
  path: string,
  bytes: Buffer | Uint8Array,
  contentType: string,
): Promise<void> {
  if (!isR2AssetPath(path)) throw new Error("Invalid R2 asset path");
  const config = r2Config();
  if (!config) throw new Error("R2 storage is not configured");
  await r2Client(config).send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: path,
      Body: bytes,
      ContentType: contentType,
    }),
  );
}

export async function signAssetObject(
  path: string,
  ttlSeconds = 3600,
  downloadFilename?: string,
): Promise<string> {
  if (!isR2AssetPath(path)) throw new Error("Invalid R2 asset path");
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 604800) {
    throw new Error("Signed URL lifetime must be between 1 second and 7 days");
  }
  const config = r2Config();
  if (!config) throw new Error("R2 storage is not configured");
  return getSignedUrl(
    r2Client(config),
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: path,
      ...(downloadFilename
        ? {
            ResponseContentDisposition: `attachment; filename="${downloadFilename.replace(/["\\\r\n]/g, "_")}"`,
          }
        : {}),
    }),
    { expiresIn: ttlSeconds },
  );
}

type MigrationAlias = { source_path: string; target_path: string; status: string };

/** Server-only lookup. Production requires the retention schema before deployment. */
async function migrationAliases(paths: string[]): Promise<Map<string, MigrationAlias>> {
  const legacy = paths.filter(
    (path) => !isMarkedR2Path(path) || path.includes("/assets/r2/migrated/"),
  );
  if (!legacy.length || (process.env.NODE_ENV !== "production" && !isR2StorageEnabled()))
    return new Map();
  const admin = supabaseAdmin as unknown as SupabaseClient;
  const { data, error } = await admin.rpc(
    "resolve_media_storage_paths" as never,
    { paths: legacy } as never,
  );
  if (error) {
    if (["PGRST202", "42883"].includes(error.code) && process.env.NODE_ENV !== "production")
      return new Map();
    throw new Error("Could not resolve migrated storage paths");
  }
  const aliases = new Map<string, MigrationAlias>();
  for (const row of (data ?? []) as MigrationAlias[]) {
    if (
      !isR2AssetPath(row.target_path) ||
      row.source_path.split("/")[1] !== row.target_path.split("/")[1]
    ) {
      throw new Error("Invalid migrated workspace storage mapping");
    }
    aliases.set(row.source_path, row);
    aliases.set(row.target_path, row);
  }
  return aliases;
}

export async function signStoragePath(
  supabase: SupabaseClient,
  path: string,
  ttlSeconds = 3600,
  downloadFilename?: string,
): Promise<string | null> {
  const alias = (await migrationAliases([path])).get(path);
  if (alias?.status === "deleted") return null;
  if (alias?.status === "active") path = alias.target_path;
  if (alias?.status === "rolled_back") path = alias.source_path;
  if (isMarkedR2Path(path)) {
    return signAssetObject(path, ttlSeconds, downloadFilename);
  }
  const { data, error } = await supabase.storage
    .from(ASSET_BUCKET)
    .createSignedUrl(
      path,
      ttlSeconds,
      downloadFilename ? { download: downloadFilename } : undefined,
    );
  if (error) throw new Error(`Could not sign Supabase asset URL: ${error.message}`);
  return data?.signedUrl ?? null;
}

export async function signStoragePaths(
  supabase: SupabaseClient,
  paths: string[],
  ttlSeconds = 3600,
): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  const malformedR2Path = invalidR2Path(unique);
  if (malformedR2Path) throw new Error("Invalid R2 asset path");
  const aliases = await migrationAliases(unique);
  const readable = unique.filter((path) => aliases.get(path)?.status !== "deleted");
  const routed = new Map(
    readable.map((path) => {
      const alias = aliases.get(path);
      return [
        path,
        alias?.status === "active"
          ? alias.target_path
          : alias?.status === "rolled_back"
            ? alias.source_path
            : path,
      ] as const;
    }),
  );
  const resolved = [...new Set(routed.values())];
  const r2Paths = resolved.filter(isR2AssetPath);
  const supabasePaths = resolved.filter((path) => !isR2AssetPath(path));
  const urls = new Map<string, string>();
  if (supabasePaths.length) {
    const { data, error } = await supabase.storage
      .from(ASSET_BUCKET)
      .createSignedUrls(supabasePaths, ttlSeconds);
    if (error) throw new Error(`Could not sign Supabase asset URLs: ${error.message}`);
    for (const row of data ?? []) if (row.path && row.signedUrl) urls.set(row.path, row.signedUrl);
  }
  for (const [path, url] of await Promise.all(
    r2Paths.map(async (path) => [path, await signAssetObject(path, ttlSeconds)] as const),
  ))
    urls.set(path, url);
  const signed = new Map<string, string>();
  for (const [original, path] of routed) {
    const url = urls.get(path);
    if (url) signed.set(original, url);
  }
  return signed;
}

export async function downloadAssetObject(
  supabase: SupabaseClient,
  path: string,
): Promise<{ data: Blob | null; error: { message: string } | null }> {
  const alias = (await migrationAliases([path])).get(path);
  if (alias?.status === "deleted") return { data: null, error: { message: "Asset was deleted" } };
  if (alias?.status === "active") path = alias.target_path;
  if (alias?.status === "rolled_back") path = alias.source_path;
  if (!isMarkedR2Path(path)) {
    const { data, error } = await supabase.storage.from(ASSET_BUCKET).download(path);
    return { data, error };
  }
  if (!isR2AssetPath(path)) throw new Error("Invalid R2 asset path");

  const config = r2Config();
  if (!config) throw new Error("R2 storage is not configured");
  const response = await r2Client(config).send(
    new GetObjectCommand({ Bucket: config.bucket, Key: path }),
  );
  if (!response.Body) return { data: null, error: { message: "R2 object has no body" } };
  const bytes = await response.Body.transformToByteArray();
  const blobBytes = new Uint8Array(bytes.byteLength);
  blobBytes.set(bytes);
  return {
    data: new Blob([blobBytes], { type: response.ContentType ?? "application/octet-stream" }),
    error: null,
  };
}

export async function removeAssetObjects(
  paths: string[],
  supabase: SupabaseClient = supabaseAdmin as unknown as SupabaseClient,
): Promise<void> {
  const unique = [...new Set(paths.filter(Boolean))];
  const malformedR2Path = invalidR2Path(unique);
  if (malformedR2Path) throw new Error("Invalid R2 asset path");
  const aliases = await migrationAliases(unique);
  const r2Paths = [
    ...new Set(unique.map((path) => aliases.get(path)?.target_path ?? path).filter(isR2AssetPath)),
  ];
  // Migration originals are retained even when a user deletes the R2 copy.
  const supabasePaths = unique.filter((path) => !isR2AssetPath(path) && !aliases.has(path));

  if (r2Paths.length) {
    const config = r2Config();
    if (!config) throw new Error("R2 storage is not configured");
    const { error: tombstoneError } = await (supabaseAdmin as unknown as SupabaseClient).rpc(
      "tombstone_migrated_media" as never,
      { paths: r2Paths } as never,
    );
    if (
      tombstoneError &&
      (process.env.NODE_ENV === "production" ||
        !["PGRST202", "42883"].includes(tombstoneError.code))
    ) {
      throw new Error("Could not record migrated asset deletion");
    }
    for (let offset = 0; offset < r2Paths.length; offset += 1000) {
      const response = await r2Client(config).send(
        new DeleteObjectsCommand({
          Bucket: config.bucket,
          Delete: { Objects: r2Paths.slice(offset, offset + 1000).map((Key) => ({ Key })) },
        }),
      );
      if (response.Errors?.length) {
        throw new Error(`Could not delete ${response.Errors.length} R2 asset object(s)`);
      }
    }
  }

  for (let offset = 0; offset < supabasePaths.length; offset += 100) {
    const { error } = await supabase.storage
      .from(ASSET_BUCKET)
      .remove(supabasePaths.slice(offset, offset + 100));
    if (error) throw new Error(`Could not delete Supabase asset objects: ${error.message}`);
  }
}

export async function listR2WorkspaceAssetPaths(workspaceId: string): Promise<string[]> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workspaceId)) {
    throw new Error("Invalid workspace ID");
  }
  const config = r2Config();
  if (!config) return [];
  const prefix = `workspace/${workspaceId}/assets/r2/`;
  const client = r2Client(config);
  const paths: string[] = [];
  let continuationToken: string | undefined;
  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const item of response.Contents ?? []) {
      if (item.Key && isR2AssetPath(item.Key)) paths.push(item.Key);
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);
  return paths;
}
