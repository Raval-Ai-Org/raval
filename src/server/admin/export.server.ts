// Audit log export. An export copies sensitive history out of the console, so it
// is a permission of its own (data.export), needs a written reason, is capped, and
// is itself written to the audit log (who, which filter, how many rows). Personal
// data follows the usual masking: an admin without users.pii.read gets masked
// emails and no IP addresses, in the file too.
import "server-only";
import { toCsv } from "@/lib/admin/csv";
import { recordAdminAudit, type AuditContext } from "./audit.server";
import { listAudit, type AuditFilter } from "./audit-read.server";

export const EXPORT_MAX_ROWS = 5000;
const PAGE = 500;

type Actor = { actorId: string; actorRole: string; audit: AuditContext };

export type AuditExport = {
  filename: string;
  csv: string;
  rows: number;
  /** More rows matched than the cap allows. */
  truncated: boolean;
};

const HEADER = [
  "time",
  "actor",
  "role",
  "action",
  "target_type",
  "target_id",
  "workspace_id",
  "success",
  "reason",
  "error",
  "ip",
  "request_id",
];

export async function exportAudit(
  actor: Actor,
  filter: Omit<AuditFilter, "page" | "pageSize">,
  reason: string,
  pii: boolean,
): Promise<AuditExport> {
  const lines: unknown[][] = [];
  let total = 0;
  for (let page = 1; lines.length < EXPORT_MAX_ROWS; page++) {
    const result = await listAudit({ ...filter, page, pageSize: PAGE }, pii);
    total = result.total;
    for (const row of result.rows) {
      if (lines.length >= EXPORT_MAX_ROWS) break;
      lines.push([
        row.createdAt,
        row.actorEmail ?? row.actorUserId,
        row.actorRole,
        row.action,
        row.targetType,
        row.targetId,
        row.workspaceId,
        row.success,
        row.reason,
        row.error,
        row.ip,
        row.requestId,
      ]);
    }
    if (result.rows.length < PAGE) break;
  }

  // The export is recorded before the file is handed over. (A failure to write the
  // row is logged by recordAdminAudit rather than thrown, like every refusal row.)
  await recordAdminAudit(
    {
      actorUserId: actor.actorId,
      actorRole: actor.actorRole,
      action: "audit.exported",
      targetType: "audit_log",
      reason,
      after: {
        rows: lines.length,
        matched: total,
        filter: {
          actor: filter.actor ?? null,
          action: filter.action ?? null,
          from: filter.from ?? null,
          to: filter.to ?? null,
          failedOnly: Boolean(filter.failedOnly),
        },
      },
    },
    actor.audit,
  );

  const stamp = new Date().toISOString().slice(0, 10);
  return {
    filename: `mellox-audit-${stamp}.csv`,
    csv: toCsv(HEADER, lines),
    rows: lines.length,
    truncated: total > lines.length,
  };
}
