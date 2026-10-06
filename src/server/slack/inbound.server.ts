import "server-only";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sha256 } from "./security.server";
import { isSlackEnabled } from "@/lib/feature-flags";
import { recordAudit } from "@/server/audit.server";

const table = (name: string) => supabaseAdmin.from(name as never);
type Installation = { id: string; workspace_id: string; team_id: string; status: string };
export type InboundTarget = { installation: Installation; workspaceId: string };

/** Shortcut targets are explicit current memberships, never inferred from team membership. */
export async function listSlackUserTargets(teamId: string, slackUserId: string) {
  if (!/^T[A-Z0-9]+$/.test(teamId) || !/^U[A-Z0-9]+$/.test(slackUserId)) return [];
  const { data: installs } = await table("slack_installations")
    .select("id,workspace_id,team_id,status")
    .eq("team_id", teamId)
    .eq("status", "active");
  const active = (installs ?? []) as Installation[];
  if (!active.length) return [];
  const { data: links } = await table("slack_user_links")
    .select("installation_id,workspace_id,mellox_user_id")
    .eq("slack_user_id", slackUserId)
    .in(
      "installation_id",
      active.map((i) => i.id),
    );
  const result: Array<InboundTarget & { name: string }> = [];
  for (const link of (links ?? []) as Array<{
    installation_id: string;
    workspace_id: string;
    mellox_user_id: string;
  }>) {
    const install = active.find((i) => i.id === link.installation_id);
    if (!install || !isSlackEnabled(install.workspace_id)) continue;
    const { data: member } = await supabaseAdmin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", install.workspace_id)
      .eq("user_id", link.mellox_user_id)
      .maybeSingle();
    if (!member) continue;
    const { data: workspace } = await supabaseAdmin
      .from("workspaces")
      .select("name")
      .eq("id", install.workspace_id)
      .maybeSingle();
    result.push({
      installation: install,
      workspaceId: install.workspace_id,
      name: workspace?.name ?? "Mellox workspace",
    });
  }
  return result;
}

/** No workspace fallback: channel mapping or a verified user link is mandatory. */
export async function resolveSlackTarget(args: {
  teamId: string;
  channelId?: string;
  slackUserId?: string;
  code?: string;
}): Promise<InboundTarget | null> {
  if (!/^T[A-Z0-9]+$/.test(args.teamId)) return null;
  const { data: installs } = await table("slack_installations")
    .select("id,workspace_id,team_id,status")
    .eq("team_id", args.teamId)
    .eq("status", "active");
  const active = (installs ?? []) as Installation[];
  if (!active.length) return null;
  if (args.code && args.slackUserId) {
    const { data: link } = await table("slack_link_codes")
      .select("id,workspace_id,installation_id,mellox_user_id,expires_at,consumed_at")
      .eq("code_hash", sha256(args.code.toUpperCase()))
      .maybeSingle();
    const row = link as null | {
      id: string;
      workspace_id: string;
      installation_id: string;
      mellox_user_id: string;
      expires_at: string;
      consumed_at: string | null;
    };
    const install = active.find((i) => i.id === row?.installation_id);
    if (!row || !install || row.consumed_at || Date.parse(row.expires_at) < Date.now()) return null;
    const { data: member } = await supabaseAdmin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", row.workspace_id)
      .eq("user_id", row.mellox_user_id)
      .maybeSingle();
    if (!member) return null;
    const { data: claimed } = await table("slack_link_codes")
      .update({ consumed_at: new Date().toISOString() } as never)
      .eq("id", row.id)
      .is("consumed_at", null)
      .select("id");
    if (!claimed?.length) return null;
    await table("slack_user_links")
      .delete()
      .eq("installation_id", row.installation_id)
      .eq("mellox_user_id", row.mellox_user_id);
    const { error } = await table("slack_user_links").upsert(
      {
        workspace_id: row.workspace_id,
        installation_id: row.installation_id,
        slack_user_id: args.slackUserId,
        mellox_user_id: row.mellox_user_id,
        linked_at: new Date().toISOString(),
      } as never,
      { onConflict: "installation_id,slack_user_id" },
    );
    if (error) return null;
    await recordAudit({
      workspaceId: row.workspace_id,
      userId: row.mellox_user_id,
      action: "slack.user_linked",
      entity: args.slackUserId,
    });
    return { installation: install, workspaceId: install.workspace_id };
  }
  if (args.channelId) {
    if (!/^C[A-Z0-9]+$/.test(args.channelId)) return null;
    const { data: maps } = await table("slack_channel_mappings")
      .select("installation_id,workspace_id")
      .eq("channel_id", args.channelId)
      .in(
        "installation_id",
        active.map((i) => i.id),
      );
    const unique = [...new Set((maps ?? []).map((m: any) => m.workspace_id))];
    if (unique.length !== 1) return null;
    const install = active.find((i) => i.id === (maps as any[])[0].installation_id);
    if (install && isSlackEnabled(install.workspace_id))
      return { installation: install, workspaceId: install.workspace_id };
    return null;
  }
  if (args.slackUserId) {
    const { data: links } = await table("slack_user_links")
      .select("installation_id,workspace_id")
      .eq("slack_user_id", args.slackUserId)
      .in(
        "installation_id",
        active.map((i) => i.id),
      );
    const unique = [...new Set((links ?? []).map((l: any) => l.workspace_id))];
    if (unique.length !== 1) return null;
    const install = active.find((i) => i.id === (links as any[])[0].installation_id);
    if (install && isSlackEnabled(install.workspace_id))
      return { installation: install, workspaceId: install.workspace_id };
  }
  return null;
}

export async function enqueueSlackInbound(
  target: InboundTarget,
  deliveryKey: string,
  kind: "event" | "action",
  payload: unknown,
) {
  const { error } = await table("slack_inbox").insert({
    workspace_id: target.workspaceId,
    installation_id: target.installation.id,
    delivery_key: deliveryKey,
    kind,
    payload,
  } as never);
  if (error && error.code !== "23505") throw new Error("Slack request could not be queued");
}

export async function resolveActionTarget(
  teamId: string,
  refId: string,
): Promise<InboundTarget | null> {
  if (!/^T[A-Z0-9]+$/.test(teamId) || !/^[0-9a-f-]{36}$/i.test(refId)) return null;
  const { data: ref } = await table("slack_action_refs")
    .select("installation_id,workspace_id,expires_at")
    .eq("id", refId)
    .maybeSingle();
  const row = ref as null | { installation_id: string; workspace_id: string; expires_at: string };
  if (!row || Date.parse(row.expires_at) < Date.now()) return null;
  const { data: install } = await table("slack_installations")
    .select("id,workspace_id,team_id,status")
    .eq("id", row.installation_id)
    .eq("team_id", teamId)
    .eq("workspace_id", row.workspace_id)
    .eq("status", "active")
    .maybeSingle();
  if (!install || !isSlackEnabled(row.workspace_id)) return null;
  return { installation: install as Installation, workspaceId: row.workspace_id };
}
