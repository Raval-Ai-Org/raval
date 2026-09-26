import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { extractImageText } from "@/server/ai/vision-extract.server";
import { paidTargetForUserRoute } from "@/server/billing/accounts.server";
import { runMetered } from "@/server/billing/metered.server";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const Body = z.object({
  filename: z.string().max(200),
  mime: z.string().max(120),
  dataUrl: z.string().min(20).max(28_000_000),
});

export const POST = defineRoute({
  name: "file-extract",
  auth: "user",
  body: Body,
  // Vision extraction — billed per call (economy model first, cached per image).
  rateLimit: "generate",
  handler: async ({ body, request, userId, supabase, attributedWorkspaceId }) => {
    // Inline image data only: an http(s) URL here would make the model provider
    // fetch an arbitrary address on our behalf.
    const isInlineImage =
      body.mime.startsWith("image/") &&
      /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(body.dataUrl);
    if (!isInlineImage) return jsonError(400, "Only inline images (data:image/…) are supported");

    const target = await paidTargetForUserRoute({
      attributedWorkspaceId,
      userId,
      supabase: supabase as unknown as SupabaseClient,
    });
    const metered = await runMetered(
      {
        ...target,
        userId,
        action: "file_extract",
        idempotencyKey: request.headers.get("Idempotency-Key") ?? crypto.randomUUID(),
        route: "file-extract",
      },
      async () => extractImageText(body.dataUrl),
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
