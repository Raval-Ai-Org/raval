// POST /api/sdr/cancel — cancel a scheduled item before it fires. Dispatches
// by the provider that holds the item's schedule (recorded in its meta), so an
// item scheduled through one provider is always cancelled at that provider.
import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { getWorkspaceSdrConfig } from "@/lib/sdr.helpers.server";
import { cancelScheduledHandler } from "@/lib/sdr.handlers";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { cancelHandler } from "@/lib/socialapi/handlers";
import { handlerResponse, withSocialApi } from "@/lib/socialapi/route.server";

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
    const { data: item } = await supabaseAdmin
      .from("content_items")
      .select("meta")
      .eq("id", body.contentItemId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const meta = (item?.meta ?? {}) as Record<string, unknown>;
    if (typeof meta.socialapi_post_id === "string") {
      return withSocialApi(workspaceId, (deps) =>
        cancelHandler({ workspaceId, contentItemId: body.contentItemId }, deps),
      );
    }
    try {
      const { token, baseUrl } = await getWorkspaceSdrConfig(workspaceId);
      const out = await cancelScheduledHandler(
        { workspaceId, contentItemId: body.contentItemId },
        { sdrBaseUrl: baseUrl, token, db: supabaseAdmin },
      );
      return handlerResponse(out);
    } catch (e) {
      return jsonError(503, e instanceof Error ? e.message : "SDR cancel failed");
    }
  },
});
