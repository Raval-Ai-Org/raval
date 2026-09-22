// Checking one placement on demand, from the "Check again" button.
//
// Shares the loss rules with the background sweep: `unreachable` and `blocked`
// never count against a link, and nothing here can promote a placement to
// `live` without Mellox's own fetch having found the link on the page. The
// database constraint refuses it too, so a bug cannot lie.
import "server-only";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HttpError } from "@/server/http-error";
import { verifyUrl } from "@/server/backlinks/verify.server";
import { patchLine, recordEvent } from "./store.server";

export type RecheckResult = {
  result: string;
  status: string;
  /** Plain sentence for the user. Never converts uncertainty into certainty. */
  message: string;
};

const MESSAGES: Record<string, string> = {
  live: "The link is on the page and passes credit.",
  nofollow: "The link is on the page, but it's marked so it passes no credit.",
  missing: "We opened the page and couldn't find the link.",
  unreachable: "We couldn't open that page just now, so we can't say either way.",
  blocked: "That address can't be checked from here.",
  pending: "We haven't been able to check this yet.",
};

export async function recheckOne(args: {
  workspaceId: string;
  lineId: string;
}): Promise<RecheckResult> {
  const { data: row } = await supabaseAdmin
    .from("link_order_lines")
    .select(
      "id, workspace_id, order_id, published_url, status, first_live_at, consecutive_missing, opportunity_id, link_orders!inner(target_url)",
    )
    .eq("id", args.lineId)
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();

  if (!row) throw new HttpError(404, "That placement no longer exists.");
  if (!row.published_url) {
    throw new HttpError(
      409,
      "This placement hasn't been published yet, so there's nothing to check.",
    );
  }

  const parent = row.link_orders as unknown as { target_url: string };
  const outcome = await verifyUrl({
    urlFrom: row.published_url,
    expectedTarget: parent.target_url,
  });

  if (row.opportunity_id) {
    await supabaseAdmin.from("backlink_verifications").insert({
      workspace_id: args.workspaceId,
      opportunity_id: row.opportunity_id,
      checked_url: row.published_url,
      expected_target: parent.target_url,
      result: outcome.result,
      http_status: outcome.httpStatus,
      link_found: outcome.linkFound,
      is_nofollow: outcome.isNofollow,
      anchor_found: outcome.anchorFound,
      error: outcome.error,
    });
  }

  const isLive = outcome.result === "live" || outcome.result === "nofollow";
  const isMissing = outcome.result === "missing";
  const missStreak = isMissing ? Number(row.consecutive_missing ?? 0) + 1 : 0;

  // A manual check can confirm a link, but it cannot declare one lost on its
  // own: that still takes two consecutive misses a day apart.
  const wasLiveLongEnough =
    row.first_live_at !== null && Date.now() - new Date(row.first_live_at).getTime() > 86_400_000;
  const nowLost = isMissing && missStreak >= 2 && wasLiveLongEnough;

  const status = isLive ? "live" : nowLost ? "lost" : String(row.status);

  await patchLine(row.id, {
    verification: outcome.result,
    verified_at: new Date().toISOString(),
    consecutive_missing: missStreak,
    status,
    ...(isLive && !row.first_live_at ? { first_live_at: new Date().toISOString() } : {}),
    ...(isLive ? { lost_at: null } : {}),
    ...(nowLost ? { lost_at: new Date().toISOString() } : {}),
  });

  await recordEvent({
    workspaceId: args.workspaceId,
    orderId: row.order_id,
    lineId: row.id,
    type: "verification",
    detail: { result: outcome.result, checkedUrl: row.published_url },
  });

  return {
    result: outcome.result,
    status,
    message: MESSAGES[outcome.result] ?? MESSAGES.pending,
  };
}
