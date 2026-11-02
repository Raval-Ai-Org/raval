import "server-only";
import { createServerFn } from "@/server/server-fn";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireWorkspaceRole } from "@/server/workspace-access.server";
import { AGENTS, rosterStates, type AgentFacts } from "@/lib/agents/roster";
import { z } from "zod";

// The agents roster (src/lib/agents/roster.ts) with each one's state, from
// rows the caller can already read. Free: it counts, it never runs anything.
export const getAgents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "viewer");
    const db = context.supabase as any;
    const ws = data.workspaceId;
    const count = async (query: any): Promise<number> => {
      const { count: n } = await query;
      return n ?? 0;
    };
    const [dna, social, workspace, program, apps, threads, settings] = await Promise.all([
      count(
        db
          .from("workspace_brand_dna")
          .select("workspace_id", { count: "exact", head: true })
          .eq("workspace_id", ws),
      ),
      count(
        db
          .from("social_accounts")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", ws)
          .eq("status", "active"),
      ),
      db.from("workspaces").select("website_url").eq("id", ws).maybeSingle(),
      db
        .from("autopilot_programs")
        .select("status, automations")
        .eq("workspace_id", ws)
        .eq("status", "active")
        .limit(1),
      db.from("integration_accounts").select("app").eq("workspace_id", ws).eq("status", "active"),
      count(
        db
          .from("community_threads")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", ws),
      ),
      db
        .from("workspace_agent_settings")
        .select("agents_paused, disabled_workers")
        .eq("workspace_id", ws)
        .maybeSingle(),
    ]);
    const active = program.data?.[0];
    const facts: AgentFacts = {
      hasBrandDna: dna > 0,
      socialAccounts: social,
      hasWebsite: typeof workspace.data?.website_url === "string" && !!workspace.data.website_url,
      autopilotOn: !!active,
      automations: Array.isArray(active?.automations) ? active.automations : [],
      apps: [...new Set(((apps.data ?? []) as Array<{ app: string }>).map((a) => a.app))],
      communityThreads: threads,
      agentsPaused: settings.data?.agents_paused === true,
      disabledWorkers: Array.isArray(settings.data?.disabled_workers)
        ? settings.data.disabled_workers
        : [],
    };
    const states = rosterStates(facts);
    return AGENTS.map((agent, i) => ({
      name: agent.name,
      does: agent.does,
      place: agent.place,
      ...states[i],
    }));
  });
