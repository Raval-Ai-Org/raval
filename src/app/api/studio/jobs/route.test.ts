import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  createJob: vi.fn(),
  getEntitlements: vi.fn(),
  insertShadow: vi.fn(),
  hold: vi.fn(),
  saveLink: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("@/server/api-auth", () => ({
  requireUserId: async () => ({
    ok: true,
    userId: "00000000-0000-4000-8000-000000000001",
    supabase: {},
  }),
  checkWorkspaceMembership: async () => ({
    ok: true,
    workspaceId: "00000000-0000-4000-8000-000000000002",
    role: "editor",
  }),
  jsonError: (status: number, message: string) => Response.json({ error: message }, { status }),
  UUID_RE: /^[0-9a-f-]{36}$/i,
}));
vi.mock("@/server/rate-limit", () => ({
  enforceRateLimit: async () => null,
  RateLimitedError: class extends Error {},
  rateLimitResponse: () => Response.json({}, { status: 429 }),
}));
vi.mock("@/server/studio/runner.server", () => ({
  createStudioJob: mocked.createJob,
  listJobs: vi.fn(),
  StudioJobError: class extends Error {},
}));
vi.mock("@/server/billing/entitlements.server", () => ({
  getEntitlements: mocked.getEntitlements,
}));
vi.mock("@/server/billing/meters.server", () => ({
  holdMeter: mocked.hold,
  captureMeter: mocked.capture,
  releaseMeter: vi.fn(),
}));
vi.mock("@/server/billing/studio-async.server", () => ({ saveStudioBillingLink: mocked.saveLink }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => ({ insert: mocked.insertShadow }) },
}));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocked.createJob.mockResolvedValue({ id: "job-1", status: "succeeded" });
  mocked.insertShadow.mockResolvedValue({ error: null });
  mocked.saveLink.mockResolvedValue(undefined);
  mocked.hold.mockResolvedValue({ ok: true, id: "hold-1" });
  mocked.getEntitlements.mockResolvedValue({
    accountId: "account-1",
    enforcement: "shadow",
    role: "editor",
    frozen: false,
    entitledPlan: "free",
    features: { studio: { allowed: true, requiredPlan: "free" } },
    meters: { credits: { available: 100 } },
  });
});

describe("Studio billing shadow path", () => {
  it("completes a social job and logs its catalog price without holding money", async () => {
    const response = await POST(
      new Request("http://localhost/api/studio/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: "00000000-0000-4000-8000-000000000002",
          type: "social",
          idempotencyKey: "studio-click-001",
          intent: { brief: "Announce the autumn launch" },
          controls: { platforms: ["linkedin"] },
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ job: { id: "job-1", status: "succeeded" } });
    expect(mocked.insertShadow).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: "account-1",
        action: "post_set",
        meter: "credits",
        amount: 12,
        decision: "would_charge",
      }),
    );
    expect(mocked.hold).not.toHaveBeenCalled();
  });
});

describe("Studio async billing", () => {
  it("starts a legacy render without a billing link when account billing is off", async () => {
    mocked.createJob.mockImplementation(async ({ onCreated }) => {
      await onCreated({ id: "job-1", status: "running" });
      return { id: "job-1", status: "running" };
    });
    mocked.getEntitlements.mockResolvedValue({
      accountId: "account-1",
      enforcement: "off",
      role: "editor",
      frozen: false,
      entitledPlan: "free",
      features: { studio: { allowed: true, requiredPlan: "free" } },
      meters: { credits: { available: 100 } },
    });
    const response = await POST(
      new Request("http://localhost/api/studio/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: "00000000-0000-4000-8000-000000000002",
          type: "image",
          idempotencyKey: "image-legacy-001",
          intent: { brief: "A campaign visual" },
          controls: {},
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(mocked.saveLink).not.toHaveBeenCalled();
  });

  it("keeps a render hold linked to the job instead of capturing on submission", async () => {
    mocked.createJob.mockImplementation(async ({ onCreated }) => {
      await onCreated({ id: "job-1", status: "running" });
      return { id: "job-1", status: "running" };
    });
    mocked.getEntitlements.mockResolvedValue({
      accountId: "account-1",
      enforcement: "on",
      role: "editor",
      frozen: false,
      entitledPlan: "starter",
      features: { studio: { allowed: true, requiredPlan: "free" } },
      meters: { credits: { available: 100 } },
    });
    const response = await POST(
      new Request("http://localhost/api/studio/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: "00000000-0000-4000-8000-000000000002",
          type: "image",
          idempotencyKey: "image-click-001",
          intent: { brief: "A campaign visual" },
          controls: {},
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(mocked.hold).toHaveBeenCalledWith(expect.objectContaining({ amount: 30 }));
    expect(mocked.saveLink).toHaveBeenCalledWith(
      expect.objectContaining({
        job_id: "job-1",
        hold_id: "hold-1",
        action: "image_post",
        mode: "on",
      }),
    );
    expect(mocked.capture).not.toHaveBeenCalled();
  });
});
