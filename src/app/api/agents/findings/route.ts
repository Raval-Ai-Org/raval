// /api/agents/findings — the Operations inbox's findings.
//   GET  ?workspaceId=&status=open|acknowledged|resolved  → list (RLS-bound read)
//   POST { workspaceId, id, action: "acknowledge"|"resolve" }  (editor+)
import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const dynamic = "force-dynamic";

export const GET = defineRoute({
  name: "agents/findings.list",
  auth: "workspace",
  query: z.object({
    workspaceId: z.string().optional(),
    status: z.enum(["open", "acknowledged", "resolved", "all"]).default("open"),
  }),
  workspaceId: ({ query }) => query.workspaceId,
  handler: async ({ query, workspaceId, supabase }) => {
    let q = supabase
      .from("agent_findings")
      .select(
        "id, worker, severity, title, summary, evidence, hypotheses, affected, recommended_action, requires_human_approval, confidence, status, occurrences, last_seen_at, created_at, run_id",
      )
      .eq("workspace_id", workspaceId)
      .order("last_seen_at", { ascending: false })
      .limit(100);
    if (query.status !== "all") q = q.eq("status", query.status);
    const { data, error } = await q;
    if (error) return jsonError(500, error.message);
    return { findings: data ?? [] };
  },
});

export const POST = defineRoute({
  name: "agents/findings.update",
  auth: "workspace",
  minRole: "editor",
  body: z.object({
    workspaceId: z.string(),
    id: z.string().uuid(),
    action: z.enum(["acknowledge", "resolve", "reopen"]),
  }),
  workspaceId: ({ body }) => body.workspaceId,
  handler: async ({ body, workspaceId, userId }) => {
    const patch =
      body.action === "resolve"
        ? { status: "resolved", resolved_by: userId, resolved_at: new Date().toISOString() }
        : body.action === "acknowledge"
          ? { status: "acknowledged" }
          : { status: "open", resolved_by: null, resolved_at: null };
    // Findings are server-written (no member write policy); the membership +
    // role check above authorizes this scoped update.
    const { data, error } = await supabaseAdmin
      .from("agent_findings")
      .update(patch)
      .eq("id", body.id)
      .eq("workspace_id", workspaceId)
      .select("id, status")
      .maybeSingle();
    if (error) return jsonError(500, error.message);
    if (!data) return jsonError(404, "Finding not found");
    return data;
  },
});
