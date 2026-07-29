import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonError, requireUserId } from "@/server/api-auth";
import { PLATFORMS, type PlatformId } from "@/lib/social-platforms";
import { runJsonPrompt } from "@/lib/ai";
import { system as sysBuilder } from "@/lib/ai/prompts/assemble";
import { assemble } from "@/lib/ai/prompts/assemble";
import {
  FMT_JSON_STRICT,
  FMT_NO_FENCES,
  identitySocialPM,
} from "@/lib/ai/prompts/fragments";

const PlatformEnum = z.enum([
  "linkedin", "twitter", "instagram", "facebook", "threads", "tiktok", "youtube",
]);

const BodySchema = z.object({
  prompt: z.string().min(1).max(4000),
  context: z.string().max(6000).optional(),
  platforms: z.array(PlatformEnum).min(1).max(7),
});

type Variant = { platform: PlatformId; title: string; body: string; hashtags: string[]; chars: number };

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

function finalizeVariant(platform: PlatformId, raw: { title?: unknown; body?: unknown; hashtags?: unknown }): Variant {
  const spec = PLATFORMS[platform];
  const rawTags = Array.isArray(raw.hashtags) ? (raw.hashtags as unknown[]).map(normalizeHashtag).filter((x): x is string => !!x) : [];
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

export const Route = createFileRoute("/api/social-multi")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireUserId(request);
        if (!auth.ok) return auth.response;

        let body: z.infer<typeof BodySchema>;
        try { body = BodySchema.parse(await request.json()); }
        catch { return jsonError(400, "Invalid request body"); }

        // ── Single LLM call for all platforms (was N calls) ─────────
        // Build a per-platform rubric deterministically, and ask the
        // model to emit one JSON object with one variant per platform.
        const specs = body.platforms.map((p) => PLATFORMS[p]);
        const rubric = specs
          .map((s) => `- ${s.id} (${s.label}): body ≤ ${s.maxChars - 60}c, sweet spot ~${s.optimalChars}c, ${s.hashtags[0]}-${s.hashtags[1]} hashtags. Style: ${s.style}`)
          .join("\n");

        const system = sysBuilder(
          identitySocialPM("multiple platforms"),
          "Write ONE native variant per requested platform. Each must be rewritten — different length, hook, rhythm — never copy-pasted between platforms.",
          "Body includes emojis/line breaks/CTA — NOT hashtags (hashtags go in the array).",
          FMT_JSON_STRICT,
          FMT_NO_FENCES,
          `Schema: {"variants":[{"platform":"<id>","title":string,"body":string,"hashtags":string[]}]}`,
        );

        const user = assemble([
          { label: "Brand context", body: body.context, maxChars: 4000 },
          { label: "Brief", body: body.prompt },
          { label: "Platforms + rules", body: rubric },
          { body: `Return exactly ${specs.length} variants — one per platform id in the list.` },
        ]);

        try {
          const parsed = await runJsonPrompt<{ variants?: Array<{ platform?: string; title?: unknown; body?: unknown; hashtags?: unknown }> }>({
            route: "social.multi",
            system, user,
            fallback: { variants: [] },
            // Scales with platform count but capped — one call, not N.
            maxTokens: Math.min(2400, 400 + specs.length * 260),
            temperature: 0.75,
          });

          const byPlatform = new Map<string, { title?: unknown; body?: unknown; hashtags?: unknown }>();
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

          if (!variants.length) return jsonError(502, errors[0]?.error ?? "All variants failed");
          return Response.json({ variants, errors });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return jsonError(502, msg);
        }
      },
    },
  },
});
