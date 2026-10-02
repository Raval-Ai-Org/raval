// POST /api/sdr/schedule — schedule approved content for on-time publishing
// through the active distribution provider. Validates the absolute UTC instant
// and ≤1 year window server-side; the provider fires at the scheduled time and
// webhooks / the reconcile sweep confirm delivery.
import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import type { PublishSelection, ScheduleItem } from "@/lib/sdr.handlers";
import { readDistributionOptions } from "@/app/api/sdr/publish/route";
import { scheduleForWorkspace } from "@/server/social/schedule.server";

export const dynamic = "force-dynamic";

const SELECTION_TYPES: readonly string[] = ["account", "platform", "all"];

// Fields are validated individually below with the messages clients rely on.
const BodySchema = z.record(z.unknown());

function isScheduleItem(it: unknown): it is ScheduleItem {
  const item = it as Partial<ScheduleItem> | null;
  return !!item && typeof item.contentItemId === "string" && typeof item.scheduledAt === "string";
}

export const POST = defineRoute({
  name: "sdr/schedule",
  auth: "workspace",
  body: BodySchema,
  workspaceId: ({ body }) => body.workspaceId,
  minRole: "editor",
  handler: async ({ body, workspaceId, userId, role }) => {
    const items: ScheduleItem[] = Array.isArray(body.items)
      ? body.items.filter(isScheduleItem)
      : [];
    if (items.length === 0) {
      return jsonError(400, "items[] with contentItemId + scheduledAt required");
    }
    const selection = body.selection as PublishSelection | undefined;
    if (!selection || !SELECTION_TYPES.includes(selection.type)) {
      return jsonError(400, "Invalid destination selection");
    }
    // The fair-use check and the provider call are shared with Autopilot.
    return scheduleForWorkspace({
      workspaceId,
      userId,
      role,
      items,
      selection,
      tiktokPrivacyLevel: readDistributionOptions(body.options).tiktokPrivacyLevel,
    });
  },
});
