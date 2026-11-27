// deletion.server.ts — what Mellox deletes when a person removes the app in
// Facebook (deauthorize) or asks Meta to have their data deleted, and the
// retention promised in the privacy policy (src/marketing/lib/privacy.ts).
//
// Meta identifies the person by the app-scoped user id Mellox stored as the
// connection's `external_account_id` when they connected. Every workspace
// they connected loses: its Pages (and with them every comment, DM, reply and
// Page token: ON DELETE CASCADE), the sign-in token, the reply examples and
// the comment quoted on open questions. The connection row stays, revoked,
// as the record that it existed. The team's own answers and rules stay: they
// are the brand's words, not Meta data.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { recordAudit } from "@/server/audit.server";
import { META_MESSAGE_RETENTION_DAYS } from "@/marketing/lib/privacy";

const db = supabaseAdmin as unknown as SupabaseClient;

export type MetaForgetReason = "deauthorized" | "data_deletion";

/** Removes everything Mellox holds from this Meta user's connections. Returns the workspaces touched. */
export async function forgetMetaUser(
  metaUserId: string,
  reason: MetaForgetReason,
): Promise<number> {
  if (!/^[0-9]{1,40}$/.test(metaUserId)) return 0;
  const { data } = await db
    .from("workspace_connections")
    .select("id,workspace_id,status")
    .eq("provider", "meta")
    .eq("external_account_id", metaUserId);
  const conns = (data ?? []) as { id: string; workspace_id: string; status: string }[];
  for (const conn of conns) {
    await forgetConnection(conn.workspace_id, conn.id, reason, conn.status === "revoked");
  }
  return conns.length;
}

async function forgetConnection(
  workspaceId: string,
  connectionId: string,
  reason: MetaForgetReason,
  alreadyRevoked: boolean,
) {
  // Pages cascade to their tokens, comments, DMs and replies.
  await db.from("meta_pages").delete().eq("connection_id", connectionId);
  await db.from("meta_oauth_credentials").delete().eq("connection_id", connectionId);
  // Only one Meta connection per workspace, so its examples and quoted
  // comments came from this account.
  await db.from("engage_examples").delete().eq("workspace_id", workspaceId);
  await db
    .from("engage_questions")
    .update({ example_comment: null })
    .eq("workspace_id", workspaceId)
    .not("example_comment", "is", null);
  if (!alreadyRevoked)
    await db
      .from("workspace_connections")
      .update({
        status: "revoked",
        revoked_at: new Date().toISOString(),
        revoked_reason: reason === "deauthorized" ? "removed_in_meta" : "data_deletion_request",
      })
      .eq("id", connectionId)
      .eq("workspace_id", workspaceId);
  await recordAudit({
    workspaceId,
    userId: null,
    action: `engage.meta.${reason}`,
    entity: `workspace_connections:${connectionId}`,
  });
}

const DAY_MS = 86_400_000;

/**
 * Comments and messages older than the promised retention are deleted, with
 * the reply examples and quoted comments of the same age. Cheap: indexed by
 * time, and the caller runs it about once an hour.
 */
export async function purgeOldEngageData(now = Date.now()): Promise<void> {
  const cutoff = new Date(now - META_MESSAGE_RETENTION_DAYS * DAY_MS).toISOString();
  await db.from("engage_comments").delete().lt("commented_at", cutoff);
  await db.from("engage_examples").delete().lt("created_at", cutoff);
  await db
    .from("engage_questions")
    .update({ example_comment: null })
    .lt("created_at", cutoff)
    .not("example_comment", "is", null);
}
