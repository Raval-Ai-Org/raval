import { createParser } from "eventsource-parser";
import { flushSync } from "react-dom";
import { authedFetch } from "./authed-fetch";

type Payload = { b64_json: string; mime_type?: string };
const IMAGE_EVENTS = new Set([
  "image_generation.partial_image",
  "image_generation.completed",
]);

function payloadToFrame(data: string, eventName?: string) {
  if (!data || data === "[DONE]") return null;
  let payload: Payload;
  try {
    payload = JSON.parse(data) as Payload;
  } catch {
    return null;
  }
  if (!payload.b64_json) return null;
  const mimeType = typeof payload.mime_type === "string" ? payload.mime_type : "image/png";
  return {
    dataUrl: `data:${mimeType};base64,${payload.b64_json}`,
    isFinal: eventName === "image_generation.completed" || !eventName,
  };
}

/**
 * Stream image generation from /api/generate-image.
 * onFrame fires for each partial + the final frame.
 */
export async function streamImage(
  prompt: string,
  onFrame: (dataUrl: string, isFinal: boolean) => void,
  opts: {
    signal?: AbortSignal;
    size?: "1024x1024" | "1792x1024" | "1024x1792";
    style?: "realistic_image" | "digital_illustration" | "vector_illustration";
  } = {},
): Promise<void> {
  const res = await authedFetch("/api/generate-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, size: opts.size ?? "1024x1024", style: opts.style }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    let msg = `Image generation failed (${res.status})`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {}
    throw new Error(msg);
  }

  let sawCompleted = false;
  const parser = createParser({
    onEvent(event) {
      const eventName = event.event || undefined;
      if (eventName && !IMAGE_EVENTS.has(eventName)) return;
      const frame = payloadToFrame(event.data, eventName);
      if (!frame) return;
      flushSync(() => {
        onFrame(frame.dataUrl, frame.isFinal);
      });
      if (frame.isFinal) sawCompleted = true;
    },
  });

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      parser.feed(value);
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  if (!sawCompleted) throw new Error("Image stream ended without completion");
}
