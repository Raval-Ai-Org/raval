import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { fetchPublicText } from "@/server/safe-fetch";
import { UNTRUSTED_DATA_RULE, wrapUntrusted } from "@/server/guardrails/untrusted";
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
  /**
   * Output size. "long" is for multi-item batches (a content calendar): the old
   * fixed 900-token cap cut those off mid-array and the client failed to parse.
   */
  size: z.enum(["short", "standard", "long"]).optional(),
  /** The user asked for a different take — bypass the cached answer. */
  regenerate: z.boolean().optional(),
});

const OUTPUT_TOKENS = { short: 600, standard: 1_200, long: 6_000 } as const;

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
        {
          label: "Page content",
          body: scraped
            ? `${UNTRUSTED_DATA_RULE}\n${wrapUntrusted("page-scrape", scraped, { maxChars: 4000, route: "ai-generate" })}`
            : "",
        },
      ]) || "Generate a useful default response.";

    const json: any = await chatCompletion({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: OUTPUT_TOKENS[body.size ?? "standard"],
      task: "generate",
      temperature: 0.72,
      regenerate: body.regenerate,
      route: `ai-generate.${body.task}`,
    });
    const text = String(json?.choices?.[0]?.message?.content ?? "").trim();
    if (!text) return jsonError(502, "AI returned an empty draft");
    // `truncated` tells the client the draft was cut off at the output ceiling
    // (also metered + logged server-side) instead of failing to parse silently.
    return { text, truncated: json?._truncated === true };
  },
});
