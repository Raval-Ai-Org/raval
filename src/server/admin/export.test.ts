import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

const listAudit = vi.fn();
const recordAdminAudit = vi.fn();
vi.mock("./audit-read.server", () => ({ listAudit: (...a: unknown[]) => listAudit(...a) }));
vi.mock("./audit.server", () => ({
  recordAdminAudit: (...a: unknown[]) => recordAdminAudit(...a),
}));

import { EXPORT_MAX_ROWS, exportAudit } from "./export.server";

const actor = {
  actorId: "a0000000-0000-4000-8000-000000000001",
  actorRole: "finance",
  audit: { requestId: "r", ip: null, userAgent: null },
};

const row = (i: number, reason: string | null = null) => ({
  id: `id-${i}`,
  createdAt: "2026-10-18T00:00:00Z",
  actorUserId: "u1",
  actorEmail: "a•••@x.test",
  actorRole: "support",
  action: "user.suspended",
  targetType: "user",
  targetId: `t-${i}`,
  workspaceId: null,
  before: null,
  after: null,
  reason,
  success: true,
  error: null,
  requestId: "req",
  ip: null,
});

beforeEach(() => vi.clearAllMocks());

describe("exportAudit", () => {
  it("writes a CSV, records the export and reports no truncation", async () => {
    listAudit.mockResolvedValue({ total: 2, page: 1, pageSize: 500, rows: [row(1), row(2)] });
    const result = await exportAudit(actor, {}, "Quarterly compliance review", false);
    expect(result.rows).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.filename).toMatch(/^mellox-audit-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(result.csv.split("\r\n")[0]).toBe(
      "time,actor,role,action,target_type,target_id,workspace_id,success,reason,error,ip,request_id",
    );
    const entry = recordAdminAudit.mock.calls[0][0] as {
      action: string;
      reason: string;
      after: { rows: number };
    };
    expect(entry.action).toBe("audit.exported");
    expect(entry.reason).toBe("Quarterly compliance review");
    expect(entry.after.rows).toBe(2);
  });

  it("passes the masking decision through to the read", async () => {
    listAudit.mockResolvedValue({ total: 0, page: 1, pageSize: 500, rows: [] });
    await exportAudit(actor, {}, "Quarterly compliance review", false);
    expect(listAudit.mock.calls[0][1]).toBe(false);
    await exportAudit(actor, {}, "Quarterly compliance review", true);
    expect(listAudit.mock.calls[1][1]).toBe(true);
  });

  it("caps the file and says so", async () => {
    const page = Array.from({ length: 500 }, (_, i) => row(i));
    listAudit.mockResolvedValue({ total: 99_999, page: 1, pageSize: 500, rows: page });
    const result = await exportAudit(actor, {}, "Quarterly compliance review", false);
    expect(result.rows).toBe(EXPORT_MAX_ROWS);
    expect(result.truncated).toBe(true);
    expect(listAudit).toHaveBeenCalledTimes(EXPORT_MAX_ROWS / 500);
  });

  it("stops a formula in a typed reason from running in a spreadsheet", async () => {
    listAudit.mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 500,
      rows: [row(1, '=HYPERLINK("http://evil.test")')],
    });
    const result = await exportAudit(actor, {}, "Quarterly compliance review", false);
    expect(result.csv).toContain("\"'=HYPERLINK(");
    expect(result.csv).not.toMatch(/,=HYPERLINK/);
  });
});
