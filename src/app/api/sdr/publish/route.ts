// POST /api/sdr/publish — publish approved content to selected destinations
// (FR-005..007). Server-side approval gate (FR-024); idempotent (FR-006/SC-003);
// pre-validates platform limits (FR-027). The webhook receiver owns terminal
// delivery state afterwards.
import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { getWorkspaceSdrKey } from "@/lib/sdr.helpers.server";
import {
  publishContentItemsHandler,
  handleSdrDisabled,
  type PublishSelection,
} from "@/lib/sdr.handlers";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isSdrEnabled } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

const SELECTION_TYPES: readonly string[] = ["account", "platform", "all"];

// Fields are validated individually below with the messages clients rely on.
const BodySchema = z.record(z.unknown());

export const POST = defineRoute({
  name: "sdr/publish",
  auth: "workspace",
  body: BodySchema,
  workspaceId: ({ body }) => body.workspaceId,
  handler: async ({ body, workspaceId }) => {
    const contentItemIds = Array.isArray(body.contentItemIds)
      ? body.contentItemIds.filter((x: unknown): x is string => typeof x === "string")
      : [];
    if (contentItemIds.length === 0) return jsonError(400, "contentItemIds required");
    const selection = body.selection as PublishSelection | undefined;
    if (!selection || !SELECTION_TYPES.includes(selection.type)) {
      return jsonError(400, "Invalid destination selection");
    }

    // US5 (FR-017): flag off → degrade to today's mock (status flip) server-side.
    if (!isSdrEnabled()) {
      const out = await handleSdrDisabled(
        { workspaceId, contentItemIds, kind: "publish" },
        { db: supabaseAdmin },
      );
      return Response.json(out.body, { status: out.status });
    }

    try {
      const token = await getWorkspaceSdrKey(workspaceId);
      const out = await publishContentItemsHandler(
        { workspaceId, contentItemIds, selection },
        { sdrBaseUrl: process.env.SDR_BASE_URL ?? "", token, db: supabaseAdmin },
      );
      return Response.json(out.body, { status: out.status });
    } catch (e) {
      return jsonError(503, e instanceof Error ? e.message : "SDR publish failed");
    }
  },
});
