const KIE_BASE = "https://api.kie.ai/api/v1";
const KIE_IMAGE_MODEL = process.env.KIE_IMAGE_MODEL?.trim() || "gpt-image-2-text-to-image";
const KIE_VIDEO_MODEL = process.env.KIE_VIDEO_MODEL?.trim() || "veo-3-1";
const SUPPORTED_VIDEO_DURATIONS = [4, 6, 8] as const;
const TASK_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 3_000;
const IMAGE_URL_TIMEOUT_MS = 30_000;
const IMAGE_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const imageCache = new Map<string, { image: { b64: string; mimeType: string }; expires: number }>();
const inflight = new Map<string, Promise<{ b64: string; mimeType: string }>>();

export type MediaType = "image" | "video" | "audio";

export type GeneratedMedia = {
  type: MediaType;
  provider: "kie";
  generationId: string;
  urls: string[];
  mimeType: string;
};

export type VideoAspectRatio = "adaptive" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
export type VideoResolution = "480P" | "720P" | "1080P";

function normalizeKieAspectRatio(value?: VideoAspectRatio): "16:9" | "9:16" | "1:1" | "4:3" | "3:4" {
  switch (value ?? "16:9") {
    case "9:16":
      return "9:16";
    case "1:1":
      return "1:1";
    case "4:3":
      return "4:3";
    case "3:4":
      return "3:4";
    case "adaptive":
    case "16:9":
    default:
      return "16:9";
  }
}

export type GeneratedVideo = {
  type: "video";
  provider: "kie";
  generationId: string;
  videoUrl: string;
  thumbnailUrl?: string;
  duration: number;
  aspectRatio: VideoAspectRatio;
  model: string;
  status: "completed";
  metadata?: Record<string, unknown>;
};

export function getKieConfigStatus() {
  return {
    configured: Boolean(process.env.KIE_API_KEY?.trim()),
    modelConfigured: Boolean(process.env.KIE_IMAGE_MODEL?.trim()),
    model: KIE_IMAGE_MODEL,
    videoModelConfigured: Boolean(process.env.KIE_VIDEO_MODEL?.trim()),
    videoModel: KIE_VIDEO_MODEL,
    runtime: "node",
  } as const;
}

export class KieGatewayError extends Error {
  status: number;
  category: string;

  constructor(status: number, message: string, category = "provider") {
    super(message);
    this.status = status;
    this.category = category;
  }
}

function getApiKey(): string {
  const key = process.env.KIE_API_KEY?.trim();
  if (!key) {
    throw new KieGatewayError(
      503,
      "Kie image generation is not configured. Set KIE_API_KEY on the server and restart the app.",
      "configuration",
    );
  }
  return key;
}

function headers(key: string): HeadersInit {
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

function mapStatus(status: number, detail?: string): KieGatewayError {
  const message = detail || "The request was not accepted by the Kie provider.";
  if (status === 401 || status === 403)
    return new KieGatewayError(503, "Kie authentication failed. Check the server-side API key.", "authentication");
  if (status === 429)
    return new KieGatewayError(429, "Kie is rate limiting generation requests. Please try again shortly.", "rate_limit");
  if (status === 422)
    return new KieGatewayError(422, message, "request");
  if (status >= 400 && status < 500)
    return new KieGatewayError(400, message, "request");
  return new KieGatewayError(502, "The image provider is temporarily unavailable.", "provider");
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    let payload: any;
    try {
      payload = await response.json();
    } catch {
      if (!response.ok) throw mapStatus(response.status, "The Kie provider returned malformed data.");
      throw new KieGatewayError(502, "The Kie provider returned malformed data.", "response");
    }

    const kCode = Number(payload?.code ?? payload?.status ?? 0);
    if (payload && (payload.code !== undefined || payload.status !== undefined)) {
      const msg = typeof payload?.msg === "string" ? payload.msg : undefined;
      if (kCode !== 200 && kCode !== 0) {
        throw mapStatus(kCode || response.status || 400, msg || "Kie rejected this request.");
      }
    }

    if (!response.ok) throw mapStatus(response.status, payload?.msg || "The Kie provider rejected the request.");
    return payload;
  } catch (error) {
    if (error instanceof KieGatewayError) throw error;
    if ((error as { name?: string })?.name === "AbortError")
      throw new KieGatewayError(504, "Image generation timed out. Please retry.", "timeout");
    throw new KieGatewayError(502, "The image provider could not be reached.", "network");
  } finally {
    clearTimeout(timer);
  }
}

function aspectRatio(size: "1024x1024" | "1792x1024" | "1024x1792"): string {
  if (size === "1792x1024") return "16:9";
  if (size === "1024x1792") return "9:16";
  return "1:1";
}

async function cacheKey(prompt: string, size: string): Promise<string> {
  const bytes = new TextEncoder().encode(`kie|${KIE_IMAGE_MODEL}|${size}|${prompt}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function resultUrls(record: any): string[] {
  const visit = (value: any, depth: number): string[] => {
    if (depth > 8 || value == null) return [];
    if (typeof value === "string") {
      if (/^https:\/\//i.test(value)) return [value];
      try {
        return visit(JSON.parse(value), depth + 1);
      } catch {
        return [];
      }
    }
    if (Array.isArray(value)) return value.flatMap((item) => visit(item, depth + 1));
    if (typeof value !== "object") return [];

    const urls: string[] = [];
    for (const key of [
      "resultUrls",
      "result_urls",
      "urls",
      "images",
      "videos",
      "videoUrl",
      "video_url",
      "url",
    ]) {
      if (key in value) urls.push(...visit(value[key], depth + 1));
    }
    for (const key of ["resultJson", "result_json", "result", "data"]) {
      if (key in value) urls.push(...visit(value[key], depth + 1));
    }
    return [...new Set(urls)];
  };

  return visit(record, 0);
}

async function createTask(prompt: string, size: "1024x1024" | "1792x1024" | "1024x1792") {
  const json = await fetchJson(
    `${KIE_BASE}/jobs/createTask`,
    {
      method: "POST",
      headers: headers(getApiKey()),
      body: JSON.stringify({
        model: KIE_IMAGE_MODEL,
        input: {
          prompt: prompt.slice(0, 10_000),
          aspect_ratio: aspectRatio(size),
          resolution: "1K",
          background: "opaque",
        },
      }),
    },
    30_000,
  );
  const taskId = json?.data?.taskId ?? json?.data?.task_id ?? json?.taskId ?? json?.task_id;
  if (typeof taskId !== "string" || !taskId) {
    throw new KieGatewayError(502, "The image provider did not return a task ID.", "response");
  }
  return taskId;
}

async function waitForTask(taskId: string): Promise<string[]> {
  const deadline = Date.now() + TASK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const json = await fetchJson(
      `${KIE_BASE}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
      { headers: headers(getApiKey()) },
      30_000,
    );
    const record = json?.data ?? json;
    const state = String(record?.state ?? record?.status ?? record?.taskStatus ?? "").toLowerCase();
    if (["success", "completed", "succeeded"].includes(state)) {
      const urls = resultUrls(record);
      if (!urls.length)
        throw new KieGatewayError(502, "The image provider returned no image.", "response");
      return urls;
    }
    if (["fail", "failed", "error", "cancelled"].includes(state)) {
      throw new KieGatewayError(502, "Image generation failed at the provider.", "generation");
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new KieGatewayError(504, "Image generation timed out. Please retry.", "timeout");
}

async function downloadImage(url: string): Promise<{ b64: string; mimeType: string }> {
  if (!/^https:\/\//i.test(url))
    throw new KieGatewayError(502, "The image provider returned an invalid image URL.", "response");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_URL_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok)
      throw new KieGatewayError(502, "The generated image could not be downloaded.", "storage");
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return {
      b64: btoa(binary),
      mimeType: response.headers.get("content-type")?.split(";")[0] || "image/png",
    };
  } catch (error) {
    if (error instanceof KieGatewayError) throw error;
    throw new KieGatewayError(502, "The generated image could not be downloaded.", "network");
  } finally {
    clearTimeout(timer);
  }
}

export async function imageGenerationStream(opts: {
  prompt: string;
  size?: "1024x1024" | "1792x1024" | "1024x1792";
}): Promise<Response> {
  const size = opts.size ?? "1024x1024";
  const key = await cacheKey(opts.prompt, size);
  const cached = imageCache.get(key);
  let image = cached && cached.expires > Date.now() ? cached.image : undefined;
  if (!image) {
    imageCache.delete(key);
    let pending = inflight.get(key);
    if (!pending) {
      pending = (async () => {
        const taskId = await createTask(opts.prompt, size);
        const [url] = await waitForTask(taskId);
        const downloaded = await downloadImage(url);
        imageCache.set(key, { image: downloaded, expires: Date.now() + IMAGE_CACHE_TTL_MS });
        return downloaded;
      })();
      inflight.set(key, pending);
      void pending.then(
        () => inflight.delete(key),
        () => inflight.delete(key),
      );
    }
    image = await pending;
  }
  const payload = JSON.stringify({ b64_json: image.b64, mime_type: image.mimeType });
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(`event: image_generation.completed\ndata: ${payload}\n\n`),
      );
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export async function videoGeneration(opts: {
  prompt: string;
  aspectRatio?: VideoAspectRatio;
  duration?: number;
  resolution?: VideoResolution;
  audio?: boolean;
  seed?: number;
}): Promise<GeneratedVideo> {
  const aspectRatio = normalizeKieAspectRatio(opts.aspectRatio);
  const duration = opts.duration ?? 6;
  const resolution = opts.resolution ?? "720P";
  if (!Number.isInteger(duration) || !SUPPORTED_VIDEO_DURATIONS.includes(duration as (typeof SUPPORTED_VIDEO_DURATIONS)[number])) {
    throw new KieGatewayError(400, "Video duration must be 4, 6, or 8 seconds.", "request");
  }
  if (!opts.prompt.trim()) {
    throw new KieGatewayError(400, "A video prompt is required.", "request");
  }

  const model = KIE_VIDEO_MODEL?.trim() || "veo-3-1";
  if (!model) {
    throw new KieGatewayError(503, "Kie video generation is not configured. Set KIE_VIDEO_MODEL on the server.", "configuration");
  }

  const json = await fetchJson(
    `${KIE_BASE}/jobs/createTask`,
    {
      method: "POST",
      headers: headers(getApiKey()),
      body: JSON.stringify({
        model,
        input: {
          prompt: opts.prompt.slice(0, 20_000),
          resolution,
          aspect_ratio: aspectRatio,
          duration,
          audio: opts.audio ?? true,
          seed: opts.seed ?? 0,
          nsfw_checker: true,
        },
      }),
    },
    30_000,
  );
  const taskId = json?.data?.taskId ?? json?.data?.task_id ?? json?.taskId ?? json?.task_id;
  if (typeof taskId !== "string" || !taskId) {
    throw new KieGatewayError(502, "The video provider did not return a task ID.", "response");
  }

  const deadline = Date.now() + TASK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const statusJson = await fetchJson(
      `${KIE_BASE}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
      { headers: headers(getApiKey()) },
      30_000,
    );
    const record = statusJson?.data ?? statusJson;
    const state = String(record?.state ?? record?.status ?? record?.taskStatus ?? "").toLowerCase();
    if (["fail", "failed", "error", "cancelled"].includes(state)) {
      throw new KieGatewayError(502, "Kie.ai failed to generate the video.", "generation");
    }
    if (["success", "completed", "succeeded"].includes(state)) {
      const urls = resultUrls(record);
      const videoUrl = urls.find((url) => /\.(mp4|webm|mov)(?:\?|$)/i.test(url)) ?? urls[0];
      if (!videoUrl || !/^https:\/\//i.test(videoUrl)) {
        throw new KieGatewayError(502, "Kie.ai returned no usable video result.", "response");
      }
      const thumbnailUrl = urls.find((url) => /\.(png|jpe?g|webp)(?:\?|$)/i.test(url));
      return {
        type: "video",
        provider: "kie",
        generationId: taskId,
        videoUrl,
        thumbnailUrl,
        duration,
        aspectRatio,
        model,
        status: "completed",
        metadata: { resolution, audio: opts.audio ?? true },
      };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new KieGatewayError(504, "Video generation took too long and timed out.", "timeout");
}
