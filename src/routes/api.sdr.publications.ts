// GET /api/sdr/publications — the per-platform delivery mirror for a content
// item (FR-010). Read via the user-scoped client so RLS gates it; the Studio
// re-fetches on content:changed to reflect webhook-driven updates (R2d).
import { createFileRoute } from "@tanstack/react-router";
import { jsonError } from "@/server/api-auth";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/api/sdr/publications")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const workspaceId = url.searchParams.get("workspaceId");
        const contentItemId = url.searchParams.get("contentItemId");
        if (!workspaceId || !contentItemId)
          return jsonError(400, "workspaceId + contentItemId required");

        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!supabaseUrl || !supabaseKey) return jsonError(500, "Server not configured");
        const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
        const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        });

        const { data, error } = await supabase
          .from("content_publications")
          .select(
            "id, platform, account_id, status, platform_post_url, platform_post_id, error_category, last_error, delivered_at",
          )
          .eq("workspace_id", workspaceId)
          .eq("content_item_id", contentItemId)
          .order("created_at", { ascending: true });
        if (error) return jsonError(500, error.message);
        return Response.json(data ?? []);
      },
    },
  },
});
