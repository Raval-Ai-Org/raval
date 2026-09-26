import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  link: vi.fn(),
  capture: vi.fn(),
  release: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mocked.link }) }),
      update: () => ({ eq: () => ({ is: mocked.update }) }),
      insert: mocked.insert,
    }),
  },
}));
vi.mock("./meters.server", () => ({
  captureMeter: mocked.capture,
  releaseMeter: mocked.release,
}));

import { settleStudioBilling } from "./studio-async.server";
import type { StudioJob } from "@/lib/studio/jobs";

const job = (status: string) => ({ id: "job-1", status }) as StudioJob;
const link = {
  job_id: "job-1",
  account_id: "account-1",
  workspace_id: "workspace-1",
  hold_id: "hold-1",
  charge_id: "charge-1",
  charge_key: "user:image_post:click-1",
  action: "image_post",
  meter: "credits",
  amount: 30,
  route: "studio.captions",
  mode: "on",
  shadow_decision: "would_charge",
  settled_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocked.link.mockResolvedValue({ data: link, error: null });
  mocked.capture.mockResolvedValue({ ok: true });
  mocked.release.mockResolvedValue({ ok: true });
  mocked.update.mockResolvedValue({ error: null });
  mocked.insert.mockResolvedValue({ error: null });
});

describe("Studio async settlement", () => {
  it("captures the original hold only when the render succeeds", async () => {
    await settleStudioBilling(job("succeeded"));
    expect(mocked.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "account-1",
        holdId: "hold-1",
        amount: 30,
        chargeId: "charge-1",
        idempotencyKey: "user:image_post:click-1",
      }),
    );
    expect(mocked.release).not.toHaveBeenCalled();
    expect(mocked.update).toHaveBeenCalledOnce();
  });

  it("releases a failed render without a charge", async () => {
    await settleStudioBilling(job("failed"));
    expect(mocked.release).toHaveBeenCalledWith(expect.objectContaining({ holdId: "hold-1" }));
    expect(mocked.capture).not.toHaveBeenCalled();
  });

  it("does not mark an uncertain capture as settled", async () => {
    mocked.capture.mockRejectedValue(new Error("database timeout"));
    await expect(settleStudioBilling(job("succeeded"))).rejects.toThrow("database timeout");
    expect(mocked.update).not.toHaveBeenCalled();
    expect(mocked.release).not.toHaveBeenCalled();
  });
});
