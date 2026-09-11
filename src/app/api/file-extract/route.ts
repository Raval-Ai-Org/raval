import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { extractionCompletion } from "@/lib/ai";
import { FILE_EXTRACT_SYSTEM } from "@/lib/ai/prompts";

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
  // Vision extraction on Gemini 2.5 Pro — billed per call.
  rateLimit: "generate",
  handler: async ({ body }) => {
    // Inline image data only: an http(s) URL here would make the model provider
    // fetch an arbitrary address on our behalf.
    const isInlineImage =
      body.mime.startsWith("image/") && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(body.dataUrl);
    if (!isInlineImage) return jsonError(400, "Only inline images (data:image/…) are supported");

    const j: any = await extractionCompletion({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: FILE_EXTRACT_SYSTEM },
            { type: "image_url", image_url: { url: body.dataUrl } },
          ],
        },
      ],
    });
    const text: string = j?.choices?.[0]?.message?.content ?? "";
    return { text };
  },
});
