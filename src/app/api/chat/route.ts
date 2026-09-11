import { z } from "zod";
import { defineRoute } from "@/server/route";
import { chatCompletionStream } from "@/lib/ai-gateway.server";
import { chatSystem, chatContextBlock } from "@/lib/ai/prompts";
import { compactHistory } from "@/lib/ai/history-compact";

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
});

export const POST = defineRoute({
  name: "chat",
  auth: "user",
  body: MessagesSchema,
  rateLimit: "chat",
  handler: ({ body }) => {
    const safeMessages = compactHistory(body.messages.filter((m) => m.role !== "system") as never);
    return chatCompletionStream({
      stream: true,
      messages: [
        { role: "system", content: chatSystem() },
        { role: "system", content: chatContextBlock(body.context ?? "") },
        ...safeMessages,
      ],
    });
  },
});
