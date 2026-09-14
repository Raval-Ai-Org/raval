// audit.server.ts — append-only audit trail (public.audit_logs) for actions
// with side effects outside Mellox: connector changes, repository writes,
// pull requests, verification outcomes. Service role only; members read their
// workspace's rows through RLS.
//
// Payloads carry identifiers and outcomes, never tokens, keys or file
// contents. A failed insert is logged, not thrown: the action already happened
// and must not be reported as failed because its audit row wasn't written.
import "server-only";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";

export type AuditEntry = {
  workspaceId: string;
  userId: string | null;
  action: string;
  entity: string;
  payload?: Record<string, unknown>;
};

const SECRET_KEY = /token|secret|private.?key|password|authorization/i;

/** Drop anything that looks like a credential before it is persisted. */
export function scrubAuditPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (SECRET_KEY.test(key)) continue;
    out[key] =
      value && typeof value === "object" && !Array.isArray(value)
        ? scrubAuditPayload(value as Record<string, unknown>)
        : value;
  }
  return out;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  const { error } = await supabaseAdmin.from("audit_logs").insert({
    workspace_id: entry.workspaceId,
    user_id: entry.userId,
    action: entry.action,
    entity: entry.entity,
    payload: scrubAuditPayload(entry.payload ?? {}) as Json,
  });
  if (error) console.error("[audit] not recorded", entry.action, error.message);
}
