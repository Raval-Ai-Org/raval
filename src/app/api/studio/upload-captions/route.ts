import { z } from "zod";
import { defineRoute } from "@/server/route";
import { runStructuredPrompt } from "@/lib/ai";
import { runMetered } from "@/server/billing/metered.server";
import { PlatformIdSchema } from "@/lib/studio/jobs";
import { wrapUntrusted } from "@/server/guardrails/untrusted";
import { loadStudioContext } from "@/server/studio/context.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  workspaceId: z.string().uuid(),
  mediaKind: z.enum(["photo", "video", "text"]),
  title: z.string().max(280),
  description: z.string().max(2000),
  direction: z.string().max(1000),
  platforms: z.array(PlatformIdSchema).min(1).max(7),
  existing: z.record(z.string(), z.string().max(4000)).optional(),
});

const Result = z.object({
  captions: z.array(z.object({ platform: PlatformIdSchema, text: z.string().min(1).max(4000) })),
});

export const POST = defineRoute({
  name: "studio/upload-captions",
  auth: "workspace",
  minRole: "editor",
  body: Body,
  workspaceId: ({ body }) => body.workspaceId,
  rateLimit: "generate",
  handler: async ({ body, workspaceId, userId, role, request, supabase }) => {
    const metered = await runMetered(
      {
        workspaceId,
        userId,
        role,
        action: "ideas",
        idempotencyKey: request.headers.get("Idempotency-Key") ?? crypto.randomUUID(),
        route: "studio.upload-captions",
      },
      async () => {
        const context = await loadStudioContext(supabase, workspaceId, null);
        return runStructuredPrompt({
          route: "studio.upload-captions",
          system:
            "Write ready-to-edit social captions for media the user already made. Return exactly one caption for each requested platform. Preserve their facts, wording preferences and any supplied copy. Do not invent product claims, prices or details of a visual you cannot see. Adapt length and style to each platform. Include a natural call to action only when appropriate. Return JSON matching the schema.",
          user: [
            `Media: ${body.mediaKind}. Platforms: ${body.platforms.join(", ")}.`,
            wrapUntrusted("brand", context.brandText || context.brandName, {
              route: "studio.upload-captions",
              maxChars: 1800,
            }),
            wrapUntrusted("upload-title", body.title, { route: "studio.upload-captions" }),
            wrapUntrusted("upload-description", body.description, {
              route: "studio.upload-captions",
            }),
            wrapUntrusted("upload-direction", body.direction, { route: "studio.upload-captions" }),
            wrapUntrusted("existing-captions", JSON.stringify(body.existing ?? {}), {
              route: "studio.upload-captions",
            }),
          ].join("\n\n"),
          schema: Result,
          maxTokens: 1800,
          temperature: 0.7,
          noCache: true,
        });
      },
    );
    const requested = new Set(body.platforms);
    return Response.json({
      captions: metered.result.captions.filter((caption) => requested.has(caption.platform)),
    });
  },
});
