// Emergency switches: list them, and stop or restart a paid area. A flip and
// its audit row are written together by admin_switch_set; the gateways read the
// switch through src/server/platform/switches.server.ts.
import "server-only";
import type { AdminSwitch } from "@/lib/admin/types";
import { clearSwitchCache, SWITCH_KEYS, type SwitchKey } from "@/server/platform/switches.server";
import type { AuditContext } from "./audit.server";
import { emailsFor, showEmail } from "./audit-read.server";
import { adminDb, adminRpc, httpErrorFromPg } from "./db.server";

const META: Record<SwitchKey, { label: string; description: string }> = {
  ai_text: {
    label: "AI writing",
    description: "Chat, Studio copy, plans and every other text model call.",
  },
  ai_image: { label: "Image generation", description: "Every image the platform generates." },
  ai_video: { label: "Video generation", description: "Every video the platform generates." },
  ai_search: {
    label: "Web research",
    description: "Live web search for Market, Competitors and chat.",
  },
};

export { SWITCH_KEYS };

export async function listSwitches(pii: boolean): Promise<AdminSwitch[]> {
  const { data, error } = await adminDb
    .from("platform_switches")
    .select("key,engaged,reason,changed_by,changed_at");
  if (error) throw httpErrorFromPg(error, "Could not read the switches.");
  const rows = (data ?? []) as Array<{
    key: SwitchKey;
    engaged: boolean;
    reason: string | null;
    changed_by: string | null;
    changed_at: string | null;
  }>;
  const emails = await emailsFor(rows.flatMap((r) => (r.changed_by ? [r.changed_by] : [])));
  return SWITCH_KEYS.map((key) => {
    const row = rows.find((r) => r.key === key);
    return {
      key,
      ...META[key],
      engaged: row?.engaged ?? false,
      reason: row?.reason ?? null,
      changedAt: row?.engaged || row?.reason ? (row?.changed_at ?? null) : null,
      changedByEmail: showEmail(row?.changed_by ? emails.get(row.changed_by) : null, pii),
    };
  });
}

export async function setSwitch(
  actor: { actorId: string; actorRole: string; audit: AuditContext },
  key: SwitchKey,
  engaged: boolean,
  reason: string,
): Promise<{ key: SwitchKey; engaged: boolean }> {
  const result = await adminRpc<{ key: SwitchKey; engaged: boolean }>(
    "admin_switch_set",
    {
      p_actor: actor.actorId,
      p_actor_role: actor.actorRole,
      p_key: key,
      p_engaged: engaged,
      p_reason: reason,
      p_request_id: actor.audit.requestId,
      p_ip: actor.audit.ip,
      p_user_agent: actor.audit.userAgent,
    },
    "Could not change the switch.",
  );
  clearSwitchCache();
  return result;
}
