// service.server.ts — campaigns (ADR-0039). Callers (src/server/fns/campaigns.ts)
// have already checked the workspace role; writes here use the service role
// for that one verified workspace and only ever store what the pure rules in
// src/lib/campaigns/ returned.
//
// The shape of a campaign (dates, channels, formats, media) is code's; the
// paid plan only writes its words; starting it writes one ordinary Autopilot
// `content` step per piece, made, approved and scheduled by the existing
// worker. Nothing here starts, spends or publishes by itself.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { llmJson } from "@/lib/ai-gateway.server";
import type { ActionRow, ActionStatus } from "@/lib/autopilot/contracts";
import { generateAt } from "@/lib/autopilot/policy";
import { addDaysYmd, ymdInZone, zonedInstant } from "@/lib/autopilot/time";
import { creditsFor } from "@/lib/billing/catalog";
import {
  CampaignBriefSchema,
  CampaignGoalSchema,
  CampaignPlanSchema,
  MAX_RUNNING_CAMPAIGNS,
  type CampaignBrief,
  type CampaignPiece,
  type CampaignPlan,
  type CampaignRow,
  type CampaignStatus,
  type CampaignView,
  type CampaignsHome,
  type PieceView,
} from "@/lib/campaigns/contracts";
import { groundCampaignPlan, groundText, type GroundOptions } from "@/lib/campaigns/ground";
import { ctaFor, isShareableLink } from "@/lib/campaigns/links";
import { assignMedia, settleFormats } from "@/lib/campaigns/media";
import { phaseOf, playbookById, type Playbook } from "@/lib/campaigns/playbooks";
import { campaignProgress, pieceState, UNMADE } from "@/lib/campaigns/progress";
import { briefFacts, pieceBrief, PLAN_SYSTEM, planUserPrompt } from "@/lib/campaigns/prompt";
import { buildCampaignSkeleton, takenBy, type TakenSlot } from "@/lib/campaigns/skeleton";
import { suggestCampaigns } from "@/lib/campaigns/suggest";
import { diffPieces, pieceSignature, type CampaignStep } from "@/lib/campaigns/sync";
import { isCampaignsEnabled, isAutopilotEnabled } from "@/lib/feature-flags";
import { upcomingMoments } from "@/lib/studio/moments";
import { trendLines } from "@/lib/studio/trends";
import { summarizeLearnings } from "@/lib/autopilot/learn";
import type { PlatformId } from "@/lib/social-platforms";
import { roleAtLeast, type WorkspaceRole } from "@/server/api-auth";
import { signAssetPath } from "@/server/assets/persist.server";
import { runMetered } from "@/server/billing/metered.server";
import { getEntitlements } from "@/server/billing/entitlements.server";
import { checkFragments } from "@/server/geo/fixes/grounding";
import { wrapUntrusted, UNTRUSTED_DATA_RULE } from "@/server/guardrails/untrusted";
import { HttpError } from "@/server/http-error";
import { runWithScope } from "@/server/request-context";
import { assertPublicUrl } from "@/server/safe-fetch";
import { loadStudioContext, invalidateStudioContext } from "@/server/studio/context.server";

const db = supabaseAdmin as unknown as SupabaseClient;
const TABLE = "workspace_campaigns";
const DAY = 86_400_000;

export type Caller = { workspaceId: string; userId: string; role: WorkspaceRole };

/** Off means "doesn't exist": 404, exactly like an unknown route. */
export function assertCampaignsEnabled(workspaceId: string): void {
  if (!isCampaignsEnabled(workspaceId)) throw new HttpError(404, "Not found");
}

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/* ───────────────────────── reading ───────────────────────── */

async function readRow(workspaceId: string, id: string): Promise<CampaignRow> {
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not read the campaign: ${error.message}`);
  if (!data) throw new HttpError(404, "Campaign not found");
  return data as CampaignRow;
}

function parseRow(row: CampaignRow): { brief: CampaignBrief; plan: CampaignPlan } {
  // The goal lives in its own column so a person's count never rewrites the brief.
  const brief = CampaignBriefSchema.safeParse({ ...row.brief, goal: row.goal });
  const plan = CampaignPlanSchema.safeParse(row.plan);
  if (!brief.success) throw new HttpError(409, "This campaign's brief can't be read.");
  return {
    brief: brief.data,
    plan: plan.success
      ? plan.data
      : { v: 1, bigIdea: "", phases: [], pieces: [], written: false, rev: 0 },
  };
}

type StepRow = Pick<
  ActionRow,
  "id" | "status" | "result" | "content_item_ids" | "last_error" | "updated_at"
> & { campaign_id: string };

async function stepsFor(workspaceId: string, campaignIds: string[]): Promise<StepRow[]> {
  if (!campaignIds.length) return [];
  const { data, error } = await db
    .from("autopilot_actions")
    .select("id, status, result, content_item_ids, last_error, updated_at, campaign_id")
    .eq("workspace_id", workspaceId)
    .in("campaign_id", campaignIds)
    .order("created_at", { ascending: true })
    .limit(600);
  if (error) throw new Error(error.message);
  return (data ?? []) as StepRow[];
}

const pieceIdOf = (step: Pick<StepRow, "result">): string | null => {
  const id = record(record(step.result).campaign).pieceId;
  return typeof id === "string" ? id : null;
};

async function thumbsFor(
  workspaceId: string,
  contentIds: string[],
): Promise<Map<string, { thumb: string | null; views: number | null }>> {
  const out = new Map<string, { thumb: string | null; views: number | null }>();
  if (!contentIds.length) return out;
  const { data } = await db
    .from("content_items")
    .select("id, media_url, meta, metrics")
    .eq("workspace_id", workspaceId)
    .in("id", contentIds.slice(0, 300));
  await Promise.all(
    ((data ?? []) as Record<string, unknown>[]).map(async (row) => {
      const meta = record(row.meta);
      const metrics = record(row.metrics);
      const path =
        typeof meta.asset_storage_path === "string"
          ? meta.asset_storage_path
          : Array.isArray(meta.asset_storage_paths) &&
              typeof meta.asset_storage_paths[0] === "string"
            ? meta.asset_storage_paths[0]
            : null;
      // Only a path inside this workspace's folder is ever signed.
      const own = path && path.startsWith(`${workspaceId}/`) ? path : null;
      const thumb = own
        ? await signAssetPath(own).catch(() => null)
        : typeof row.media_url === "string" && /^https:\/\//.test(row.media_url)
          ? row.media_url
          : null;
      const raw = metrics.views ?? metrics.impressions ?? metrics.reach;
      out.set(String(row.id), {
        thumb,
        views: typeof raw === "number" && raw >= 0 ? raw : null,
      });
    }),
  );
  return out;
}

function presentView(
  row: CampaignRow,
  steps: StepRow[],
  thumbs: Map<string, { thumb: string | null; views: number | null }>,
): CampaignView {
  const { brief, plan } = parseRow(row);
  const byPiece = new Map<string, StepRow>();
  for (const step of steps) {
    const id = pieceIdOf(step);
    if (!id) continue;
    const prev = byPiece.get(id);
    // The live step wins over an older, cancelled one.
    if (!prev || prev.status === "cancelled" || step.status !== "cancelled") byPiece.set(id, step);
  }
  const pieces: PieceView[] = plan.pieces.map((piece) => {
    const step = byPiece.get(piece.id) ?? null;
    const first = step?.content_item_ids[0];
    const media = first ? thumbs.get(first) : undefined;
    return {
      ...piece,
      state: pieceState(step?.status as ActionStatus | undefined),
      actionId: step?.id ?? null,
      contentIds: step?.content_item_ids ?? [],
      thumb: media?.thumb ?? null,
      views: media?.views ?? null,
      error: step?.status === "failed" ? (step.last_error ?? null) : null,
    };
  });
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    status: row.status,
    brief,
    plan,
    goal: brief.goal,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    keyDate: row.key_date,
    version: row.version,
    pieces,
    progress: campaignProgress(pieces),
    updatedAt: row.updated_at,
  };
}

async function viewsFor(workspaceId: string, rows: CampaignRow[]): Promise<CampaignView[]> {
  const steps = await stepsFor(
    workspaceId,
    rows.map((r) => r.id),
  );
  const thumbs = await thumbsFor(
    workspaceId,
    steps.flatMap((s) => s.content_item_ids.slice(0, 1)),
  );
  return rows.map((row) =>
    presentView(
      row,
      steps.filter((s) => s.campaign_id === row.id),
      thumbs,
    ),
  );
}

export async function getCampaign(caller: Caller, id: string): Promise<CampaignView> {
  const row = await readRow(caller.workspaceId, id);
  const view = (await viewsFor(caller.workspaceId, [row]))[0];
  return {
    ...view,
    mediaUrls: await mediaUrlsFor(
      caller.workspaceId,
      view.brief.media.map((m) => m.assetId),
    ),
  };
}

/** Preview links for the brief's photos and clips, signed only inside this workspace. */
async function mediaUrlsFor(workspaceId: string, ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const { data } = await db
    .from("assets")
    .select("id, storage_path, thumbnail_path, public_url")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .in("id", ids.slice(0, 32));
  const out: Record<string, string> = {};
  await Promise.all(
    (
      (data ?? []) as {
        id: string;
        storage_path: string | null;
        thumbnail_path: string | null;
        public_url: string | null;
      }[]
    ).map(async (a) => {
      const path = [a.thumbnail_path, a.storage_path].find(
        (p) => p && p.startsWith(`${workspaceId}/`),
      );
      const url = path
        ? await signAssetPath(path).catch(() => null)
        : a.public_url && /^https:/ //.test(a.public_url)
          ? a.public_url
          : null;
      if (url) out[a.id] = url;
    }),
  );
  return out;
}

export async function getCampaignsHome(caller: Caller): Promise<CampaignsHome> {
  const { workspaceId } = caller;
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("starts_on", { ascending: false })
    .limit(60);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as CampaignRow[];
  const campaigns = await viewsFor(workspaceId, rows);

  const today = new Date().toISOString().slice(0, 10);
  const [everyday, program, inputs, entitlements] = await Promise.all([
    everydayPosts(workspaceId, today),
    db
      .from("autopilot_programs")
      .select("mode, status")
      .eq("workspace_id", workspaceId)
      .in("status", ["running", "paused"])
      .maybeSingle(),
    suggestionInputs(workspaceId),
    getEntitlements(caller).catch(() => null),
  ]);
  const prog = program.data as { mode?: string; status?: string } | null;
  const suggestions = suggestCampaigns({
    today,
    moments: upcomingMoments(new Date(), { limit: 4, extraDays: 30 }),
    ...inputs,
    existing: rows
      .filter((r) => r.status !== "ended")
      .map((r) => ({ type: r.type, keyDate: r.key_date })),
  });
  const plan = entitlements?.features?.campaigns;
  return {
    campaigns,
    suggestions,
    everyday,
    autopilot: {
      running: isAutopilotEnabled(workspaceId) && prog?.status === "running",
      mode: prog?.mode ?? null,
    },
    canPlan:
      roleAtLeast(caller.role, "editor") &&
      (entitlements?.enforcement === "off" || plan?.allowed !== false),
    price: { plan: creditsFor("campaign"), write: creditsFor("ideas") },
  };
}

/** Autopilot's everyday posts over the next eight weeks, for the timeline. */
async function everydayPosts(workspaceId: string, today: string) {
  const until = new Date(Date.parse(`${today}T00:00:00Z`) + 56 * DAY).toISOString();
  const { data } = await db
    .from("autopilot_actions")
    .select("title, platform, planned_for")
    .eq("workspace_id", workspaceId)
    .eq("kind", "content")
    .is("campaign_id", null)
    .in("status", ["proposed", "planned", "generating", "needs_approval", "approved", "scheduled"])
    .gte("planned_for", `${today}T00:00:00Z`)
    .lte("planned_for", until)
    .order("planned_for", { ascending: true })
    .limit(120);
  return ((data ?? []) as { title: string; platform: string | null; planned_for: string }[]).map(
    (r) => ({ date: r.planned_for.slice(0, 10), platform: r.platform ?? "", title: r.title }),
  );
}

async function suggestionInputs(workspaceId: string) {
  const [products, featured, goals, opportunities, strategy, channels] = await Promise.all([
    db
      .from("workspace_products")
      .select("id, name")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(12),
    db
      .from("content_items")
      .select("meta->>product_id")
      .eq("workspace_id", workspaceId)
      .not("meta->>product_id", "is", null)
      .limit(300),
    db.from("workspace_goals").select("goals").eq("workspace_id", workspaceId).maybeSingle(),
    db
      .from("marketing_opportunities")
      .select("id, title, why_relevant, suggested_type")
      .eq("workspace_id", workspaceId)
      .eq("status", "new")
      .eq("suggested_type", "campaign")
      .limit(3),
    db
      .from("workspace_marketing_strategy")
      .select("strategy, status")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    db.from("autopilot_programs").select("platforms").eq("workspace_id", workspaceId).limit(1),
  ]);
  const featuredIds = new Set(
    ((featured.data ?? []) as Record<string, unknown>[]).map((r) => String(r.product_id ?? "")),
  );
  const strat = strategy.data as { strategy?: unknown; status?: string } | null;
  const roadmap =
    strat?.status === "confirmed" && Array.isArray(record(strat.strategy).roadmap)
      ? (record(strat.strategy).roadmap as Record<string, unknown>[])
          .map((r) => ({ phase: String(r.phase ?? ""), focus: String(r.focus ?? "") }))
          .filter((r) => r.phase)
      : [];
  const strategyChannels =
    strat?.status === "confirmed" && Array.isArray(record(strat.strategy).channels)
      ? (record(strat.strategy).channels as Record<string, unknown>[])
          .map((c) => String(c.platform ?? ""))
          .filter((p) => p && p !== "website" && p !== "email")
      : [];
  const programPlatforms = ((channels.data ?? [])[0] as { platforms?: string[] } | undefined)
    ?.platforms;
  return {
    products: ((products.data ?? []) as { id: string; name: string }[]).map((p) => ({
      ...p,
      featured: featuredIds.has(p.id),
    })),
    goalFocus:
      typeof record(record(goals.data).goals).focus === "string"
        ? String(record(record(goals.data).goals).focus)
        : null,
    opportunities: ((opportunities.data ?? []) as Record<string, unknown>[]).map((o) => ({
      id: String(o.id),
      title: String(o.title ?? ""),
      why: String(o.why_relevant ?? ""),
    })),
    roadmap,
    channels: (programPlatforms?.length ? programPlatforms : strategyChannels).slice(0, 5),
  };
}

/* ───────────────────────── shaping ───────────────────────── */

/** Everything already on the calendar over a window: the person's posts, other campaigns, Autopilot. */
async function takenSlots(
  workspaceId: string,
  from: string,
  to: string,
  exceptCampaign: string | null,
): Promise<TakenSlot[]> {
  const out: TakenSlot[] = [];
  const open = ["draft", "pending", "approved", "scheduled", "publishing", "published"];
  const { data: items } = await db
    .from("content_items")
    .select("channel, scheduled_at, meta")
    .eq("workspace_id", workspaceId)
    .in("status", open)
    .or(
      `and(scheduled_at.gte.${from}T00:00:00Z,scheduled_at.lte.${to}T23:59:59Z),and(meta->>calendar_date.gte.${from},meta->>calendar_date.lte.${to})`,
    )
    .limit(400);
  for (const row of (items ?? []) as Record<string, unknown>[]) {
    const meta = record(row.meta);
    if (exceptCampaign && meta.campaign_id === exceptCampaign) continue;
    const date =
      typeof row.scheduled_at === "string"
        ? row.scheduled_at.slice(0, 10)
        : String(meta.calendar_date ?? "");
    const channel = typeof row.channel === "string" ? row.channel : null;
    out.push({ date, platform: channel === "x" ? "twitter" : channel });
  }
  const { data: steps } = await db
    .from("autopilot_actions")
    .select("platform, planned_for, content_type, campaign_id")
    .eq("workspace_id", workspaceId)
    .eq("kind", "content")
    .in("status", ["proposed", "planned", "generating", "needs_approval", "approved", "scheduled"])
    .gte("planned_for", `${from}T00:00:00Z`)
    .lte("planned_for", `${to}T23:59:59Z`)
    .limit(400);
  for (const row of (steps ?? []) as Record<string, unknown>[]) {
    if (row.content_type === "story" || typeof row.planned_for !== "string") continue;
    if (exceptCampaign && row.campaign_id === exceptCampaign) continue;
    out.push({ date: row.planned_for.slice(0, 10), platform: (row.platform as string) ?? null });
  }
  // Other campaigns that are ready but not started yet have claimed their days too.
  const { data: others } = await db
    .from(TABLE)
    .select("id, plan")
    .eq("workspace_id", workspaceId)
    .eq("status", "ready")
    .limit(10);
  for (const row of (others ?? []) as { id: string; plan: unknown }[]) {
    if (row.id === exceptCampaign) continue;
    const plan = CampaignPlanSchema.safeParse(row.plan);
    if (plan.success) out.push(...takenBy(plan.data.pieces));
  }
  return out;
}

/** The brief's photos, clips and products, kept only where they belong to this workspace. */
async function checkOwned(workspaceId: string, brief: CampaignBrief): Promise<CampaignBrief> {
  const mediaIds = brief.media.map((m) => m.assetId);
  const [assets, products] = await Promise.all([
    mediaIds.length
      ? db
          .from("assets")
          .select("id, asset_type, status")
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null)
          .in("id", mediaIds)
      : Promise.resolve({ data: [] as unknown[] }),
    brief.productIds.length
      ? db
          .from("workspace_products")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("status", "active")
          .in("id", brief.productIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const ok = new Map(
    ((assets.data ?? []) as { id: string; asset_type: string; status: string }[])
      .filter((a) => a.status === "ready")
      .map((a) => [a.id, a.asset_type]),
  );
  const productIds = new Set(((products.data ?? []) as { id: string }[]).map((p) => p.id));
  return {
    ...brief,
    media: brief.media.filter((m) => ok.get(m.assetId) === m.kind),
    productIds: brief.productIds.filter((id) => productIds.has(id)),
  };
}

function checkLink(brief: CampaignBrief): void {
  const link = brief.goal.link;
  if (!link) return;
  if (!isShareableLink(link)) throw new HttpError(400, "Use a full https:// link people can open.");
  try {
    assertPublicUrl(link);
  } catch {
    throw new HttpError(400, "That link can't be used. Check it opens on the public web.");
  }
}

/** The skeleton for a brief, keeping the words of pieces that are still the same slot. */
async function shape(
  workspaceId: string,
  playbook: Playbook,
  brief: CampaignBrief,
  previous: CampaignPlan | null,
  campaignId: string | null,
): Promise<{ plan: CampaignPlan; startsOn: string; endsOn: string; keyDate: string }> {
  const today = ymdInZone(new Date(), brief.timezone);
  const horizon = addDaysYmd(brief.startsOn < today ? today : brief.startsOn, 7 * 14);
  const taken = await takenSlots(workspaceId, today, horizon, campaignId);
  const skeleton = buildCampaignSkeleton(playbook, brief, taken, today);
  const prior = new Map((previous?.pieces ?? []).map((p) => [p.id, p]));
  let pieces = skeleton.pieces.map((piece) => {
    const old = prior.get(piece.id);
    if (old?.edited) return old;
    if (old && old.phase === piece.phase && old.format === piece.format)
      return { ...piece, title: old.title, idea: old.idea, visual: old.visual };
    return piece;
  });
  pieces = assignMedia(playbook, settleFormats(playbook, pieces, brief.media), brief.media);
  return {
    plan: {
      v: 1,
      bigIdea: previous?.bigIdea ?? "",
      phases: skeleton.phases,
      pieces,
      written: Boolean(previous?.written) && pieces.every((p) => p.idea),
      rev: previous?.rev ?? 0,
    },
    startsOn: skeleton.startsOn,
    endsOn: skeleton.endsOn,
    keyDate: skeleton.keyDate,
  };
}

/* ───────────────────────── writing ───────────────────────── */

/**
 * Save a brief: new campaigns start as drafts. The free skeleton is laid out
 * at once, so the person sees the whole campaign before paying for words.
 */
export async function saveCampaign(
  caller: Caller,
  input: { id?: string | null; brief: unknown },
): Promise<CampaignView> {
  const parsed = CampaignBriefSchema.safeParse(input.brief);
  if (!parsed.success) throw new HttpError(400, "Some details of the campaign are missing.");
  const playbook = playbookById(parsed.data.type);
  if (!playbook) throw new HttpError(400, "Pick a kind of campaign.");
  checkLink(parsed.data);
  const brief = await checkOwned(caller.workspaceId, parsed.data);

  if (input.id) {
    const row = await readRow(caller.workspaceId, input.id);
    if (row.status === "done" || row.status === "ended")
      throw new HttpError(409, "This campaign has finished.");
    const current = parseRow(row);
    const live = row.status === "running" || row.status === "paused";
    const shaped = live
      ? {
          plan: { ...current.plan, rev: current.plan.rev + 1 },
          startsOn: row.starts_on,
          endsOn: row.ends_on,
          keyDate: row.key_date,
        }
      : await shape(caller.workspaceId, playbook, brief, current.plan, row.id);
    const { error } = await db
      .from(TABLE)
      .update({
        // The kind and dates of a running campaign stay; its words and facts may change.
        ...(live
          ? {}
          : {
              type: brief.type,
              starts_on: shaped.startsOn,
              ends_on: shaped.endsOn,
              key_date: shaped.keyDate,
            }),
        name: brief.name,
        brief: { ...brief, goal: undefined },
        goal: brief.goal,
        plan: shaped.plan,
        status: live ? row.status : shaped.plan.written ? "ready" : "draft",
        version: row.version + 1,
      })
      .eq("workspace_id", caller.workspaceId)
      .eq("id", row.id)
      .eq("version", row.version);
    if (error) throw new Error(error.message);
    if (live) await syncSteps(caller, row.id);
    return getCampaign(caller, row.id);
  }

  const shaped = await shape(caller.workspaceId, playbook, brief, null, null);
  const { data, error } = await db
    .from(TABLE)
    .insert({
      workspace_id: caller.workspaceId,
      type: brief.type,
      name: brief.name,
      status: "draft",
      brief: { ...brief, goal: undefined },
      goal: brief.goal,
      plan: shaped.plan,
      starts_on: shaped.startsOn,
      ends_on: shaped.endsOn,
      key_date: shaped.keyDate,
      created_by: caller.userId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return getCampaign(caller, (data as { id: string }).id);
}

/** A person changes one piece: its day, time, words or photos. Theirs from then on. */
export async function editPiece(
  caller: Caller,
  args: {
    campaignId: string;
    pieceId: string;
    patch: Partial<Pick<CampaignPiece, "date" | "time" | "title" | "idea" | "visual" | "mediaIds">>;
  },
): Promise<CampaignView> {
  const row = await readRow(caller.workspaceId, args.campaignId);
  if (row.status === "done" || row.status === "ended")
    throw new HttpError(409, "This campaign has finished.");
  const { brief, plan } = parseRow(row);
  const at = plan.pieces.findIndex((p) => p.id === args.pieceId);
  if (at < 0) throw new HttpError(404, "Piece not found");
  const owned = new Set(brief.media.map((m) => m.assetId));
  const next: CampaignPiece = { ...plan.pieces[at], ...args.patch, edited: true };
  if (args.patch.mediaIds) {
    next.mediaIds = args.patch.mediaIds.filter((id) => owned.has(id)).slice(0, 6);
    if (!next.mediaIds.length) next.mediaMode = "none";
    else if (next.mediaMode === "none")
      next.mediaMode = next.format === "video" ? "recap" : "design";
  }
  if (next.date < row.starts_on || next.date > addDaysYmd(row.ends_on, 14))
    throw new HttpError(400, "Keep the piece inside the campaign's dates.");
  const pieces = [...plan.pieces];
  pieces[at] = next;
  pieces.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const { error } = await db
    .from(TABLE)
    .update({ plan: { ...plan, pieces, rev: plan.rev + 1 }, version: row.version + 1 })
    .eq("workspace_id", caller.workspaceId)
    .eq("id", row.id)
    .eq("version", row.version);
  if (error) throw new Error(error.message);
  if (row.status === "running" || row.status === "paused") await syncSteps(caller, row.id);
  return getCampaign(caller, row.id);
}

/** The grounding check a plan's sentences must pass, from the brief and brand context. */
async function groundingFor(
  workspaceId: string,
  brief: CampaignBrief,
  corpus: string[],
): Promise<GroundOptions> {
  const { data } = await db
    .from("workspace_competitors")
    .select("name")
    .eq("workspace_id", workspaceId)
    .limit(60);
  const competitors = ((data ?? []) as { name: string }[]).map((r) => r.name);
  return {
    known: (sentence) => checkFragments([{ path: "campaign", text: sentence }], corpus, 0).ok,
    link: brief.goal.link,
    competitors,
  };
}

async function productLines(workspaceId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const { data } = await db
    .from("workspace_products")
    .select("name, price, description")
    .eq("workspace_id", workspaceId)
    .in("id", ids);
  return ((data ?? []) as { name: string; price: string; description: string }[]).map((p) =>
    [p.name, p.price && `price: ${p.price}`, p.description.slice(0, 300)]
      .filter(Boolean)
      .join(" — "),
  );
}

/**
 * The paid step: a model writes the words into the laid-out campaign. Priced
 * as the catalog's `campaign` action; the same idempotency key never charges
 * twice.
 */
export async function planCampaign(
  caller: Caller,
  args: { campaignId: string; idempotencyKey: string },
): Promise<CampaignView> {
  const row = await readRow(caller.workspaceId, args.campaignId);
  if (row.status === "done" || row.status === "ended")
    throw new HttpError(409, "This campaign has finished.");
  const { brief, plan } = parseRow(row);
  const playbook = playbookById(row.type);
  if (!playbook) throw new HttpError(409, "This kind of campaign is no longer offered.");
  if (!plan.pieces.length) throw new HttpError(409, "There's nothing to plan yet.");

  await runMetered(
    {
      workspaceId: caller.workspaceId,
      userId: caller.userId,
      role: caller.role,
      action: "campaign",
      idempotencyKey: args.idempotencyKey,
      route: "campaign.plan",
    },
    async () => {
      const ctx = await loadStudioContext(db, caller.workspaceId, null);
      const products = await productLines(caller.workspaceId, brief.productIds);
      const mediaLines = brief.media.map(
        (m, i) =>
          `${i + 1}. ${m.kind === "video" ? "Clip" : "Photo"}${m.role !== "any" ? ` (${m.role})` : ""}${m.label ? `: ${m.label}` : ""}`,
      );
      // What the brand's own posts showed, what works on these channels now
      // (the stored snapshot; never a search) and the openings already used.
      const channels = [...new Set(plan.pieces.map((p) => p.platform))];
      const learnings = await import("@/server/autopilot/ports.server")
        .then(async (m) => summarizeLearnings(await m.measuredPieces(caller.workspaceId)))
        .catch(() => [] as string[]);
      const recentOpenings = [
        ...new Set(ctx.recent.map((r) => r.hook?.trim()).filter((h): h is string => Boolean(h))),
      ]
        .slice(0, 8)
        .map((h) => h.slice(0, 140));
      const user = planUserPrompt({
        playbook,
        brief,
        pieces: plan.pieces,
        phases: plan.phases,
        trendText: trendLines(ctx.socialTrends, channels as PlatformId[], 6),
        learnings,
        recentOpenings,
        brandText: wrapUntrusted("brand-context", ctx.brandText, {
          maxChars: 6000,
          route: "campaign.plan",
        }),
        productLines: products,
        mediaLines,
      });
      const out = await runWithScope(
        { workspaceId: caller.workspaceId, userId: caller.userId, route: "campaign.plan" },
        () =>
          llmJson<Record<string, unknown>>({
            route: "campaign.plan",
            system: `${PLAN_SYSTEM}\n\n${UNTRUSTED_DATA_RULE}`,
            user,
            maxTokens: 12_000,
            timeoutMs: 90_000,
            retries: 1,
            fallback: {},
          }),
      );
      const corpus = [
        ctx.brandText,
        ...briefFacts(brief, products),
        ...plan.phases.map((p) => `${p.label} ${p.startsOn} ${p.endsOn}`),
        ...plan.pieces.map((p) => `${p.date} ${p.time}`),
      ];
      const opts = await groundingFor(caller.workspaceId, brief, corpus);
      const labels = Object.fromEntries(plan.phases.map((p) => [p.id, p.label]));
      const written = groundCampaignPlan(out, plan.pieces, labels, opts);
      if (written.dropped > plan.pieces.length / 2)
        throw new HttpError(502, "The plan didn't come out well. Nothing was charged; try again.");
      const next: CampaignPlan = {
        ...plan,
        bigIdea: written.bigIdea || plan.bigIdea,
        pieces: written.pieces,
        written: true,
        rev: plan.rev + 1,
      };
      const live = row.status === "running" || row.status === "paused";
      const { error } = await db
        .from(TABLE)
        .update({ plan: next, status: live ? row.status : "ready", version: row.version + 1 })
        .eq("workspace_id", caller.workspaceId)
        .eq("id", row.id)
        .eq("version", row.version);
      if (error) throw new Error(error.message);
    },
  );
  if (row.status === "running" || row.status === "paused") await syncSteps(caller, row.id);
  return getCampaign(caller, row.id);
}

/**
 * "Write it for me" in the designer: a name, what it's about and a key
 * message from the brand context and the chosen products. Never an offer.
 */
export async function writeCampaignBrief(
  caller: Caller,
  args: {
    type: string;
    name?: string;
    about?: string;
    productIds?: string[];
    idempotencyKey: string;
  },
): Promise<{ name: string; about: string; keyMessage: string }> {
  const playbook = playbookById(args.type);
  if (!playbook) throw new HttpError(400, "Pick a kind of campaign.");
  const { result } = await runMetered(
    {
      workspaceId: caller.workspaceId,
      userId: caller.userId,
      role: caller.role,
      action: "ideas",
      idempotencyKey: args.idempotencyKey,
      route: "campaign.write",
    },
    async () => {
      const ctx = await loadStudioContext(db, caller.workspaceId, null);
      const products = await productLines(caller.workspaceId, (args.productIds ?? []).slice(0, 3));
      const out = await runWithScope(
        { workspaceId: caller.workspaceId, userId: caller.userId, route: "campaign.write" },
        () =>
          llmJson<Record<string, unknown>>({
            route: "campaign.write",
            system: [
              "You help a brand describe one social media campaign in plain words.",
              'Answer as JSON: {"name": string (max 6 words), "about": string (2-3 sentences: what it is and who it is for), "keyMessage": string (one sentence people should remember)}.',
              "Use only what the brand context and products say. Never invent an offer, a price, a date or a number.",
              UNTRUSTED_DATA_RULE,
            ].join("\n"),
            user: [
              `Campaign type: ${playbook.label} — ${playbook.line}`,
              args.name ? `Working name: ${args.name.slice(0, 80)}` : "",
              args.about ? wrapUntrusted("person-notes", args.about.slice(0, 800)) : "",
              products.length ? wrapUntrusted("products", products.join("\n")) : "",
              wrapUntrusted("brand-context", ctx.brandText, { maxChars: 5000 }),
            ]
              .filter(Boolean)
              .join("\n\n"),
            maxTokens: 800,
            retries: 1,
            fallback: {},
          }),
      );
      const corpus = [ctx.brandText, ...products, args.about ?? "", args.name ?? ""];
      const opts: GroundOptions = {
        known: (s) => checkFragments([{ path: "brief", text: s }], corpus, 0).ok,
        link: null,
        competitors: [],
      };
      return {
        name: groundText(out.name, 80, opts) || args.name || playbook.label,
        about: groundText(out.about, 800, opts),
        keyMessage: groundText(out.keyMessage, 240, opts),
      };
    },
  );
  return result;
}

/* ───────────────────────── running ───────────────────────── */

/** Write the campaign's pieces as Autopilot steps, replacing only unmade ones. */
async function syncSteps(caller: Caller, campaignId: string): Promise<void> {
  const row = await readRow(caller.workspaceId, campaignId);
  if (row.status !== "running" && row.status !== "paused") return;
  const { brief, plan } = parseRow(row);
  const playbook = playbookById(row.type);
  if (!playbook) return;
  const steps = await stepsFor(caller.workspaceId, [row.id]);
  const builtBrief = (piece: CampaignPiece) => pieceBrief({ playbook, brief, plan, piece });
  const sigOf = (piece: CampaignPiece) => `${pieceSignature(piece)}#${hash(builtBrief(piece))}`;
  const current: CampaignStep[] = steps.map((s) => ({
    id: s.id,
    status: s.status as ActionStatus,
    pieceId: pieceIdOf(s),
    sig:
      typeof record(record(s.result).campaign).sig === "string"
        ? String(record(record(s.result).campaign).sig)
        : null,
  }));
  const diff = diffPieces(plan.pieces, current, sigOf);
  const now = new Date();

  if (diff.cancel.length) {
    await db
      .from("autopilot_actions")
      .update({
        status: "cancelled",
        finished_at: now.toISOString(),
        lease_until: null,
        locked_by: null,
      })
      .eq("workspace_id", caller.workspaceId)
      .in("id", diff.cancel)
      .in("status", UNMADE as unknown as string[]);
  }
  if (!diff.insert.length) return;

  const product = brief.productIds[0] ?? null;
  const rows = diff.insert.map((piece) => {
    const phase = phaseOf(playbook, piece.phase);
    const plannedFor = zonedInstant(piece.date, piece.time, brief.timezone);
    const story = piece.format === "story";
    return {
      workspace_id: caller.workspaceId,
      program_id: null,
      campaign_id: row.id,
      kind: "content",
      status: "planned",
      // A changed piece gets a new key; the same piece written twice does not.
      dedupe_key: `campaign:${row.id}:${piece.id}:${plan.rev}:${hash(sigOf(piece))}`.slice(0, 160),
      cycle: 0,
      planned_for: plannedFor.toISOString(),
      platform: piece.platform,
      content_type: piece.format,
      title: (piece.title || `${phase.label} — ${brief.name}`).slice(0, 200),
      brief: builtBrief(piece).slice(0, 4000),
      reason: `Part of the "${brief.name}" campaign: ${phase.label}.`.slice(0, 500),
      goal: GOAL_TO_AUTOPILOT[brief.goal.kind] ?? "awareness",
      requested_by: row.acting_user_id ?? caller.userId,
      next_attempt_at: generateAt(plannedFor.toISOString(), now, piece.format).toISOString(),
      result: {
        aim: piece.aim,
        hook: piece.hook,
        pillar: phase.label,
        ...(story
          ? {
              story_theme: piece.storyTheme ?? phase.story ?? "news",
              story_platforms: brief.channels.filter((c) => c === "instagram" || c === "facebook"),
            }
          : {}),
        campaign: {
          id: row.id,
          pieceId: piece.id,
          phase: piece.phase,
          name: brief.name,
          tz: brief.timezone,
          sig: sigOf(piece),
          mediaIds: piece.mediaIds,
          mediaMode: piece.mediaMode,
          productId: product,
          cta: ctaFor(piece.platform, brief.goal, phase.cta) ?? null,
        },
      },
    };
  });
  // Unique (workspace_id, dedupe_key): a repeat start writes nothing twice.
  const { error } = await db
    .from("autopilot_actions")
    .upsert(rows, { onConflict: "workspace_id,dedupe_key", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

const GOAL_TO_AUTOPILOT: Record<string, string> = {
  registrations: "leads",
  signups: "leads",
  leads: "leads",
  bookings: "sales",
  sales: "sales",
  followers: "awareness",
  reach: "awareness",
  engagement: "engagement",
};

function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

async function setStatus(
  caller: Caller,
  row: CampaignRow,
  status: CampaignStatus,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const { data, error } = await db
    .from(TABLE)
    .update({ status, version: row.version + 1, ...extra })
    .eq("workspace_id", caller.workspaceId)
    .eq("id", row.id)
    .eq("version", row.version)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new HttpError(409, "The campaign changed. Refresh and try again.");
  invalidateStudioContext(caller.workspaceId);
}

/** A person's click: the campaign goes on the calendar and its pieces start being made. */
export async function startCampaign(caller: Caller, campaignId: string): Promise<CampaignView> {
  const row = await readRow(caller.workspaceId, campaignId);
  if (row.status !== "ready") {
    throw new HttpError(
      409,
      row.status === "draft" ? "Write the plan first." : "It's already started.",
    );
  }
  const { count } = await db
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", caller.workspaceId)
    .in("status", ["running", "paused"]);
  if ((count ?? 0) >= MAX_RUNNING_CAMPAIGNS)
    throw new HttpError(
      409,
      `Up to ${MAX_RUNNING_CAMPAIGNS} campaigns can run at once. End one first.`,
    );
  await setStatus(caller, row, "running", {
    acting_user_id: caller.userId,
    started_at: new Date().toISOString(),
  });
  await syncSteps(caller, row.id);
  return getCampaign(caller, row.id);
}

export async function pauseCampaign(
  caller: Caller,
  campaignId: string,
  paused: boolean,
): Promise<CampaignView> {
  const row = await readRow(caller.workspaceId, campaignId);
  if (paused && row.status !== "running") throw new HttpError(409, "It isn't running.");
  if (!paused && row.status !== "paused") throw new HttpError(409, "It isn't paused.");
  await setStatus(caller, row, paused ? "paused" : "running");
  return getCampaign(caller, row.id);
}

/** Stop the campaign: pieces not made yet are removed; made ones stay where they are. */
export async function endCampaign(caller: Caller, campaignId: string): Promise<CampaignView> {
  const row = await readRow(caller.workspaceId, campaignId);
  if (row.status === "ended" || row.status === "done") return getCampaign(caller, row.id);
  await setStatus(caller, row, "ended", { ended_at: new Date().toISOString() });
  await db
    .from("autopilot_actions")
    .update({
      status: "cancelled",
      finished_at: new Date().toISOString(),
      lease_until: null,
      locked_by: null,
    })
    .eq("workspace_id", caller.workspaceId)
    .eq("campaign_id", row.id)
    .in("status", UNMADE as unknown as string[]);
  return getCampaign(caller, row.id);
}

/** The person's own number (registrations, sales). Mellox never fills it in. */
export async function setCampaignCount(
  caller: Caller,
  args: { campaignId: string; count: number | null },
): Promise<CampaignView> {
  const row = await readRow(caller.workspaceId, args.campaignId);
  const goal = CampaignGoalSchema.parse({
    ...row.goal,
    count: args.count,
    countAt: args.count === null ? null : new Date().toISOString(),
  });
  const { error } = await db
    .from(TABLE)
    .update({ goal, version: row.version + 1 })
    .eq("workspace_id", caller.workspaceId)
    .eq("id", row.id);
  if (error) throw new Error(error.message);
  return getCampaign(caller, row.id);
}

/** Only a campaign that never started can be deleted; a started one is ended instead. */
export async function deleteCampaign(caller: Caller, campaignId: string): Promise<void> {
  const row = await readRow(caller.workspaceId, campaignId);
  if (row.status !== "draft" && row.status !== "ready")
    throw new HttpError(409, "A started campaign is ended, not deleted.");
  const { error } = await db
    .from(TABLE)
    .delete()
    .eq("workspace_id", caller.workspaceId)
    .eq("id", row.id);
  if (error) throw new Error(error.message);
}

/** Running campaigns whose last day has passed are marked done. Called from the read path. */
export async function settleFinished(workspaceId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await db
    .from(TABLE)
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("status", "running")
    .lt("ends_on", addDaysYmd(today, -2))
    .limit(10);
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  if (!ids.length) return;
  await db
    .from(TABLE)
    .update({ status: "done", ended_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .in("id", ids)
    .eq("status", "running");
  invalidateStudioContext(workspaceId);
}
