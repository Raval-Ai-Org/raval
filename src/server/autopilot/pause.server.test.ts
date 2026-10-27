import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  live: vi.fn(),
  update: vi.fn(),
  actions: vi.fn(),
  transition: vi.fn(),
  event: vi.fn(),
  find: vi.fn(),
  cancel: vi.fn(),
  settle: vi.fn(),
  feature: vi.fn(),
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("@/server/audit.server", () => ({ recordAudit: vi.fn() }));
vi.mock("@/server/billing/feature.server", () => ({ requireBillingFeature: mocks.feature }));
vi.mock("./store.server", () => ({
  supabaseAutopilotStore: {
    liveProgram: mocks.live,
    updateProgram: mocks.update,
    listActions: mocks.actions,
    transition: mocks.transition,
    addEvent: mocks.event,
  },
}));
vi.mock("./ports.server", () => ({
  realPorts: { studio: { findJob: mocks.find } },
  approveContent: vi.fn(),
  connectedPlatforms: vi.fn(),
  loadContent: vi.fn(),
  rejectContent: vi.fn(),
}));
vi.mock("@/server/studio/runner.server", () => ({ cancelStudioJob: mocks.cancel }));
vi.mock("@/server/billing/studio-async.server", () => ({ settleStudioBilling: mocks.settle }));
import { setPaused } from "./service.server";
const caller = { workspaceId: "workspace", userId: "user", role: "editor" as const };
const action = { id: "piece", program_id: "program", studio_job_id: "job", generation_attempt: 2 };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.live.mockResolvedValue({ id: "program", status: "running" });
  mocks.update.mockResolvedValue(true);
  mocks.actions.mockResolvedValue([
    action,
    { ...action, id: "other", program_id: "other-program" },
  ]);
  mocks.cancel.mockResolvedValue({ id: "job", status: "cancelled" });
});
describe("Autopilot pause credit safety", () => {
  it("pauses first, stops only its own generations and settles their holds", async () => {
    await setPaused(caller, true);
    expect(mocks.update).toHaveBeenCalledWith(
      "program",
      { status: "paused", pause_reason: "user" },
      "running",
    );
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.cancel.mock.invocationCallOrder[0],
    );
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(mocks.cancel).toHaveBeenCalledWith({}, "workspace", "job");
    expect(mocks.settle).toHaveBeenCalledWith({ id: "job", status: "cancelled" });
    expect(mocks.transition).toHaveBeenCalledWith(
      action,
      "planned",
      expect.objectContaining({ studio_job_id: null, credits_charged: 0, generation_attempt: 3 }),
    );
  });
  it("finds an in-flight job by its request key before the worker has stored its ID", async () => {
    mocks.actions.mockResolvedValue([{ ...action, studio_job_id: null }]);
    mocks.find.mockResolvedValue({ id: "racing-job" });
    await setPaused(caller, true);
    expect(mocks.find).toHaveBeenCalledWith("workspace", "autopilot:piece:2");
    expect(mocks.cancel).toHaveBeenCalledWith({}, "workspace", "racing-job");
  });
  it("does not queue a duplicate generation when the job had already completed", async () => {
    mocks.cancel.mockResolvedValue({ id: "job", status: "succeeded" });
    await setPaused(caller, true);
    expect(mocks.settle).toHaveBeenCalledWith({ id: "job", status: "succeeded" });
    expect(mocks.transition).not.toHaveBeenCalled();
  });
});
