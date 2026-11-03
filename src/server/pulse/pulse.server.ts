// The workspace pulse (src/lib/pulse/pulse.ts): what is happening right now,
// read with the caller's own client (RLS) for one verified workspace id. It
// only reads rows that exist; it starts nothing and costs nothing.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CampaignPlanSchema } from "@/lib/campaigns/contracts";
import { currentPhase } from "@/lib/campaigns/progress";
import { isAutopilotEnabled, isCampaignsEnabled } from "@/lib/feature-flags";
import { buildPulse, type PulseRows, type WorkspacePulse } from "@/lib/pulse/pulse";

const empty = { data: null } as const;

export async function readPulse(
  client: SupabaseClient,
  workspaceId: string,
  today = new Date(),
): Promise<WorkspacePulse> {
  const autopilotOn = isAutopilotEnabled(workspaceId);
  const campaignsOn = isCampaignsEnabled(workspaceId);
  const [program, waiting, campaigns, products, goal] = await Promise.all([
    autopilotOn
      ? client
          .from("autopilot_programs")
          .select("status")
          .eq("workspace_id", workspaceId)
          .in("status", ["running", "paused"])
          .maybeSingle()
      : empty,
    autopilotOn || campaignsOn
      ? client
          .from("autopilot_actions")
          .select("campaign_id")
          .eq("workspace_id", workspaceId)
          .eq("kind", "content")
          .in("status", ["needs_approval", "proposed"])
          .limit(200)
      : empty,
    campaignsOn
      ? client
          .from("workspace_campaigns")
          .select("id, name, key_date, plan")
          .eq("workspace_id", workspaceId)
          .eq("status", "running")
          .order("starts_on", { ascending: true })
          .limit(6)
      : empty,
    client
      .from("workspace_products")
      .select("name")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .order("position", { ascending: true })
      .limit(6),
    client.from("workspace_goals").select("goals").eq("workspace_id", workspaceId).maybeSingle(),
  ]);

  const ymd = today.toISOString().slice(0, 10);
  const rows: PulseRows = {
    program: (program.data as { status: string } | null) ?? null,
    waiting: ((waiting.data ?? []) as { campaign_id: string | null }[]).filter(
      (w) => autopilotOn || w.campaign_id,
    ),
    campaigns: (
      (campaigns.data ?? []) as {
        id: string;
        name: string;
        key_date: string | null;
        plan: unknown;
      }[]
    ).map((c) => {
      const plan = CampaignPlanSchema.safeParse(c.plan);
      return {
        id: c.id,
        name: c.name,
        key_date: c.key_date,
        phase: plan.success ? (currentPhase(plan.data.phases, ymd)?.label ?? null) : null,
      };
    }),
    products: (products.data ?? []) as { name: string }[],
    goal: ((goal.data as { goals?: { focus?: unknown } } | null)?.goals ?? null) as {
      focus?: unknown;
    } | null,
  };
  return buildPulse(rows);
}
