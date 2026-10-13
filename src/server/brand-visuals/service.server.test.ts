import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  upsert: vi.fn(),
  job: vi.fn(),
  feedback: vi.fn(),
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: mocks.from } }));
vi.mock("@/server/assets/storage.server", () => ({ signStoragePath: vi.fn() }));

import { loadVisualFeedbackRules, recordVisualFeedback } from "./service.server";

const caller = { workspaceId: "workspace-a", userId: "editor-a", role: "editor" as const };
let jobQuery: Record<string, ReturnType<typeof vi.fn>>;
let feedbackQuery: Record<string, ReturnType<typeof vi.fn>>;
beforeEach(() => {
  vi.clearAllMocks();
  jobQuery = { select: vi.fn(), eq: vi.fn(), maybeSingle: mocks.job };
  feedbackQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    order: vi.fn(),
    limit: mocks.feedback,
    upsert: mocks.upsert,
  };
  for (const key of ["select", "eq"]) jobQuery[key].mockReturnValue(jobQuery);
  for (const key of ["select", "eq", "is", "order"])
    feedbackQuery[key].mockReturnValue(feedbackQuery);
  mocks.from.mockImplementation((name: string) =>
    name === "studio_jobs" ? jobQuery : feedbackQuery,
  );
  mocks.job.mockResolvedValue({ data: { output: {} }, error: null });
  mocks.upsert.mockResolvedValue({ data: null, error: null });
  mocks.feedback.mockResolvedValue({ data: [], error: null });
});

describe("Brand Fit feedback", () => {
  it("saves feedback for a creation without an approved visual profile", async () => {
    await recordVisualFeedback(caller, {
      jobId: "job-a",
      reason: "too-busy",
      note: "Use fewer props",
    });
    expect(jobQuery.eq).toHaveBeenCalledWith("workspace_id", caller.workspaceId);
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: caller.workspaceId,
        job_id: "job-a",
        created_by: caller.userId,
        profile_id: null,
        source_ids: [],
        reason: "too-busy",
        note: "Use fewer props",
      }),
      { onConflict: "workspace_id,job_id,created_by" },
    );
  });
  it("takes the profile and source IDs from the saved generation", async () => {
    mocks.job.mockResolvedValue({
      data: {
        output: {
          visualTaste: {
            profileId: "profile-a",
            references: [{ sourceId: "source-a" }],
          },
        },
      },
      error: null,
    });
    await recordVisualFeedback(caller, { jobId: "job-a", reason: "matches", note: "" });
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        profile_id: "profile-a",
        source_ids: ["source-a"],
      }),
      expect.anything(),
    );
  });
  it("rejects another workspace's creation and viewer writes", async () => {
    mocks.job.mockResolvedValue({ data: null, error: null });
    const args = { jobId: "job-b", reason: "matches", note: "" };
    await expect(recordVisualFeedback(caller, args)).rejects.toMatchObject({ status: 404 });
    await expect(recordVisualFeedback({ ...caller, role: "viewer" }, args)).rejects.toMatchObject({
      status: 403,
    });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("returns a useful retryable error when feedback storage is unavailable", async () => {
    mocks.upsert.mockResolvedValue({
      data: null,
      error: { code: "PGRST205", message: "missing table" },
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        recordVisualFeedback(caller, { jobId: "job-a", reason: "matches", note: "" }),
      ).rejects.toMatchObject({
        status: 503,
        message: expect.stringContaining("Your feedback could not be saved"),
      });
    } finally {
      log.mockRestore();
    }
  });
  it("loads a single correction and written preferences for future manual-look visuals", async () => {
    mocks.feedback.mockResolvedValue({
      data: [{ reason: "too-busy", note: "Use fewer props" }],
      error: null,
    });
    const rules = await loadVisualFeedbackRules(caller.workspaceId);
    expect(feedbackQuery.eq).toHaveBeenCalledWith("workspace_id", caller.workspaceId);
    expect(feedbackQuery.is).toHaveBeenCalledWith("profile_id", null);
    expect(rules).toContain("Reduce incidental background clutter");
    expect(rules).toContain("Use fewer props");
  });
});
