// ai-provider.server.ts — which provider serves text, vision and pictures.
//
// KIE (kie.ai) is the default whenever KIE_API_KEY is set (2026-11-25: the
// OpenRouter account ran dry and Brand DNA scans failed). AI_PROVIDER=openrouter
// is the instant rollback; IMAGE_PROVIDER still overrides pictures on its own.
import "server-only";

export type AiProvider = "kie" | "openrouter";

export function aiProvider(): AiProvider {
  const chosen = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (chosen === "openrouter") return "openrouter";
  if (chosen === "kie") return "kie";
  return process.env.KIE_API_KEY?.trim() ? "kie" : "openrouter";
}

/** True when some text provider has a key (feature gates that need "AI is configured"). */
export function textAiConfigured(): boolean {
  return aiProvider() === "kie"
    ? Boolean(process.env.KIE_API_KEY?.trim())
    : Boolean(process.env.OPENROUTER_API_KEY?.trim());
}
