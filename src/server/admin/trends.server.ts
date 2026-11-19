// Trend Radar for the admin console (ADR-0052): list, save (draft, publish,
// end) and media. Customers read live trends through `live_trends_for`; this
// is the staff side, and every save is audited by `admin_trend_save` in the
// same transaction.
import "server-only";
import type { AdminTrend } from "@/lib/admin/types";
import { isLive, radarFromRow } from "@/lib/trends/radar";
import { signTrendMedia, isTrendMediaPath } from "@/server/trends/media.server";
import type { AuditContext } from "./audit.server";
import { adminDb, adminRpc, httpErrorFromPg } from "./db.server";

type Row = Record<string, unknown> & {
  id: string;
  status: AdminTrend["status"];
  starts_at: string;
  ends_at: string | null;
  published_at: string | null;
  created_at: string;
};

export function trendState(
  row: Pick<Row, "status" | "starts_at" | "ends_at">,
  now = new Date(),
): AdminTrend["state"] {
  if (row.status === "draft") return "draft";
  if (row.status === "archived") return "archived";
  if (Date.parse(row.starts_at) > now.getTime()) return "scheduled";
  if (row.ends_at && Date.parse(row.ends_at) <= now.getTime()) return "ended";
  return isLive({ status: row.status, startsAt: row.starts_at, endsAt: row.ends_at }, now)
    ? "live"
    : "ended";
}

export async function listTrends(): Promise<AdminTrend[]> {
  const { data, error } = await adminDb
    .from("platform_trends")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw httpErrorFromPg(error, "Could not read the trends.");
  const rows = (data ?? []) as Row[];
  const trends = rows.map((row) => ({ row, trend: radarFromRow(row) })).filter((r) => r.trend);
  const signed = await signTrendMedia(trends.flatMap((r) => r.trend!.media.map((m) => m.path)));
  return trends.map(({ row, trend }) => ({
    id: trend!.id,
    title: trend!.title,
    brief: trend!.brief,
    whatToMake: trend!.whatToMake,
    doNots: trend!.doNots,
    scope: trend!.scope,
    industries: trend!.industries,
    workspaceIds: trend!.workspaceIds,
    languages: trend!.languages,
    platforms: trend!.platforms,
    tags: trend!.tags,
    links: trend!.links,
    media: trend!.media.map((m) => ({
      path: m.path,
      kind: m.kind,
      caption: m.caption ?? null,
      url: signed.get(m.path) ?? null,
    })),
    allowMood: trend!.allowMood,
    priority: trend!.priority,
    status: trend!.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    state: trendState(row),
  }));
}

export type TrendInput = {
  id?: string;
  title: string;
  brief: string;
  whatToMake: string;
  doNots: string;
  scope: AdminTrend["scope"];
  industries: string[];
  workspaceIds: string[];
  languages: string[];
  platforms: string[];
  tags: string[];
  links: string[];
  media: { path: string; kind: "image" | "video"; caption: string | null }[];
  allowMood: boolean;
  priority: number;
  status: AdminTrend["status"];
  startsAt: string | null;
  endsAt: string | null;
  reason: string;
};

export async function saveTrend(
  actor: { actorId: string; actorRole: string; audit: AuditContext },
  input: TrendInput,
): Promise<{ id: string }> {
  // Media paths come from our own upload route; anything else is dropped.
  const media = input.media.filter((m) => isTrendMediaPath(m.path)).slice(0, 12);
  return adminRpc<{ id: string }>(
    "admin_trend_save",
    {
      p_actor: actor.actorId,
      p_actor_role: actor.actorRole,
      p_id: input.id ?? null,
      p_trend: {
        title: input.title,
        brief: input.brief,
        what_to_make: input.whatToMake,
        do_nots: input.doNots,
        scope: input.scope,
        industries: input.industries,
        workspace_ids: input.workspaceIds,
        languages: input.languages,
        platforms: input.platforms,
        tags: input.tags,
        links: input.links,
        media,
        allow_mood: input.allowMood,
        priority: input.priority,
        status: input.status,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
      },
      p_reason: input.reason,
      p_request_id: actor.audit.requestId,
      p_ip: actor.audit.ip,
      p_user_agent: actor.audit.userAgent,
    },
    "Could not save the trend.",
  );
}
