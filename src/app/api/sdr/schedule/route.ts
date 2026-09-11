// POST /api/sdr/schedule — schedule approved content for on-time publishing
// (FR-008/FR-025). Validates the absolute UTC instant + ≤1yr window server-side;
// the SDR beat fires at the scheduled time and webhooks confirm (US4).
import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { getWorkspaceSdrKey } from "@/lib/sdr.helpers.server";
import {
  scheduleContentItemsHandler,
  handleSdrDisabled,
  type PublishSelection,
  type ScheduleItem,
} from "@/lib/sdr.handlers";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isSdrEnabled } from "@/lib/feature-flags";

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
  handler: async ({ body, workspaceId }) => {
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

    // US5 (FR-017): flag off → degrade to today's mock (status flip) server-side.
    if (!isSdrEnabled()) {
      const out = await handleSdrDisabled(
        {
          workspaceId,
          contentItemIds: items.map((i) => i.contentItemId),
          kind: "schedule",
          scheduledAt: items[0]?.scheduledAt,
        },
        { db: supabaseAdmin },
      );
      return Response.json(out.body, { status: out.status });
    }

    try {
      const token = await getWorkspaceSdrKey(workspaceId);
      const out = await scheduleContentItemsHandler(
        { workspaceId, items, selection },
        { sdrBaseUrl: process.env.SDR_BASE_URL ?? "", token, db: supabaseAdmin },
      );
      return Response.json(out.body, { status: out.status });
    } catch (e) {
      return jsonError(503, e instanceof Error ? e.message : "SDR schedule failed");
    }
  },
});
