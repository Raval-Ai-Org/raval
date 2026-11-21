// kie-image.server.ts — TEMPORARY image provider on KIE (2026-11-19), used
// while the OpenRouter balance is empty. Switched on by IMAGE_PROVIDER=kie;
// unset (or "openrouter") goes straight back to OpenRouter with no code change.
//
// It plugs in as the transport of openrouter-image.server.ts, so routing,
// budget, cache, safety checks, metering and Studio's task parking all stay
// exactly the same. KIE runs the same GPT Image 2.5 models (Flare / Sunburst,
// text-to-image and image-to-image); Recraft isn't on KIE, so a Recraft pick
// is drawn by Flare here.
//
// KIE is asynchronous: create a task, poll recordInfo, download the result.
// KIE fetches references itself, so each one (already made readable as a
// data URL) is put in KIE's own temporary file store first.
import "server-only";
import { randomUUID } from "node:crypto";
import { safeFetch } from "@/server/safe-fetch";
import { log } from "@/server/observability/logger";
import { round6 } from "@/server/ai/pricing";
import { createKieTask, getKieTask, KieGatewayError } from "./kie-gateway.server";
import { AiGatewayError } from "./ai-gateway.server";
import { normalizeReferenceImages } from "./image-reference.server";
import { IMAGE_FLARE, isRecraftModel } from "./model-router.server";
import type { GeneratedImage, ImageRequest } from "./openrouter-image.server";

const KIE_UPLOAD = "https://kieai.redpandaai.co/api/file-base64-upload";
const POLL_EVERY_MS = 2_500;
const TASK_TIMEOUT_MS = 150_000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
/** KIE's GPT Image 2.5 takes at most this many reference images. */
const MAX_KIE_REFERENCES = 4;
/** Used only when KIE doesn't report the credits a task took. */
const FALLBACK_USD = 0.04;

export function imageProvider(): "kie" | "openrouter" {
  return process.env.IMAGE_PROVIDER?.trim().toLowerCase() === "kie" ? "kie" : "openrouter";
}

/** The model KIE draws a request with (Recraft → Flare; KIE has no Recraft). */
export function kieServedModel(model: string): string {
  return isRecraftModel(model) ? IMAGE_FLARE : model;
}

/** OpenRouter id → KIE model name. */
export function kieModelName(model: string, withReferences: boolean): string {
  const tier = /sunburst/i.test(model) ? "sunburst" : "flare";
  return `gpt-image-2-5-${tier}-${withReferences ? "image-to-image" : "text-to-image"}`;
}

/** KIE's GPT Image 2.5 rejects 4:5 (confirmed live), so 3:4 is used as before. */
export function kieAspectRatio(aspectRatio: string): string {
  return aspectRatio === "4:5" ? "3:4" : aspectRatio;
}

function usdPerCredit(): number {
  const raw = Number(process.env.KIE_USD_PER_CREDIT);
  return Number.isFinite(raw) && raw > 0 ? raw : 0.005;
}

/** Map a KIE failure onto the gateway's codes, so fallbacks and retries behave the same. */
function asGatewayError(error: unknown): AiGatewayError {
  if (error instanceof AiGatewayError) return error;
  if (error instanceof KieGatewayError) {
    const detail = error.detail || error.message;
    if (error.providerCode === 402 || /credit|balance|insufficient/i.test(detail))
      return new AiGatewayError(402, "The KIE account is out of credits.", "insufficient_credits");
    if (error.category === "authentication")
      return new AiGatewayError(503, "KIE refused the API key.", "invalid_api_key");
    if (error.category === "configuration")
      return new AiGatewayError(503, "KIE_API_KEY is not set.", "missing_api_key");
    if (error.category === "rate_limit")
      return new AiGatewayError(429, "KIE is busy. Please try again shortly.", "rate_limited");
    if (error.category === "timeout")
      return new AiGatewayError(504, "Image generation timed out. Please retry.", "timeout");
    if (error.category === "request")
      return new AiGatewayError(422, detail.slice(0, 300), "invalid_request");
    return new AiGatewayError(502, detail.slice(0, 300), "provider_error");
  }
  return new AiGatewayError(502, "The image provider could not be reached.", "network_error");
}

/** Put one data-URL reference in KIE's temporary file store; https stays as it is. */
async function kieReferenceUrl(reference: string): Promise<string> {
  if (/^https:\/\//i.test(reference)) return reference;
  const mime = /^data:(image\/[a-z+.-]+);/i.exec(reference)?.[1] ?? "image/jpeg";
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  const res = await fetch(KIE_UPLOAD, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.KIE_API_KEY?.trim() ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      base64Data: reference,
      uploadPath: "mellox/image-refs",
      fileName: `${randomUUID()}.${ext}`,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json().catch(() => null)) as {
    data?: { downloadUrl?: string };
    msg?: string;
  } | null;
  const url = json?.data?.downloadUrl;
  if (!res.ok || typeof url !== "string" || !/^https:\/\//i.test(url)) {
    throw new AiGatewayError(
      502,
      `KIE couldn't take the reference picture${json?.msg ? `: ${json.msg}` : "."}`,
      "provider_error",
    );
  }
  return url;
}

async function waitForResult(taskId: string): Promise<{ url: string; credits: number | null }> {
  const deadline = Date.now() + TASK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_EVERY_MS));
    const record = await getKieTask(taskId);
    if (record.state === "success") {
      const url = record.urls.find((u) => /\.(png|jpe?g|webp)(?:\?|$)/i.test(u)) ?? record.urls[0];
      if (!url)
        throw new AiGatewayError(502, "The image provider returned no image.", "empty_response");
      return { url, credits: record.creditsConsumed };
    }
    if (record.state === "failed") {
      const message = record.failMessage || "KIE couldn't make this picture.";
      const refused = /safety|policy|moderation|sensitive|nsfw|violat/i.test(message);
      throw new AiGatewayError(
        refused ? 422 : 502,
        message,
        refused ? "refusal" : "provider_error",
      );
    }
  }
  // The task may still finish and be billed: never resubmit blindly from here.
  throw new AiGatewayError(504, "Image generation timed out. Please retry.", "timeout");
}

/** One picture on KIE, in the same shape the OpenRouter transport returns. */
export async function kieImage(req: ImageRequest): Promise<GeneratedImage> {
  const started = Date.now();
  try {
    const readable = req.references.length
      ? await normalizeReferenceImages(req.references.slice(0, MAX_KIE_REFERENCES))
      : [];
    const imageUrls = await Promise.all(readable.map(kieReferenceUrl));
    const model = kieModelName(req.model, imageUrls.length > 0);
    const input: Record<string, unknown> = {
      prompt: req.prompt.slice(0, 10_000),
      aspect_ratio: kieAspectRatio(req.aspectRatio),
      resolution: "1K",
      background: req.background ?? "opaque",
      ...(imageUrls.length ? { image_urls: imageUrls } : {}),
    };
    const { taskId } = await createKieTask({ model, input });
    const result = await waitForResult(taskId);
    const download = await safeFetch(result.url, {
      timeoutMs: 60_000,
      maxBytes: MAX_IMAGE_BYTES,
      onOverflow: "error",
    });
    if (!download.ok || !download.bytes.length)
      throw new AiGatewayError(
        502,
        "The generated picture couldn't be downloaded.",
        "provider_error",
      );
    const mimeType = download.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
    log.info("kie.image.completed", {
      model,
      taskId,
      references: imageUrls.length,
      credits: result.credits,
      elapsedMs: Date.now() - started,
    });
    return {
      b64: Buffer.from(download.bytes).toString("base64"),
      mimeType: mimeType.startsWith("image/") ? mimeType : "image/png",
      model: req.model,
      costUsd: result.credits != null ? round6(result.credits * usdPerCredit()) : FALLBACK_USD,
    };
  } catch (error) {
    const mapped = asGatewayError(error);
    log.warn("kie.image.failed", {
      model: req.model,
      code: mapped.code,
      message: mapped.message.slice(0, 300),
      elapsedMs: Date.now() - started,
    });
    throw mapped;
  }
}
