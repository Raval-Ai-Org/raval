// POST /api/sdr/cancel — cancel a scheduled item before it fires (FR-009).
import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { getWorkspaceSdrConfig } from "@/lib/sdr.helpers.server";
import { cancelScheduledHandler } from "@/lib/sdr.handlers";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  workspaceId: z.unknown(),
  contentItemId: z.string({ required_error: "contentItemId required" }),
});

export const POST = defineRoute({
  name: "sdr/cancel",
  auth: "workspace",
  body: BodySchema,
  workspaceId: ({ body }) => body.workspaceId,
  minRole: "editor",
  handler: async ({ body, workspaceId }) => {
    try {
      const { token, baseUrl } = await getWorkspaceSdrConfig(workspaceId);
      const out = await cancelScheduledHandler(
        { workspaceId, contentItemId: body.contentItemId },
        { sdrBaseUrl: baseUrl, token, db: supabaseAdmin },
      );
      return Response.json(out.body, { status: out.status });
    } catch (e) {
      return jsonError(503, e instanceof Error ? e.message : "SDR cancel failed");
    }
  },
});
