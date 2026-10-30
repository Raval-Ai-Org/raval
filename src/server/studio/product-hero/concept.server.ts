// This poster's own scene idea and headline (ADR-0040). One small model call
// (route `studio.hero.concept`, priced in `product_hero`); what it proposes
// is checked by `groundConcept`. Fails open: no idea and the copy writer's
// line, never a failed piece.
import "server-only";
import { llmJson } from "@/lib/ai-gateway.server";
import {
  conceptMessages,
  groundConcept,
  type ConceptInput,
  type HeroConcept,
} from "@/lib/studio/product-hero/concept";

export async function writeHeroConcept(input: ConceptInput): Promise<HeroConcept> {
  const facts = [
    input.product.name,
    input.product.category,
    input.product.description,
    ...(input.product.benefits ?? []),
    input.fixedHeadline,
  ]
    .filter(Boolean)
    .join("\n");
  try {
    const { system, user } = conceptMessages(input);
    const raw = await llmJson<Record<string, unknown> | null>({
      route: "studio.hero.concept",
      system,
      user,
      timeoutMs: 30_000,
      fallback: null,
    });
    return groundConcept(raw, {
      facts,
      recentHeadlines: input.recent.map((r) => r.headline ?? "").filter(Boolean),
      allowText: input.allowText && !input.fixedHeadline,
    });
  } catch (error) {
    console.warn("[product-hero] concept failed", error instanceof Error ? error.message : error);
    return { scene: null, headline: null, support: null };
  }
}
