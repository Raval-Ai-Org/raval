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

/**
 * Models that stay on KIE while text runs on OpenRouter (2026-11-28). From the
 * real bills, GPT-6.1 Sol costs about a quarter of OpenRouter's price on KIE,
 * and it only does analyst work nobody waits on per post (Brand DNA, strategy,
 * audience, campaign plans). Everything a post waits on stays on the faster
 * OpenRouter. AI_KIE_MODELS (comma list, or "none") overrides it.
 */
export const DEFAULT_KIE_TEXT_MODELS: readonly string[] = ["openai/gpt-6.1-sol"];

export function kieTextModels(): string[] {
  const raw = process.env.AI_KIE_MODELS?.trim();
  if (raw === undefined || raw === "") return [...DEFAULT_KIE_TEXT_MODELS];
  if (raw.toLowerCase() === "none") return [];
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

/** The provider a text request with this first model goes to. */
export function textProviderFor(primaryModel: string | undefined): AiProvider {
  if (aiProvider() === "kie") return "kie";
  if (!primaryModel || !process.env.KIE_API_KEY?.trim()) return "openrouter";
  return kieTextModels().includes(primaryModel) ? "kie" : "openrouter";
}

/** True when some text provider has a key (feature gates that need "AI is configured"). */
export function textAiConfigured(): boolean {
  return aiProvider() === "kie"
    ? Boolean(process.env.KIE_API_KEY?.trim())
    : Boolean(process.env.OPENROUTER_API_KEY?.trim());
}
