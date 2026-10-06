import "server-only";
import { createServerFn } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rateLimitFor } from "@/server/rate-limit";
import type { ServerFnContext } from "@/server/server-fn";
import type { ChatActionView } from "@/lib/chat/events";

// The buttons a chat reply offers (ADR-0033, src/server/chat/actions.server.ts).
// A click runs the stored request as the person who clicked: this checks they
// are a member, the action checks their role, and the function behind it checks
// plan, credits and approval exactly as it does in the app.

const uuid = z.string().uuid();
const ws = { workspaceId: uuid };

async function caller(context: ServerFnContext, workspaceId: string) {
  const { isChatToolsEnabled } = await import("@/lib/feature-flags");
  if (!isChatToolsEnabled(workspaceId)) {
    const { HttpError } = await import("@/server/http-error");
    throw new HttpError(404, "Not found");
  }
  const { requireWorkspaceRole } = await import("@/server/workspace-access.server");
  const role = await requireWorkspaceRole(context, workspaceId, "viewer");
  const { tryGetRequest } = await import("@/server/request-context");
  const token = (tryGetRequest()?.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  return { workspaceId, userId: context.userId, role, supabase: context.supabase, token };
}

/** Where the buttons under a stored reply stand now (after a reload). */
export const getChatActions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ ...ws, ids: z.array(uuid).max(50) }).parse(data))
  .handler(async ({ data, context }): Promise<ChatActionView[]> => {
    const c = await caller(context, data.workspaceId);
    const { readChatActions } = await import("@/server/chat/actions.server");
    return readChatActions(c.workspaceId, data.ids);
  });

/** A person clicked a button chat offered. Runs once, as them. */
export const runChatAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("chat-action")])
  .inputValidator((data) => z.object({ ...ws, actionId: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<ChatActionView> => {
    const c = await caller(context, data.workspaceId);
    const { runChatAction: run } = await import("@/server/chat/actions.server");
    return run(c, data.actionId);
  });
