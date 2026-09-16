import { z } from "zod";
import { defineRoute } from "@/server/route";
import { CHAT_MODEL, CHAT_MODEL_CHOICES, chatCompletionStream } from "@/lib/ai-gateway.server";
import { chatSystem, chatContextBlock } from "@/lib/ai/prompts";
import { summarizeHistory } from "@/lib/ai/history-summary.server";
import { sanitizeModelInput, wrapUntrusted } from "@/server/guardrails/untrusted";

export const dynamic = "force-dynamic";

const MessagesSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string().min(1).max(200_000),
      }),
    )
    .min(1)
    .max(40),
  context: z.string().max(6000).optional(),
  /** Model picker choice — an id from CHAT_MODEL_CHOICES, never a raw model name. */
  modelId: z.string().max(40).optional(),
  /**
   * The workspace this conversation belongs to, captured when the request
   * starts. Membership is verified before anything runs, and the brand the
   * model is told it works for comes from the database for this id.
   */
  workspaceId: z.string().uuid(),
});

export const POST = defineRoute({
  name: "chat",
  auth: "workspace",
  workspaceId: ({ body }) => body.workspaceId,
  body: MessagesSchema,
  rateLimit: "chat",
  handler: async ({ body, supabase, workspaceId }) => {
    // Anchor the brand identity to the verified workspace, not browser state.
    const { data: ws } = await supabase
      .from("workspaces")
      .select("name, website_url")
      .eq("id", workspaceId)
      .maybeSingle();
    const identity = ws
      ? `Workspace brand: ${ws.name}${ws.website_url ? ` (${ws.website_url})` : ""}. Only use context for this brand.`
      : "";
    // Client-supplied "system" turns are dropped: only the server writes system prompts.
    const turns = body.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: sanitizeModelInput(m.content) }));
    // Older turns are summarised (decisions, facts, open questions) instead of
    // clipped to first sentences; the newest 12 stay verbatim.
    const history = await summarizeHistory(turns as never);
    return chatCompletionStream({
      stream: true,
      model: (body.modelId && CHAT_MODEL_CHOICES[body.modelId]) || CHAT_MODEL,
      task: "chat",
      messages: [
        { role: "system", content: chatSystem() },
        // Brand DNA / workspace context is user-provided and partly scraped:
        // chatContextBlock fences it as untrusted data, not instructions.
        {
          role: "system",
          content: chatContextBlock(
            wrapUntrusted("brand-dna", [identity, body.context].filter(Boolean).join("\n\n"), {
              route: "chat",
            }),
          ),
        },
        ...history,
      ],
    });
  },
});
