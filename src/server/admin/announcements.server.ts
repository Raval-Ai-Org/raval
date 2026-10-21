// Announcements for the admin console: list and save. Customers read the live
// ones straight from the table (row-level security allows only live rows); this
// module is the staff side, and every save is audited by the database function.
import "server-only";
import type { AdminAnnouncement } from "@/lib/admin/types";
import type { AuditContext } from "./audit.server";
import { adminDb, adminRpc, httpErrorFromPg } from "./db.server";

type Row = {
  id: string;
  title: string;
  body: string;
  tone: AdminAnnouncement["tone"];
  link_url: string | null;
  dismissible: boolean;
  active: boolean;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
};

export function announcementStatus(
  row: Pick<Row, "active" | "starts_at" | "ends_at">,
  now = Date.now(),
): AdminAnnouncement["status"] {
  if (!row.active) return "off";
  if (Date.parse(row.starts_at) > now) return "scheduled";
  if (row.ends_at && Date.parse(row.ends_at) <= now) return "ended";
  return "live";
}

export async function listAnnouncements(): Promise<AdminAnnouncement[]> {
  const { data, error } = await adminDb
    .from("platform_announcements")
    .select("id,title,body,tone,link_url,dismissible,active,starts_at,ends_at,created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw httpErrorFromPg(error, "Could not read the announcements.");
  return ((data ?? []) as Row[]).map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    tone: row.tone,
    linkUrl: row.link_url,
    dismissible: row.dismissible,
    active: row.active,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
    status: announcementStatus(row),
  }));
}

export type AnnouncementInput = {
  id?: string;
  title: string;
  body: string;
  tone: AdminAnnouncement["tone"];
  linkUrl: string | null;
  dismissible: boolean;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  reason: string;
};

export async function saveAnnouncement(
  actor: { actorId: string; actorRole: string; audit: AuditContext },
  input: AnnouncementInput,
): Promise<{ id: string }> {
  return adminRpc<{ id: string }>(
    "admin_announcement_save",
    {
      p_actor: actor.actorId,
      p_actor_role: actor.actorRole,
      p_id: input.id ?? null,
      p_title: input.title,
      p_body: input.body,
      p_tone: input.tone,
      p_link_url: input.linkUrl,
      p_dismissible: input.dismissible,
      p_active: input.active,
      p_starts_at: input.startsAt,
      p_ends_at: input.endsAt,
      p_reason: input.reason,
      p_request_id: actor.audit.requestId,
      p_ip: actor.audit.ip,
      p_user_agent: actor.audit.userAgent,
    },
    "Could not save the announcement.",
  );
}
