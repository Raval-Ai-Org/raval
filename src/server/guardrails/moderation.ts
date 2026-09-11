// moderation.ts — image moderation before anything is shared externally
// (proposal workstream D: "Image moderation pass before anything is shared
// externally").
//
// A vision model classifies the image against a fixed policy and must answer
// with structured JSON (validated with zod). Results are cached per image URL
// hash for 7 days. If the moderation provider is unavailable the verdict is
// "unverified" — the caller treats that as needing human acknowledgement,
// never as "safe" (fail CLOSED, unlike spend controls).
import "server-only";
import { z } from "zod";
import { cache, digest } from "@/server/cache/store";
import { logGuardrailEvent } from "./events";

export type ModerationVerdict = "safe" | "flagged" | "unverified";

export type ModerationResult = {
  verdict: ModerationVerdict;
  categories: string[];
  reason?: string;
};

const ResultSchema = z.object({
  safe: z.boolean(),
  categories: z.array(z.string()).default([]),
  reason: z.string().optional(),
});

const MODERATION_MODEL = "google/gemini-2.5-flash";
const CACHE_TTL_SECONDS = 7 * 24 * 3600;

const POLICY = [
  "You are an image safety reviewer for a brand marketing platform.",
  "Flag the image (safe=false) if it contains any of: sexual or nude content, graphic violence or gore, hate symbols or harassment, self-harm, illegal drugs or weapons promotion, content depicting minors inappropriately, or visible personal data (ID cards, bank cards, documents with personal details).",
  'Answer ONLY with JSON: {"safe": boolean, "categories": string[], "reason": string}. Categories use short snake_case names.',
].join("\n");

export type ModerationClassifier = (imageUrl: string) => Promise<unknown>;

const defaultClassifier: ModerationClassifier = async (imageUrl) => {
  const { chatCompletion } = await import("@/lib/ai-gateway.server");
  const json = await chatCompletion({
    model: MODERATION_MODEL,
    task: "generate",
    max_tokens: 200,
    temperature: 0,
    noCache: true,
    route: "guardrails.image-moderation",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: POLICY },
      {
        role: "user",
        content: [
          { type: "text", text: "Review this image." },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
  });
  return JSON.parse(String(json?.choices?.[0]?.message?.content ?? "{}"));
};

let classifier: ModerationClassifier = defaultClassifier;

/** Tests inject a classifier. */
export function setModerationClassifier(next: ModerationClassifier | null): void {
  classifier = next ?? defaultClassifier;
}

export async function moderateImage(imageUrl: string): Promise<ModerationResult> {
  if (!/^(https:\/\/|data:image\/)/i.test(imageUrl)) {
    return { verdict: "unverified", categories: [], reason: "Unsupported image source" };
  }
  const key = `moderation:${await digest(imageUrl)}`;
  const cached = await cache.get<ModerationResult>(key);
  if (cached) return cached;

  let result: ModerationResult;
  try {
    const parsed = ResultSchema.safeParse(await classifier(imageUrl));
    if (!parsed.success) throw new Error("moderation returned an unusable verdict");
    result = parsed.data.safe
      ? { verdict: "safe", categories: [] }
      : { verdict: "flagged", categories: parsed.data.categories, reason: parsed.data.reason };
  } catch (error) {
    logGuardrailEvent({
      kind: "moderation_unverified",
      severity: "warn",
      detail: { reason: error instanceof Error ? error.message.slice(0, 200) : "unknown" },
    });
    // Not cached: the next attempt may reach the provider.
    return { verdict: "unverified", categories: [], reason: "Image could not be checked" };
  }
  if (result.verdict === "flagged") {
    logGuardrailEvent({
      kind: "moderation_blocked",
      severity: "block",
      detail: { categories: result.categories.slice(0, 6) },
    });
  }
  await cache.set(key, result, CACHE_TTL_SECONDS);
  return result;
}
