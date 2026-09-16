// Product reference images: stored in Mellox storage before any render, so the
// video provider always fetches a stable, validated, signed URL we control —
// never a third-party link that can change, expire or point somewhere unsafe.
import "server-only";
import { randomUUID } from "node:crypto";
import { probeImage, referenceImageProblem, MAX_REFERENCE_BYTES } from "@/lib/ugc/image-probe";
import { persistAsset } from "@/server/assets/persist.server";
import { HttpError } from "@/server/http-error";
import { ResponseTooLargeError, safeFetch } from "@/server/safe-fetch";

async function store(workspaceId: string, bytes: Uint8Array, filename: string, origin: string | null) {
  const probe = probeImage(bytes);
  const problem = referenceImageProblem(probe, bytes.byteLength);
  if (problem || !probe) throw new HttpError(422, problem ?? "Unsupported image.");
  const result = await persistAsset({
    workspaceId,
    idempotencyKey: `ugc-ref:${randomUUID()}`,
    dataUrl: `data:${probe.mime};base64,${Buffer.from(bytes).toString("base64")}`,
    assetType: "image",
    filename,
    provider: "upload",
    metadata: {
      source: "ugc-reference",
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

export async function storeUploadedReference(workspaceId: string, file: File) {
  if (file.size > MAX_REFERENCE_BYTES) throw new HttpError(422, "Images must be 10 MB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  return store(workspaceId, bytes, file.name || "product-photo", null);
}

/** Import a product image from the product page (fetched through the SSRF guard). */
export async function importReferenceFromUrl(workspaceId: string, url: string) {
  let bytes: Uint8Array;
  try {
    const res = await safeFetch(url, {
      timeoutMs: 20_000,
      maxBytes: MAX_REFERENCE_BYTES,
      onOverflow: "error",
      headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,*/*" },
    });
    if (!res.ok) throw new HttpError(422, "That image couldn't be downloaded. Upload it instead.");
    bytes = res.bytes;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof ResponseTooLargeError) throw new HttpError(422, "Images must be 10 MB or smaller.");
    if ((error as { name?: string })?.name === "SsrfBlockedError") throw error;
    throw new HttpError(422, "That image couldn't be downloaded. Upload it instead.");
  }
  const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "product-photo").slice(0, 100);
  return store(workspaceId, bytes, name, url);
}
