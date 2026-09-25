// Kie.ai task callbacks (docs.kie.ai/common-api/webhook-verification):
//   X-Webhook-Timestamp: unix seconds
//   X-Webhook-Signature: base64(HMAC-SHA256(`${taskId}.${timestamp}`, KIE_WEBHOOK_HMAC_KEY))
//
// A verified callback is only a nudge: the render is re-read from Kie's
// recordInfo by the engine, so a forged or replayed body can never mark a
// render done, pick its video URL or change what is charged.
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export const MAX_CALLBACK_BYTES = 256 * 1024;
export const CALLBACK_TOLERANCE_SECONDS = 15 * 60;

export type CallbackVerdict =
  { ok: true; taskId: string } | { ok: false; status: number; reason: string };

/** The task id Kie sends in its callback body (market and Veo shapes). */
export function callbackTaskId(body: unknown): string | null {
  const b = body as {
    data?: { taskId?: unknown; task_id?: unknown };
    taskId?: unknown;
    task_id?: unknown;
  };
  const id = b?.data?.taskId ?? b?.data?.task_id ?? b?.taskId ?? b?.task_id;
  return typeof id === "string" && /^[A-Za-z0-9_-]{6,128}$/.test(id) ? id : null;
}

export function signKieCallback(taskId: string, timestamp: string, key: string): string {
  return createHmac("sha256", key).update(`${taskId}.${timestamp}`).digest("base64");
}

export function verifyKieCallback(input: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  key: string | undefined;
  nowSeconds?: number;
}): CallbackVerdict {
  if (!input.key) return { ok: false, status: 503, reason: "callbacks not configured" };
  if (Buffer.byteLength(input.rawBody) > MAX_CALLBACK_BYTES) {
    return { ok: false, status: 413, reason: "payload too large" };
  }
  let body: unknown;
  try {
    body = JSON.parse(input.rawBody);
  } catch {
    return { ok: false, status: 400, reason: "malformed" };
  }
  const taskId = callbackTaskId(body);
  if (!taskId) return { ok: false, status: 400, reason: "missing task id" };
  if (!input.signature || !input.timestamp || !/^\d{9,11}$/.test(input.timestamp)) {
    return { ok: false, status: 401, reason: "missing signature" };
  }
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(input.timestamp)) > CALLBACK_TOLERANCE_SECONDS) {
    return { ok: false, status: 401, reason: "stale timestamp" };
  }
  const expected = Buffer.from(signKieCallback(taskId, input.timestamp, input.key));
  const provided = Buffer.from(input.signature.trim());
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return { ok: false, status: 401, reason: "bad signature" };
  }
  return { ok: true, taskId };
}

/* ───────────── OpenRouter video callbacks (docs: guides/overview/multimodal/video-generation) ─────────────
 *   X-OpenRouter-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(`${t},${rawBody}`, OPENROUTER_WEBHOOK_SECRET)>
 * Body: { type: "video.generation.completed" | …failed | …cancelled | …expired, data: { id, status, … } }
 * Like Kie's, a verified callback is only a nudge: the engine re-reads the job.
 */
export const OPENROUTER_CALLBACK_TOLERANCE_SECONDS = 5 * 60;

export function signOpenRouterCallback(timestamp: string, rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp},${rawBody}`).digest("hex");
}

export function verifyOpenRouterCallback(input: {
  rawBody: string;
  signature: string | null;
  secret: string | undefined;
  nowSeconds?: number;
}): CallbackVerdict {
  if (!input.secret) return { ok: false, status: 503, reason: "callbacks not configured" };
  if (Buffer.byteLength(input.rawBody) > MAX_CALLBACK_BYTES) {
    return { ok: false, status: 413, reason: "payload too large" };
  }
  const parts = (input.signature ?? "").split(",").map((p) => p.trim());
  const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2) ?? "";
  const hash = parts.find((p) => p.startsWith("v1="))?.slice(3) ?? "";
  if (!/^\d{9,11}$/.test(timestamp) || !/^[0-9a-f]{64}$/i.test(hash)) {
    return { ok: false, status: 401, reason: "missing signature" };
  }
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const age = now - Number(timestamp);
  if (age > OPENROUTER_CALLBACK_TOLERANCE_SECONDS || age < -60) {
    return { ok: false, status: 401, reason: "stale timestamp" };
  }
  const expected = Buffer.from(signOpenRouterCallback(timestamp, input.rawBody, input.secret));
  const provided = Buffer.from(hash.toLowerCase());
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return { ok: false, status: 401, reason: "bad signature" };
  }
  let body: { data?: { id?: unknown } } | null;
  try {
    body = JSON.parse(input.rawBody);
  } catch {
    return { ok: false, status: 400, reason: "malformed" };
  }
  const id = body?.data?.id;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{4,128}$/.test(id)) {
    return { ok: false, status: 400, reason: "missing job id" };
  }
  return { ok: true, taskId: id };
}
