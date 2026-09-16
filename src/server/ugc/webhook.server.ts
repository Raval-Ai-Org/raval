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
