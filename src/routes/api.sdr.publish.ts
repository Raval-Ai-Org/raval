// POST /api/sdr/publish — publish approved content to selected destinations
// (FR-005..007). Server-side approval gate (FR-024); idempotent (FR-006/SC-003);
// pre-validates platform limits (FR-027). The webhook receiver owns terminal
// delivery state afterwards.
import { createFileRoute } from "@tanstack/react-router";
import { jsonError } from "@/server/api-auth";
import { requireWorkspaceAccess, getWorkspaceSdrKey } from "@/lib/sdr.helpers.server";
import { publishContentItemsHandler, handleSdrDisabled, type PublishSelection } from "@/lib/sdr.handlers";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isSdrEnabled } from "@/lib/feature-flags";

const SELECTION_TYPES = ["account", "platform", "all"] as const;

export const Route = createFileRoute("/api/sdr/publish")({
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

        const contentItemIds = Array.isArray(body?.contentItemIds)
          ? body.contentItemIds.filter((x: unknown): x is string => typeof x === "string")
          : [];
        if (contentItemIds.length === 0) return jsonError(400, "contentItemIds required");
        const selection = body?.selection as PublishSelection | undefined;
        if (!selection || !SELECTION_TYPES.includes(selection.type)) {
          return jsonError(400, "Invalid destination selection");
        }

        // US5 (FR-017): flag off → degrade to today's mock (status flip) server-side.
        if (!isSdrEnabled()) {
          const out = await handleSdrDisabled({ workspaceId: ws.workspaceId, contentItemIds, kind: "publish" }, { db: supabaseAdmin });
          return Response.json(out.body, { status: out.status });
        }

        try {
          const token = await getWorkspaceSdrKey(ws.workspaceId);
          const baseUrl = process.env.SDR_BASE_URL ?? "";
          const out = await publishContentItemsHandler(
            { workspaceId: ws.workspaceId, contentItemIds, selection },
            { sdrBaseUrl: baseUrl, token, db: supabaseAdmin },
          );
          return Response.json(out.body, { status: out.status });
        } catch (e) {
          return jsonError(503, e instanceof Error ? e.message : "SDR publish failed");
        }
      },
    },
  },
});
