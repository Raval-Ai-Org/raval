// /api/agents/actions — the approval drawer.
//   GET  ?workspaceId=&status=suggested|all  → proposed actions (RLS-bound read)
//   POST { workspaceId, id, decision: "approve"|"reject", reason? }  (editor+)
// Approval executes exactly that one action, after policy and role are
// re-checked (src/server/agents/approvals.ts).
import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { approveAction, rejectAction } from "@/server/agents/approvals";
import { productionStore } from "@/server/agents/service";

export const dynamic = "force-dynamic";

export const GET = defineRoute({
  name: "agents/actions.list",
  auth: "workspace",
  query: z.object({
    workspaceId: z.string().optional(),
    status: z.enum(["suggested", "all"]).default("suggested"),
  }),
  workspaceId: ({ query }) => query.workspaceId,
  handler: async ({ query, workspaceId, supabase }) => {
    let q = supabase
      .from("agent_action_requests")
      .select(
        "id, run_id, source, tool, title, preview, affected_records, status, decided_by, decided_at, decision_reason, executed_at, error, expires_at, created_at",
      )
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (query.status === "suggested") q = q.eq("status", "suggested");
    const { data, error } = await q;
    if (error) return jsonError(500, error.message);
    return { actions: data ?? [] };
  },
});

export const POST = defineRoute({
  name: "agents/actions.decide",
  auth: "workspace",
  minRole: "editor",
  body: z.object({
    workspaceId: z.string(),
    id: z.string().min(1),
    decision: z.enum(["approve", "reject"]),
    reason: z.string().max(500).optional(),
  }),
  workspaceId: ({ body }) => body.workspaceId,
  rateLimit: "generate",
  handler: async ({ body, workspaceId, userId, role }) => {
    const store = productionStore();
    if (body.decision === "reject") {
      const out = await rejectAction({
        store,
        requestId: body.id,
        workspaceId,
        userId,
        reason: body.reason,
      });
      return out.ok ? { status: "rejected" } : jsonError(409, out.error ?? "Could not reject");
    }
    const out = await approveAction({
      store,
      db: supabaseAdmin,
      requestId: body.id,
      workspaceId,
      userId,
      role,
      reason: body.reason,
    });
    if (out.ok) return { status: out.status, result: out.result };
    const status =
      out.status === "not_found"
        ? 404
        : out.status === "denied"
          ? 403
          : out.status === "failed"
            ? 502
            : 409;
    return jsonError(status, out.error);
  },
});
