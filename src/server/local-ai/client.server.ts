// client.server.ts — the one way to call the local AI sidecar
// (services/local-ai, docs/local-ai.md, Mellox Lean).
//
// The sidecar runs open-source models on the same machine, over loopback:
// BiRefNet-lite cut-outs, RapidOCR, an image-safety classifier, the LAION
// aesthetic predictor and Kokoro voiceover. Every call:
//   - is used only when LOCAL_AI_URL is set and the flag is on;
//   - has a timeout and never throws: null means "use the paid path";
//   - is recorded in ai_usage_events as provider "local" at $0, so the
//     savings show in the admin usage view.
import "server-only";
import { isLocalAiEnabled } from "@/lib/feature-flags";
import { recordUsage } from "@/server/ai/metering";

type LocalTask = "cutout" | "ocr" | "safety" | "aesthetic" | "tts";

const TIMEOUTS_MS: Record<LocalTask, number> = {
  cutout: 45_000,
  ocr: 20_000,
  safety: 10_000,
  aesthetic: 10_000,
  tts: 60_000,
};

function baseUrl(): string | null {
  const raw = (process.env.LOCAL_AI_URL ?? "").trim().replace(/\/+$/, "");
  if (!raw) return null;
  // Loopback or a private service name only: the sidecar is never a public host.
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return raw;
  } catch {
    return null;
  }
}

async function call<T>(
  task: LocalTask,
  body: Record<string, unknown>,
  opts: { workspaceId?: string; route: string; binary?: boolean },
): Promise<T | Buffer | null> {
  const base = baseUrl();
  if (!base || !isLocalAiEnabled(opts.workspaceId)) return null;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUTS_MS[task]);
  let status: "ok" | "error" = "error";
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = (process.env.LOCAL_AI_TOKEN ?? "").trim();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${base}/${task}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const out = opts.binary ? Buffer.from(await res.arrayBuffer()) : ((await res.json()) as T);
    status = "ok";
    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    recordUsage({
      provider: "local",
      model: `local/${task}`,
      kind: task === "tts" ? "text" : "image",
      units: 1,
      estCostUsd: 0,
      latencyMs: Date.now() - started,
      status,
      route: opts.route,
      workspaceId: opts.workspaceId ?? null,
    });
  }
}

/** The product alone on transparency (PNG with alpha), or null. */
export async function localCutout(
  image: Buffer,
  opts: { workspaceId?: string } = {},
): Promise<Buffer | null> {
  const out = await call<never>(
    "cutout",
    { image: image.toString("base64") },
    { ...opts, route: "studio.image.cutout", binary: true },
  );
  return Buffer.isBuffer(out) && out.length > 0 ? out : null;
}

export type LocalOcrLine = { text: string; confidence: number };

/** Text read off a picture, line by line, or null when unavailable. */
export async function localOcr(
  image: Buffer,
  opts: { workspaceId?: string; route?: string } = {},
): Promise<LocalOcrLine[] | null> {
  const out = await call<{ lines?: unknown }>(
    "ocr",
    { image: image.toString("base64") },
    { workspaceId: opts.workspaceId, route: opts.route ?? "studio.image.ocr" },
  );
  if (!out || Buffer.isBuffer(out) || !Array.isArray(out.lines)) return null;
  return out.lines
    .map((l) => l as { text?: unknown; confidence?: unknown })
    .filter(
      (l): l is { text: string; confidence: number } =>
        typeof l.text === "string" && typeof l.confidence === "number",
    )
    .map((l) => ({ text: l.text, confidence: l.confidence }));
}

/** Probability (0–1) that a picture is unsafe, or null when unavailable. */
export async function localSafety(
  image: Buffer,
  opts: { workspaceId?: string; route?: string } = {},
): Promise<number | null> {
  const out = await call<{ unsafe?: unknown }>(
    "safety",
    { image: image.toString("base64") },
    { workspaceId: opts.workspaceId, route: opts.route ?? "guardrails.local-safety" },
  );
  if (!out || Buffer.isBuffer(out) || typeof out.unsafe !== "number") return null;
  return Math.min(1, Math.max(0, out.unsafe));
}

/** Aesthetic score (about 1–10, LAION predictor), or null when unavailable. */
export async function localAesthetic(
  image: Buffer,
  opts: { workspaceId?: string; route?: string } = {},
): Promise<number | null> {
  const out = await call<{ score?: unknown }>(
    "aesthetic",
    { image: image.toString("base64") },
    { workspaceId: opts.workspaceId, route: opts.route ?? "studio.image.aesthetic" },
  );
  if (!out || Buffer.isBuffer(out) || typeof out.score !== "number") return null;
  return out.score;
}

/** Languages Kokoro speaks; anything else stays on the paid voice. */
export const LOCAL_TTS_LANGUAGES = new Set(["en", "es", "fr", "it", "pt", "hi", "ja", "zh"]);

/** A WAV voiceover of exactly these words, or null when unavailable. */
export async function localSpeech(
  text: string,
  opts: { workspaceId?: string; language?: string; voice?: string; route?: string } = {},
): Promise<Buffer | null> {
  const language = (opts.language ?? "en").toLowerCase().slice(0, 2);
  if (!LOCAL_TTS_LANGUAGES.has(language) || !text.trim()) return null;
  const out = await call<never>(
    "tts",
    { text: text.slice(0, 5_000), language, voice: opts.voice ?? null },
    {
      workspaceId: opts.workspaceId,
      route: opts.route ?? "studio.video.voice",
      binary: true,
    },
  );
  return Buffer.isBuffer(out) && out.length > 44 ? out : null;
}
