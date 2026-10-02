// Scheduling approved content through the workspace's distribution provider.
// The one path shared by POST /api/sdr/schedule (a person) and Autopilot (the
// worker, acting as a stored member): the fair-use check first, then the
// provider. The provider fires at the scheduled time; webhooks and the
// reconcile sweep confirm delivery.
import "server-only";
import { getWorkspaceSdrConfig } from "@/lib/sdr.helpers.server";
import {
  scheduleContentItemsHandler,
  handleSdrDisabled,
  type PublishSelection,
  type ScheduleItem,
} from "@/lib/sdr.handlers";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getDistributionProviderForWorkspace } from "@/lib/feature-flags";
import { scheduleHandler } from "@/lib/socialapi/handlers";
import { withSocialApi } from "@/lib/socialapi/route.server";
import { scheduleHandler as schedulePostForMe } from "@/lib/postforme/handlers";
import { withPostForMe } from "@/lib/postforme/route.server";
import { assertPublishingAction } from "@/server/billing/social-profiles.server";
import { jsonError, type WorkspaceRole } from "@/server/api-auth";

/** The caller must have verified workspace membership and the role. */
export async function scheduleForWorkspace(args: {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  items: ScheduleItem[];
  selection: PublishSelection;
  tiktokPrivacyLevel?: string | null;
}): Promise<Response> {
  const { workspaceId, userId, role, items, selection } = args;
  const tiktokPrivacyLevel = args.tiktokPrivacyLevel ?? null;
  await assertPublishingAction({ workspaceId, userId, role, action: "social_schedule" });

  const provider = getDistributionProviderForWorkspace(workspaceId);
  // Distribution off → refuse honestly; nothing is marked scheduled.
  if (!provider) {
    const out = await handleSdrDisabled({
      workspaceId,
      contentItemIds: items.map((i) => i.contentItemId),
      kind: "schedule",
    });
    return Response.json(out.body, { status: out.status });
  }

  if (provider === "postforme") {
    return withPostForMe(workspaceId, (deps) =>
      schedulePostForMe({ workspaceId, userId, items, selection, tiktokPrivacyLevel }, deps),
    );
  }

  if (provider === "socialapi") {
    return withSocialApi(workspaceId, (deps) =>
      scheduleHandler({ workspaceId, userId, items, selection, tiktokPrivacyLevel }, deps),
    );
  }

  try {
    const { token, baseUrl } = await getWorkspaceSdrConfig(workspaceId);
    const out = await scheduleContentItemsHandler(
      { workspaceId, items, selection },
      { sdrBaseUrl: baseUrl, token, db: supabaseAdmin },
    );
    return Response.json(out.body, { status: out.status });
  } catch (e) {
    return jsonError(503, e instanceof Error ? e.message : "SDR schedule failed");
  }
}
