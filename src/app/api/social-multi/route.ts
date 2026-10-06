import { z } from "zod";
import { defineRoute } from "@/server/route";
import { HttpError } from "@/server/http-error";
import type { SupabaseClient } from "@supabase/supabase-js";
import { paidTargetForUserRoute } from "@/server/billing/accounts.server";
import { runMetered } from "@/server/billing/metered.server";
import { PLATFORMS, type PlatformId } from "@/lib/social-platforms";
import { runStructuredPrompt } from "@/lib/ai";
import { system as sysBuilder } from "@/lib/ai/prompts/assemble";
import { assemble } from "@/lib/ai/prompts/assemble";
import { FMT_JSON_STRICT, FMT_NO_FENCES, identitySocialPM } from "@/lib/ai/prompts/fragments";

export const dynamic = "force-dynamic";

const PlatformEnum = z.enum([
  "linkedin",
  "twitter",
  "instagram",
  "facebook",
  "threads",
  "tiktok",
  "youtube",
]);

const BodySchema = z.object({
  prompt: z.string().min(1).max(4000),
  context: z.string().max(6000).optional(),
  platforms: z.array(PlatformEnum).min(1).max(7),
  /** The user asked for a different take — bypass the cached answer. */
  regenerate: z.boolean().optional(),
  /** Brand Kit Style: an id, "none", or absent for the workspace default. */
});

const VariantsSchema = z.object({
  variants: z
    .array(
      z.object({
        platform: z.string(),
        title: z.unknown().optional(),
        body: z.unknown().optional(),
        hashtags: z.unknown().optional(),
      }),
    )
    .min(1),
});

// Output budget per platform variant. The old single budget —
// min(2400, 400 + N×260), then clamped again to 1,200 by the gateway — left
// ~170 tokens per variant at seven platforms: thin, generic copy.
const TOKENS_PER_VARIANT = 450;

type Variant = {
  platform: PlatformId;
  title: string;
  body: string;
  hashtags: string[];
  chars: number;
};

/* --- Deterministic helpers (no AI) --- */
function clampChars(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.7 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

function normalizeHashtag(raw: unknown): string | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  const clean = t.replace(/^#+/, "").replace(/\s+/g, "");
  if (!clean) return null;
  return `#${clean}`;
}

function finalizeVariant(
  platform: PlatformId,
  raw: { title?: unknown; body?: unknown; hashtags?: unknown },
): Variant {
  const spec = PLATFORMS[platform];
  const rawTags = Array.isArray(raw.hashtags)
    ? (raw.hashtags as unknown[]).map(normalizeHashtag).filter((x): x is string => !!x)
    : [];
  // Dedupe (case-insensitive) + cap to platform max.
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const t of rawTags) {
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    tags.push(t);
    if (tags.length >= spec.hashtags[1]) break;
  }
  let body = String(raw.body ?? "").trim();
  const tagsStr = tags.length ? `\n\n${tags.join(" ")}` : "";
  const budget = Math.max(40, spec.maxChars - tagsStr.length);
  body = clampChars(body, budget);
  const finalText = `${body}${tagsStr}`;
  const title = String(raw.title ?? "").slice(0, 120) || `${spec.label} post`;
  return { platform, title, body: finalText, hashtags: tags, chars: finalText.length };
}

export const POST = defineRoute({
  name: "social-multi",
  auth: "user",
  body: BodySchema,
  rateLimit: "generate",
  handler: async ({ body, request, attributedWorkspaceId, userId, supabase }) => {
    const target = await paidTargetForUserRoute({
      attributedWorkspaceId,
      userId,
      supabase: supabase as unknown as SupabaseClient,
    });
    const metered = await runMetered(
      {
        ...target,
        userId,
        action: "social_multi",
        idempotencyKey: request.headers.get("Idempotency-Key") ?? crypto.randomUUID(),
        route: "social.multi",
      },
      async () => {
        // ── Single LLM call for all platforms (was N calls) ─────────
        // Build a per-platform rubric deterministically, and ask the
        // model to emit one JSON object with one variant per platform.
        const specs = body.platforms.map((p) => PLATFORMS[p]);
        const rubric = specs
          .map(
            (s) =>
              `- ${s.id} (${s.label}): body ≤ ${s.maxChars - 60}c, sweet spot ~${s.optimalChars}c, ${s.hashtags[0]}-${s.hashtags[1]} hashtags. Style: ${s.style}`,
          )
          .join("\n");

        const system = sysBuilder(
          identitySocialPM("multiple platforms"),
          "Write ONE native variant per requested platform. Each must be rewritten — different length, hook, rhythm — never copy-pasted between platforms.",
          "Body includes emojis/line breaks/CTA — NOT hashtags (hashtags go in the array).",
          FMT_JSON_STRICT,
          FMT_NO_FENCES,
          `Schema: {"variants":[{"platform":"<id>","title":string,"body":string,"hashtags":string[]}]}`,
        );

        // The style is read on the server for the VERIFIED workspace only.
        const styleText = attributedWorkspaceId
          ? await import("@/server/brand-look/resolve.server").then((m) =>
              m.lookTextFor(attributedWorkspaceId, "social"),
            )
          : "";
        // What the team told Mellox to remember (ADR-0033), same rule.
        const memoryText = attributedWorkspaceId
          ? await import("@/server/memory/context.server").then((m) =>
              m.memoryBlockFor(attributedWorkspaceId, "text"),
            )
          : "";
        const user = assemble([
          {
            label: "What the team asked Mellox to remember (follow it)",
            body: memoryText ? memoryText.replace(/^## .*\n/, "") : undefined,
            maxChars: 2000,
          },
          { label: "Brand context", body: body.context, maxChars: 4000 },
          {
            label: "Style (follow exactly; it overrides generic platform guidance)",
            body: styleText ? styleText.replace(/^## /gm, "### ") : undefined,
            maxChars: 3000,
          },
          { label: "Brief", body: body.prompt },
          { label: "Platforms + rules", body: rubric },
          { body: `Return exactly ${specs.length} variants — one per platform id in the list.` },
        ]);

        // Validated structured output: an unusable answer is repaired once, then
        // surfaced as a 502 instead of silently becoming "no variants".
        const parsed = await runStructuredPrompt({
          route: "social.multi",
          system,
          user,
          schema: VariantsSchema,
          maxTokens: Math.min(6000, 300 + specs.length * TOKENS_PER_VARIANT),
          temperature: 0.75,
          regenerate: body.regenerate,
        });

        const byPlatform = new Map<
          string,
          { title?: unknown; body?: unknown; hashtags?: unknown }
        >();
        for (const v of parsed.variants ?? []) {
          if (v && typeof v.platform === "string") byPlatform.set(v.platform, v);
        }

        const variants: Variant[] = [];
        const errors: { platform: PlatformId; error: string }[] = [];
        for (const p of body.platforms) {
          const raw = byPlatform.get(p);
          if (!raw || (!raw.body && !raw.title)) {
            errors.push({ platform: p, error: "Model returned no variant for this platform" });
            continue;
          }
          variants.push(finalizeVariant(p, raw));
        }

        if (!variants.length) throw new HttpError(502, errors[0]?.error ?? "All variants failed");
        return { variants, errors };
      },
    );
    return Response.json(
      metered.result,
      metered.balance === null
        ? undefined
        : {
            headers: { "X-Billing-Balance": String(metered.balance) },
          },
    );
  },
});
