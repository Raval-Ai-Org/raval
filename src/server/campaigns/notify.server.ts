// Tell the person who started a campaign that its posts are waiting for them
// (ADR-0039). A campaign's pieces are made and wait for approval whether or
// not Autopilot is on, so this does not depend on an Autopilot program.
// At most once a day per campaign; sent only when something really waits.
// Called from the existing run-schedules sweep (runDueAutopilot); no cron job.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isCampaignsEnabled } from "@/lib/feature-flags";
import { campaignsPath } from "@/lib/workspace/paths";
import { appUrl, emailConfigured, sendEmail } from "@/server/notify/email.server";

const NOTICE_EVERY_MS = 20 * 60 * 60_000;

type Waiting = { campaign_id: string; workspace_id: string; status: string; title: string };
type CampaignRow = {
  id: string;
  name: string;
  status: string;
  acting_user_id: string | null;
  created_by: string | null;
  last_notified_at: string | null;
};

export async function notifyCampaignWaiting(limit = 20): Promise<number> {
  if (!emailConfigured()) return 0;
  const admin = supabaseAdmin as unknown as SupabaseClient;
  const { data: waiting, error } = await admin
    .from("autopilot_actions")
    .select("campaign_id, workspace_id, status, title")
    .eq("status", "needs_approval")
    .not("campaign_id", "is", null)
    .limit(500);
  if (error) throw new Error(error.message);
  const { data: failedRows } = await admin
    .from("autopilot_actions")
    .select("campaign_id, workspace_id, status, title")
    .eq("status", "failed")
    .eq("kind", "content")
    .not("campaign_id", "is", null)
    .gte("updated_at", new Date(Date.now() - NOTICE_EVERY_MS).toISOString())
    .limit(200);

  const byCampaign = new Map<string, { workspaceId: string; titles: string[]; failed: string[] }>();
  for (const row of [...(waiting ?? []), ...(failedRows ?? [])] as Waiting[]) {
    const entry = byCampaign.get(row.campaign_id) ?? {
      workspaceId: row.workspace_id,
      titles: [],
      failed: [],
    };
    (row.status === "failed" ? entry.failed : entry.titles).push(row.title);
    byCampaign.set(row.campaign_id, entry);
  }

  let sent = 0;
  for (const [campaignId, entry] of byCampaign) {
    if (sent >= limit) break;
    // Failed pieces ride along; they never send an email on their own.
    if (!entry.titles.length) continue;
    if (!isCampaignsEnabled(entry.workspaceId)) continue;
    const { data: row } = await admin
      .from("workspace_campaigns")
      .select("id, name, status, acting_user_id, created_by, last_notified_at")
      .eq("workspace_id", entry.workspaceId)
      .eq("id", campaignId)
      .maybeSingle();
    const campaign = row as CampaignRow | null;
    if (!campaign || campaign.status !== "running") continue;
    const userId = campaign.acting_user_id ?? campaign.created_by;
    if (!userId) continue;
    if (
      campaign.last_notified_at &&
      Date.now() - Date.parse(campaign.last_notified_at) < NOTICE_EVERY_MS
    ) {
      continue;
    }
    // Claim the notice first, so two overlapping sweeps send one email.
    let claim = admin
      .from("workspace_campaigns")
      .update({ last_notified_at: new Date().toISOString() })
      .eq("id", campaignId);
    claim = campaign.last_notified_at
      ? claim.eq("last_notified_at", campaign.last_notified_at)
      : claim.is("last_notified_at", null);
    const { data: claimed } = await claim.select("id");
    if (!claimed?.length) continue;

    const { data: user } = await supabaseAdmin.auth.admin.getUserById(userId);
    const email = user?.user?.email;
    if (!email) continue;
    const n = entry.titles.length;
    const f = entry.failed.length;
    const list = (titles: string[]) =>
      titles
        .slice(0, 6)
        .map((t) => `• ${t}`)
        .join("\n");
    const ok = await sendEmail({
      to: email,
      subject: `${n} ${n === 1 ? "post is" : "posts are"} waiting for your OK · ${campaign.name}`,
      text: [
        `Your "${campaign.name}" campaign has ${n === 1 ? "a post" : `${n} posts`} ready:`,
        list(entry.titles),
        "Nothing goes out until you approve it.",
        f ? `${f === 1 ? "This" : "These"} didn't go out:` : "",
        f ? list(entry.failed) : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      action: ["Review and approve", appUrl(campaignsPath(entry.workspaceId, { c: campaignId }))],
    });
    if (ok) sent++;
  }
  return sent;
}
