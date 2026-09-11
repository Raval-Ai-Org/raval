// GET /api/sdr/publications — the per-platform delivery mirror for a content
// item (FR-010). Read via the user-scoped client so RLS gates it; the Studio
// re-fetches on content:changed to reflect webhook-driven updates (R2d).
import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  workspaceId: z.string().uuid(),
  contentItemId: z.string().uuid(),
});

export const GET = defineRoute({
  name: "sdr/publications",
  auth: "workspace",
  query: QuerySchema,
  workspaceId: ({ query }) => query.workspaceId,
  handler: async ({ query, supabase }) => {
    const { data, error } = await supabase
      .from("content_publications")
      .select(
        "id, platform, account_id, status, platform_post_url, platform_post_id, error_category, last_error, delivered_at",
      )
      .eq("workspace_id", query.workspaceId)
      .eq("content_item_id", query.contentItemId)
      .order("created_at", { ascending: true });
    if (error) return jsonError(500, error.message);
    return Response.json(data ?? []);
  },
});
