// vision-extract.server.ts — text + visual description from an uploaded image
// (chat attachments via /api/file-extract).
//
// Cost shape: the `file-extract` route's plan (economy vision model) reads the
// image first; only when it returns almost nothing for a substantial image
// does the request apply the route's escalation (the workhorse model).
// Results are cached per tenant by image digest, so re-attaching the same
// image is free.
import "server-only";
import { chatCompletion } from "@/lib/ai-gateway.server";
import { FILE_EXTRACT_SYSTEM } from "@/lib/ai/prompts";
import { cache, digest, recordCacheLookup } from "@/server/cache/store";
import { getRequestScope } from "@/server/request-context";

const CACHE_TTL_SECONDS = 7 * 24 * 3600;
/** Below this many characters an answer counts as "read almost nothing". */
export const THIN_TEXT_CHARS = 40;
/** Images smaller than this rarely hold enough text to justify escalating. */
export const ESCALATE_MIN_BYTES = 150_000;

/** One read of the image; `escalate` applies the route's escalation rule. */
export type VisionCall = (
  escalate: boolean,
  dataUrl: string,
) => Promise<{ text: string; model: string }>;

const defaultCall: VisionCall = async (escalate, dataUrl) => {
  const json = await chatCompletion({
    task: "extraction",
    escalate,
    // Cached below by image digest instead of hashing the full base64 body twice.
    noCache: true,
    route: "file-extract",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: FILE_EXTRACT_SYSTEM },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });
  return {
    text: String(json?.choices?.[0]?.message?.content ?? ""),
    model: String(json?._model ?? "unknown"),
  };
};

/** Decoded byte size of a base64 data URL. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  return Math.floor(((dataUrl.length - comma - 1) * 3) / 4);
}

export async function extractImageText(
  dataUrl: string,
  call: VisionCall = defaultCall,
): Promise<{ text: string; model: string; cached: boolean }> {
  const scope = getRequestScope();
  const tenant = scope.workspaceId
    ? `ws:${scope.workspaceId}`
    : scope.userId
      ? `u:${scope.userId}`
      : "anon";
  const key = `vision:${await digest(`${tenant}|${dataUrl}`)}`;
  const hit = await cache.get<{ text: string; model: string }>(key);
  recordCacheLookup("vision", Boolean(hit));
  if (hit) return { ...hit, cached: true };

  let read = await call(false, dataUrl);
  let text = read.text.trim();
  if (text.length < THIN_TEXT_CHARS && dataUrlBytes(dataUrl) > ESCALATE_MIN_BYTES) {
    read = await call(true, dataUrl);
    text = read.text.trim();
  }
  const model = read.model;
  if (text) await cache.set(key, { text, model }, CACHE_TTL_SECONDS);
  return { text, model, cached: false };
}
