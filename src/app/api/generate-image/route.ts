import { z } from "zod";
import { defineRoute } from "@/server/route";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  prompt: z
    .string()
    .transform((value) => value.slice(0, 4000).trim())
    .pipe(z.string().min(1, "Prompt required")),
  size: z.enum(["1024x1024", "1792x1024", "1024x1792"]).default("1024x1024"),
  style: z.enum(["realistic_image", "digital_illustration", "vector_illustration"]).optional(),
  // Routing hints are advisory: unknown values fall back to the defaults
  // rather than failing the request, matching the previous behaviour.
  hasReference: z.unknown().optional(),
  referenceAssets: z.unknown().optional(),
  editing: z.unknown().optional(),
  requiredQuality: z.unknown().optional(),
  iteration: z.unknown().optional(),
  latency: z.unknown().optional(),
  metadata: z.unknown().optional(),
  maxAttempts: z.unknown().optional(),
  /**
   * Apply a Brand Kit Style: a style id, "default" for the workspace default,
   * or "none". Only honoured for a verified workspace (x-workspace-id).
   */
  brandStyle: z.union([z.string().uuid(), z.literal("default"), z.literal("none")]).optional(),
});

/**
 * Append the workspace's Style to the prompt (server-side, so the browser
 * can't claim a style it doesn't own) and supply its reference posts when
 * the caller brought none. Never throws — a failed load means no style.
 */
async function styled(
  workspaceId: string | undefined,
  choice: string | undefined,
  prompt: string,
  references: string[],
): Promise<{ prompt: string; references: string[] }> {
  if (!workspaceId || !choice || choice === "none") return { prompt, references };
  try {
    const [{ loadResolvedStyle }, { visualStyleBlock }] = await Promise.all([
      import("@/server/brand-kit/resolve.server"),
      import("@/lib/brand-kit/prompt"),
    ]);
    const loaded = await loadResolvedStyle(workspaceId, choice === "default" ? null : choice);
    if (!loaded.resolved.styleId) return { prompt, references };
    const block = visualStyleBlock(loaded.resolved);
    const refs = references.length ? references : loaded.referenceUrls.slice(0, 4);
    const refNote =
      !references.length && refs.length
        ? `\n\nREFERENCE IMAGES (${refs.length} attached): examples of the brand's style. Match their look closely (palette, lighting, composition, type treatment, graphic elements). Create a NEW image; never copy their subject or text.`
        : "";
    const full = block
      ? `${prompt}\n\nBRAND STYLE (follow it where it differs from the above):\n${block.split("\n").slice(1).join("\n")}${refNote}`
      : `${prompt}${refNote}`;
    return { prompt: full.slice(0, 7000), references: refs };
  } catch (error) {
    console.error("[generate-image] style load failed, generating without it", error);
    return { prompt, references };
  }
}

// Image generation via OpenRouter (GPT Image 2.5). Answers as SSE events
// (image_generation.partial_image / .completed) so the client can render
// progressive previews.
export const POST = defineRoute({
  name: "generate-image",
  auth: "user",
  body: BodySchema,
  // Billed per image.
  rateLimit: "image",
  handler: async ({ body, attributedWorkspaceId }) => {
    const given = Array.isArray(body.referenceAssets)
      ? body.referenceAssets
          .filter(
            (value): value is string => typeof value === "string" && /^https:\/\//i.test(value),
          )
          .slice(0, 4)
      : [];
    const withStyle = await styled(attributedWorkspaceId, body.brandStyle, body.prompt, given);
    const routing = {
      hasReference: body.hasReference === true || withStyle.references.length > 0,
      referenceAssets: withStyle.references,
      editing: body.editing === true,
      requiredQuality:
        body.requiredQuality === "high" || body.requiredQuality === "maximum"
          ? body.requiredQuality
          : "standard",
      iteration:
        body.iteration === "refinement" || body.iteration === "variation"
          ? body.iteration
          : "first",
      latency: body.latency === "fast" ? "fast" : "normal",
    } as const;
    const metadata =
      body.metadata && typeof body.metadata === "object"
        ? (body.metadata as Record<string, unknown>)
        : undefined;
    const maxAttempts = typeof body.maxAttempts === "number" ? body.maxAttempts : undefined;

    const { imageGenerationStream } = await import("@/lib/openrouter-image.server");
    return imageGenerationStream({
      prompt: withStyle.prompt,
      size: body.size,
      routing,
      metadata,
      maxAttempts,
    });
  },
});
