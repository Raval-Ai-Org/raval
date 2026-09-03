import { z } from "zod";
import { jsonError, requireUserId } from "@/server/api-auth";
import { AiGatewayError, runTool } from "@/lib/ai";
import { clarifyPrompt } from "@/lib/ai/prompts";

export const dynamic = "force-dynamic";

const Schema = z.object({
  prompt: z.string().min(1).max(4000),
  brandContext: z.string().max(2000).optional(),
});

const CLARIFY_PARAMS = {
  type: "object",
  properties: {
    needs_clarification: { type: "boolean" },
    rationale: { type: "string" },
    questions: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          type: { type: "string", enum: ["single", "multi"] },
          options: {
            type: "array",
            minItems: 2,
            maxItems: 5,
            items: {
              type: "object",
              properties: {
                value: { type: "string" },
                label: { type: "string" },
                hint: { type: "string" },
              },
              required: ["value", "label"],
            },
          },
          allowOther: { type: "boolean" },
        },
        required: ["id", "label", "type", "options"],
      },
    },
  },
  required: ["needs_clarification", "questions"],
} as const;

type Result = { needs_clarification: boolean; rationale?: string; questions?: unknown[] };

export async function POST(request: Request) {
  const auth = await requireUserId(request);
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(await request.json());
  } catch {
    return jsonError(400, "Invalid request body");
  }

  // TS heuristic — skip the LLM for prompts already concrete.
  const p = body.prompt.trim();
  const wc = p.split(/\s+/).length;
  const concreteHint =
    /\b(instagram|linkedin|x|twitter|tiktok|youtube|facebook|blog|email|newsletter|reel|carousel|thread|caption|hook|cta|seo|meta|title tag|h1|schema|audit|competitor|keyword|calendar|schedule|generate|write|draft|rewrite|translate|summar|analy[sz]e|explain|list|outline)\b/i.test(
      p,
    );
  const looksActionable =
    /^(write|draft|generate|create|make|build|plan|schedule|post|publish|analyze|analyse|audit|research|find|list|explain|summarize|summarise|rewrite|translate|outline|compare|score|check|fix)\b/i.test(
      p,
    );
  if (wc < 4 || (concreteHint && looksActionable) || p.length > 400) {
    return Response.json({ needs_clarification: false, questions: [] });
  }

  const { system, user } = clarifyPrompt(body.prompt, body.brandContext);
  try {
    const parsed = await runTool<Result>({
      route: "clarify",
      name: "ask_clarifying_questions",
      description:
        "Ask 1-3 short multiple-choice questions to disambiguate the prompt. Skip if already concrete.",
      parameters: CLARIFY_PARAMS as unknown as Record<string, unknown>,
      system,
      user,
      maxTokens: 400,
    });
    return Response.json(parsed ?? { needs_clarification: false, questions: [] });
  } catch (e) {
    if (e instanceof AiGatewayError) return jsonError(e.status, e.message);
    throw e;
  }
}
