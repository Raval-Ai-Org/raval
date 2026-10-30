// What the rest of Mellox reads about campaigns (ADR-0039):
//   - the Autopilot worker asks whether a campaign is still running and which
//     Studio controls a piece carries (its photos or clips, its product, its
//     call to action — all placed when the campaign was planned);
//   - every generator gets `campaignBlockFor` through loadStudioContext, so
//     Studio ideas, "Write it for me", chat and Autopilot's weekly plan know
//     what is running and support it instead of contradicting it.
// Reads with the service role for one verified workspace id.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ActionRow } from "@/lib/autopilot/contracts";
import { CampaignPlanSchema } from "@/lib/campaigns/contracts";
import { currentPhase } from "@/lib/campaigns/progress";
import { playbookById } from "@/lib/campaigns/playbooks";
import { isCampaignsEnabled } from "@/lib/feature-flags";
import type { StudioControls } from "@/lib/studio/jobs";

const db = supabaseAdmin as unknown as SupabaseClient;

export async function campaignState(
  workspaceId: string,
  campaignId: string,
): Promise<"running" | "paused" | "gone"> {
  const { data, error } = await db
    .from("workspace_campaigns")
    .select("status")
    .eq("workspace_id", workspaceId)
    .eq("id", campaignId)
    .maybeSingle();
  if (error) return "paused";
  const status = (data as { status?: string } | null)?.status;
  if (status === "running") return "running";
  if (status === "paused") return "paused";
  return "gone";
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ids = (value: unknown, max: number): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && uuid.test(v)).slice(0, max)
    : [];

/**
 * The Studio controls a campaign step carries. Everything comes from the
 * step's stored `result.campaign`; asset ids are checked against the
 * workspace again by createBilledStudioJob before anything is used.
 */
export function campaignControls(action: ActionRow): Partial<StudioControls> {
  const raw = action.result.campaign;
  if (!raw || typeof raw !== "object") return {};
  const c = raw as Record<string, unknown>;
  const out: Partial<StudioControls> = {};
  if (typeof c.name === "string" && c.name.trim()) out.campaign = c.name.trim().slice(0, 120);
  if (typeof c.cta === "string" && c.cta.trim()) out.cta = c.cta.trim().slice(0, 140);
  if (typeof c.productId === "string" && uuid.test(c.productId)) out.productId = c.productId;
  const type = action.content_type ?? "social";
  if (c.mediaMode === "design" && type !== "video" && type !== "story") {
    const photos = ids(c.mediaIds, type === "carousel" ? 6 : 1);
    if (photos.length) Object.assign(out, { referenceAssetIds: photos, referenceMode: "design" });
  } else if (c.mediaMode === "recap" && type === "video") {
    const photos = ids(c.mediaIds, 6);
    if (photos.length >= 2) Object.assign(out, { videoMode: "recap", referenceAssetIds: photos });
  } else if (c.mediaMode === "clips" && type === "video") {
    const clips = ids(c.mediaIds, 5);
    if (clips.length) Object.assign(out, { videoMode: "brand", sourceVideoAssetIds: clips });
  }
  return out;
}

type Running = {
  name: string;
  type: string;
  key_date: string | null;
  ends_on: string;
  plan: unknown;
};

/** A campaign that's on, as Studio's ideas and prompts see it. */
export type RunningCampaign = {
  name: string;
  label: string;
  phase: string | null;
  purpose: string;
  keyDate: string | null;
  endsOn: string;
};

/** The running campaigns, read once per Studio context. Empty when none or off. */
export async function runningCampaignsFor(
  workspaceId: string,
  today = new Date(),
): Promise<RunningCampaign[]> {
  if (!isCampaignsEnabled(workspaceId)) return [];
  const { data, error } = await db
    .from("workspace_campaigns")
    .select("name, type, key_date, ends_on, plan")
    .eq("workspace_id", workspaceId)
    .eq("status", "running")
    .order("starts_on", { ascending: true })
    .limit(6);
  if (error || !data?.length) return [];
  const ymd = today.toISOString().slice(0, 10);
  return (data as Running[]).map((row) => {
    const plan = CampaignPlanSchema.safeParse(row.plan);
    const phase = plan.success ? currentPhase(plan.data.phases, ymd) : null;
    return {
      name: row.name,
      label: playbookById(row.type)?.label ?? "Campaign",
      phase: phase?.label ?? null,
      purpose: phase?.purpose ?? "",
      keyDate: row.key_date,
      endsOn: row.ends_on,
    };
  });
}

/**
 * What every generator is told about the campaigns that are on: their names,
 * the phase each is in and its key date. Empty when there are none.
 */
export function campaignBlockText(campaigns: readonly RunningCampaign[]): string {
  if (!campaigns.length) return "";
  const lines = campaigns.map((c) =>
    [
      `- "${c.name}" (${c.label})`,
      c.phase ? `now in "${c.phase}": ${c.purpose}` : "",
      c.keyDate ? `key date ${c.keyDate}` : "",
      `runs until ${c.endsOn}`,
    ]
      .filter(Boolean)
      .join(" · "),
  );
  return [
    "## Campaigns running now",
    "Mellox is running these planned campaigns. Their own posts are already on the calendar. Other posts may support a campaign but never repeat its pieces, announce its news early or contradict it.",
    ...lines,
  ].join("\n");
}

export async function campaignBlockFor(workspaceId: string, today = new Date()): Promise<string> {
  return campaignBlockText(await runningCampaignsFor(workspaceId, today));
}
