// Reference photos (product photos, UGC references): stored in Mellox storage
// before anything uses them, so a generator or provider always reads a stable,
// validated, signed copy we control — never a third-party link that can
// change, expire or point somewhere unsafe.
import "server-only";
import { randomUUID } from "node:crypto";
import { probeImage, referenceImageProblem, MAX_REFERENCE_BYTES } from "@/lib/ugc/image-probe";
import { persistAsset } from "@/server/assets/persist.server";
import { HttpError } from "@/server/http-error";
import { ResponseTooLargeError, safeFetch } from "@/server/safe-fetch";

export type ReferenceImageOptions = {
  /** `assets.metadata.source`, e.g. "ugc-reference" or "product-photo". */
  source: string;
  /** Same key, same asset: a retry never stores a second copy. */
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
};

export type StoredReference = {
  assetId: string;
  url: string | null;
  filename: string;
  width: number;
  height: number;
};

/** Images below this on their shorter side make soft posts; the UI says so. */
export const LOW_RESOLUTION_PX = 800;

export async function storeReferenceBytes(
  workspaceId: string,
  bytes: Uint8Array,
  filename: string,
  origin: string | null,
  opts: ReferenceImageOptions,
): Promise<StoredReference> {
  const probe = probeImage(bytes);
  const problem = referenceImageProblem(probe, bytes.byteLength);
  if (problem || !probe) throw new HttpError(422, problem ?? "Unsupported image.");
  const result = await persistAsset({
    workspaceId,
    idempotencyKey: opts.idempotencyKey ?? `${opts.source}:${randomUUID()}`,
    dataUrl: `data:${probe.mime};base64,${Buffer.from(bytes).toString("base64")}`,
    assetType: "image",
    filename,
    provider: "upload",
    metadata: {
      ...opts.metadata,
      source: opts.source,
      origin_url: origin,
      width: probe.width,
      height: probe.height,
    },
  });
  if (!result.ok) throw new HttpError(result.status, result.message);
  return {
    assetId: result.asset.id,
    url: result.asset.public_url,
    filename: result.asset.filename,
    width: probe.width,
    height: probe.height,
  };
}

export async function storeUploadedImage(
  workspaceId: string,
  file: File,
  opts: ReferenceImageOptions,
): Promise<StoredReference> {
  if (file.size > MAX_REFERENCE_BYTES) throw new HttpError(422, "Images must be 10 MB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  return storeReferenceBytes(workspaceId, bytes, file.name || "product-photo", null, opts);
}

/** Import an image from a public page (fetched through the SSRF guard). */
export async function importImageFromUrl(
  workspaceId: string,
  url: string,
  opts: ReferenceImageOptions,
): Promise<StoredReference> {
  let bytes: Uint8Array;
  try {
    const res = await safeFetch(url, {
      timeoutMs: 20_000,
      maxBytes: MAX_REFERENCE_BYTES,
      onOverflow: "error",
      // No AVIF: video models accept PNG, JPEG and WebP only, and CDNs negotiate on Accept.
      headers: { Accept: "image/webp,image/png,image/jpeg;q=0.9,image/*;q=0.5" },
    });
    if (!res.ok) throw new HttpError(422, "That image couldn't be downloaded. Upload it instead.");
    bytes = res.bytes;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof ResponseTooLargeError)
      throw new HttpError(422, "Images must be 10 MB or smaller.");
    if ((error as { name?: string })?.name === "SsrfBlockedError") throw error;
    throw new HttpError(422, "That image couldn't be downloaded. Upload it instead.");
  }
  const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "product-photo").slice(
    0,
    100,
  );
  return storeReferenceBytes(workspaceId, bytes, name, url, opts);
}
