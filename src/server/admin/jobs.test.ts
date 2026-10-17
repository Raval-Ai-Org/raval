import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

const adminRpc = vi.fn();
const maybeSingle = vi.fn();
const recordAdminAudit = vi.fn();
const cancelStudioJob = vi.fn();
const advanceStudioJob = vi.fn();
const getJobRow = vi.fn();
const settleStudioBilling = vi.fn();
const studioBillingLink = vi.fn();

vi.mock("./db.server", () => {
  const query = { select: () => query, eq: () => query, maybeSingle: () => maybeSingle() };
  return {
    adminDb: { from: () => query },
    adminRpc: (...args: unknown[]) => adminRpc(...args),
    httpErrorFromPg: (e: { message?: string }) => new Error(e.message),
  };
});
vi.mock("./audit.server", () => ({
  recordAdminAudit: (...args: unknown[]) => recordAdminAudit(...args),
}));
vi.mock("@/server/studio/runner.server", () => ({
  cancelStudioJob: (...a: unknown[]) => cancelStudioJob(...a),
  advanceStudioJob: (...a: unknown[]) => advanceStudioJob(...a),
  getJobRow: (...a: unknown[]) => getJobRow(...a),
}));
vi.mock("@/server/billing/studio-async.server", () => ({
  settleStudioBilling: (...a: unknown[]) => settleStudioBilling(...a),
  studioBillingLink: (...a: unknown[]) => studioBillingLink(...a),
}));

import { cancelStudio, listJobs, nudgeStudio } from "./jobs.server";

const actor = {
  actorId: "a0000000-0000-4000-8000-000000000001",
  actorRole: "operations",
  audit: { requestId: "r", ip: null, userAgent: null },
};
const JOB = "50000001-0000-4000-8000-000000000001";
const WS = "20000001-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  maybeSingle.mockResolvedValue({ data: { workspace_id: WS, status: "running" }, error: null });
  studioBillingLink.mockResolvedValue(null);
});

describe("listJobs", () => {
  it("offers actions only on Studio jobs that are in flight", async () => {
    const row = (source: string, status: string) => ({
      source,
      id: `${source}-${status}`,
      workspace_id: WS,
      kind: "k",
      status,
      attempts: 1,
      max_attempts: null,
      created_at: "2026-10-18T00:00:00Z",
      updated_at: "2026-10-18T00:00:00Z",
      error: "",
      stuck: false,
    });
    adminRpc.mockResolvedValue({
      generated_at: "2026-10-18T00:00:00Z",
      counts: [],
      total: 5,
      rows: [
        row("studio", "running"),
        row("studio", "queued"),
        row("studio", "failed"),
        row("autopilot", "generating"),
        row("experiment", "running"),
      ],
    });
    const result = await listJobs({ source: "all", state: "all", page: 1, pageSize: 25 });
    expect(result.rows.map((r) => r.canAct)).toEqual([true, true, false, false, false]);
  });
});

describe("cancelStudio", () => {
  it("runs the owner's cancel, settles billing and audits it", async () => {
    cancelStudioJob.mockResolvedValue({ status: "cancelled" });
    const result = await cancelStudio(actor, JOB, "Customer asked support to stop it");
    expect(result).toEqual({ status: "cancelled" });
    expect(cancelStudioJob).toHaveBeenCalledWith(expect.anything(), WS, JOB);
    expect(settleStudioBilling).toHaveBeenCalledTimes(1);
    const entry = recordAdminAudit.mock.calls[0][0] as { action: string; success?: boolean };
    expect(entry.action).toBe("job.cancelled");
    expect(entry.success).not.toBe(false);
  });

  it("audits a failure and rethrows", async () => {
    cancelStudioJob.mockRejectedValue(new Error("boom"));
    await expect(cancelStudio(actor, JOB, "Customer asked support to stop it")).rejects.toThrow(
      "boom",
    );
    expect(recordAdminAudit.mock.calls[0][0]).toMatchObject({
      action: "job.cancelled",
      success: false,
    });
  });

  it("404s for a job that does not exist", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(cancelStudio(actor, JOB, "Customer asked support to stop it")).rejects.toThrow(
      /not found/i,
    );
    expect(cancelStudioJob).not.toHaveBeenCalled();
  });
});

describe("nudgeStudio", () => {
  it("advances a running job once and audits it", async () => {
    getJobRow.mockResolvedValue({ id: JOB, status: "running" });
    advanceStudioJob.mockResolvedValue({ id: JOB, status: "running" });
    await nudgeStudio(actor, JOB, "Looks stuck waiting for a poll");
    expect(advanceStudioJob).toHaveBeenCalledTimes(1);
    expect(recordAdminAudit.mock.calls[0][0]).toMatchObject({ action: "job.nudged" });
  });

  it("refuses a job that is not running", async () => {
    getJobRow.mockResolvedValue({ id: JOB, status: "failed" });
    await expect(nudgeStudio(actor, JOB, "Looks stuck waiting for a poll")).rejects.toThrow(
      /running/,
    );
    expect(advanceStudioJob).not.toHaveBeenCalled();
    expect(recordAdminAudit.mock.calls[0][0]).toMatchObject({ success: false });
  });
});
