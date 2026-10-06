import "server-only";
import { after } from "next/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isSlackEnabled } from "@/lib/feature-flags";
import { slackApi, slackToken } from "./client.server";

/**
 * Answer now instead of waiting for the next cron tick. The cron hook stays the
 * safety net: rows are leased, so both may run without doing the work twice.
 */
export function kickSlackQueue() {
  try {
    after(async () => {
      const { runSlackQueue } = await import("./worker.server");
      await runSlackQueue().catch(() => null);
    });
  } catch {
    /* Outside a request: the cron hook picks the row up. */
  }
}

/** A direct message Mellox can't place in a brand gets a hint, never silence. */
export function hintUnlinkedSlackUser(teamId: string, channelId: unknown) {
  if (
    !/^T[A-Z0-9]+$/.test(teamId) ||
    typeof channelId !== "string" ||
    !/^D[A-Z0-9]+$/.test(channelId)
  )
    return;
  try {
    after(async () => {
      const { data } = await supabaseAdmin
        .from("slack_installations" as never)
        .select("id,workspace_id")
        .eq("team_id", teamId)
        .eq("status", "active");
      const install = ((data ?? []) as Array<{ id: string; workspace_id: string }>).find((row) =>
        isSlackEnabled(row.workspace_id),
      );
      if (!install) return;
      await slackApi(await slackToken(install.id, install.workspace_id), "chat.postMessage", {
        channel: channelId,
        text: "I don't know which Mellox brand you work on yet. In Mellox, open Settings → Slack → Get link code, then send me that line here. If you work on more than one brand, mention @Mellox in that brand's channel instead.",
      }).catch(() => null);
    });
  } catch {
    /* Outside a request. */
  }
}

/** Slack only shows feedback for buttons and shortcuts through the response URL. */
export async function slackEphemeral(responseUrl: unknown, text: string) {
  if (typeof responseUrl !== "string" || !responseUrl.startsWith("https://hooks.slack.com/"))
    return;
  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ response_type: "ephemeral", replace_original: false, text }),
    signal: AbortSignal.timeout(2500),
    cache: "no-store",
  }).catch(() => null);
}
