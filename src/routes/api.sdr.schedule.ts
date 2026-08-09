// POST /api/sdr/schedule — schedule approved content for on-time publishing
// (FR-008/FR-025). Validates the absolute UTC instant + ≤1yr window server-side;
// the SDR beat fires at the scheduled time and webhooks confirm (US4).
import { createFileRoute } from "@tanstack/react-router";
import { jsonError } from "@/server/api-auth";
import { requireWorkspaceAccess, getWorkspaceSdrKey } from "@/lib/sdr.helpers.server";
import { scheduleContentItemsHandler, handleSdrDisabled, type PublishSelection, type ScheduleItem } from "@/lib/sdr.handlers";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isSdrEnabled } from "@/lib/feature-flags";

export const Route = createFileRoute("/api/sdr/schedule")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: any;
        try {
          body = await request.json();
        } catch {
          return jsonError(400, "Invalid request body");
        }
        const ws = await requireWorkspaceAccess(request, body?.workspaceId);
        if (!ws.ok) return ws.response;

        const items: ScheduleItem[] = Array.isArray(body?.items)
          ? body.items.filter((it: any) => it && typeof it.contentItemId === "string" && typeof it.scheduledAt === "string")
          : [];
        if (items.length === 0) return jsonError(400, "items[] with contentItemId + scheduledAt required");
        const selection = body?.selection as PublishSelection | undefined;
        if (!selection || !["account", "platform", "all"].includes(selection.type)) {
          return jsonError(400, "Invalid destination selection");
        }

        // US5 (FR-017): flag off → degrade to today's mock (status flip) server-side.
        if (!isSdrEnabled()) {
          const out = await handleSdrDisabled(
            { workspaceId: ws.workspaceId, contentItemIds: items.map((i) => i.contentItemId), kind: "schedule", scheduledAt: items[0]?.scheduledAt },
            { db: supabaseAdmin },
          );
          return Response.json(out.body, { status: out.status });
        }

        try {
          const token = await getWorkspaceSdrKey(ws.workspaceId);
          const baseUrl = process.env.SDR_BASE_URL ?? "";
          const out = await scheduleContentItemsHandler(
            { workspaceId: ws.workspaceId, items, selection },
            { sdrBaseUrl: baseUrl, token, db: supabaseAdmin },
          );
          return Response.json(out.body, { status: out.status });
        } catch (e) {
          return jsonError(503, e instanceof Error ? e.message : "SDR schedule failed");
        }
      },
    },
  },
});
