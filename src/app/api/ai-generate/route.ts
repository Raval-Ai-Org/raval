import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { fetchPublicText } from "@/server/safe-fetch";
import { chatCompletion } from "@/lib/ai";
import { stripHtml } from "@/lib/crawl/html";
import { TASK_SYSTEMS } from "@/lib/ai/prompts";
import { assemble } from "@/lib/ai/prompts/assemble";

export const dynamic = "force-dynamic";

const TaskEnum = z.enum([
  "seo-audit",
  "content-gen",
  "ad-copy",
  "social-post",
  "crm-message",
  "competitor",
  "analytics-insight",
  "freeform",
]);

const BodySchema = z.object({
  task: TaskEnum,
  prompt: z.string().max(4000).optional(),
  url: z.string().url().max(2000).optional(),
  context: z.string().max(4000).optional(),
});

export const POST = defineRoute({
  name: "ai-generate",
  auth: "user",
  body: BodySchema,
  // `seo-audit` crawls a page and runs a long completion, so it bills like an analysis.
  rateLimit: ({ body }) => ({ tier: body.task === "seo-audit" ? "audit" : "generate" }),
  handler: async ({ body }) => {
    const system = TASK_SYSTEMS[body.task] ?? TASK_SYSTEMS.freeform;

    // Optional page scrape. safeFetch rejects private targets and re-checks
    // every redirect; a failed scrape just means no page context.
    const scraped = body.url
      ? stripHtml(
          await fetchPublicText(body.url, {
            headers: { "User-Agent": "Mozilla/5.0 MelloxAI-Bot" },
            timeoutMs: 8000,
            maxBytes: 2 * 1024 * 1024,
          }),
          4000,
        )
      : "";

    const user =
      assemble([
        { label: "Request", body: body.prompt },
        { label: "Context", body: body.context, maxChars: 3800 },
        { label: "Target URL", body: body.url },
        { label: "Page content", body: scraped, maxChars: 4000 },
      ]) || "Generate a useful default response.";

    const json: any = await chatCompletion({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 900,
      temperature: 0.72,
    });
    const text = String(json?.choices?.[0]?.message?.content ?? "").trim();
    if (!text) return jsonError(502, "AI returned an empty draft");
    return { text };
  },
});
