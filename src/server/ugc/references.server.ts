// Product reference images for video ads: stored in Mellox storage before any
// render (src/server/assets/reference-image.server.ts), so the video provider
// always fetches a stable, validated, signed URL we control.
import "server-only";
import { importImageFromUrl, storeUploadedImage } from "@/server/assets/reference-image.server";

const UGC = { source: "ugc-reference" } as const;

export async function storeUploadedReference(workspaceId: string, file: File) {
  return storeUploadedImage(workspaceId, file, UGC);
}

/** Import a product image from the product page (fetched through the SSRF guard). */
export async function importReferenceFromUrl(workspaceId: string, url: string) {
  return importImageFromUrl(workspaceId, url, UGC);
}
