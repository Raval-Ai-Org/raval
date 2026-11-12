import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  createJob: vi.fn(),
  getEntitlements: vi.fn(),
  insertShadow: vi.fn(),
  hold: vi.fn(),
  saveLink: vi.fn(),
  capture: vi.fn(),
  settle: vi.fn(),
  release: vi.fn(),
  claim: vi.fn(),
  claimLink: vi.fn(),
  claimSettle: vi.fn(),
}));
vi.mock("@/server/billing/creation.server", () => ({
  reserveCaptionEdit: mocked.claim,
  linkCaptionEdit: mocked.claimLink,
  settleCaptionEdit: mocked.claimSettle,
  captionEditsRemaining: async () => 2,
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
  releaseMeter: mocked.release,
}));
vi.mock("@/server/billing/studio-async.server", () => ({
  saveStudioBillingLink: mocked.saveLink,
  settleStudioBilling: mocked.settle,
  recoverStaleStudioJobs: vi.fn(),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => ({ insert: mocked.insertShadow }) },
}));

import { POST } from "./route";
import { InsufficientBalanceError } from "@/server/billing/errors";

beforeEach(() => {
  vi.clearAllMocks();
  mocked.createJob.mockImplementation(async ({ onCreated }) => {
    const job = { id: "job-1", status: "succeeded" };
    await onCreated(job);
    return job;
  });
  mocked.release.mockResolvedValue({ ok: true });
  mocked.insertShadow.mockResolvedValue({ error: null });
  mocked.saveLink.mockResolvedValue(undefined);
  mocked.hold.mockResolvedValue({ ok: true, id: "hold-1" });
  mocked.claim.mockResolvedValue({ id: "edit-1", chargeId: "original-paid-charge" });
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

describe("Studio creation points and included edits", () => {
  const request = (extra: Record<string, unknown> = {}) =>
    new Request("http://localhost/api/studio/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "00000000-0000-4000-8000-000000000002",
        type: "image",
        idempotencyKey: "new-policy-click",
        intent: { brief: "Announce our next product" },
        controls: { platforms: ["instagram"], paymentSource: "creation" },
        ...extra,
      }),
    });
  beforeEach(() =>
    mocked.getEntitlements.mockResolvedValue({
      accountId: "account-1",
      enforcement: "on",
      role: "editor",
      frozen: false,
      entitledPlan: "starter",
      creation: { active: true, monthlyPoints: 200, flexCredits: 500 },
      features: { studio: { allowed: true, requiredPlan: "free" } },
      meters: { creation: { available: 200 }, credits: { available: 1234 } },
    }),
  );
  it("reserves two points, without consuming wallet credits", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(mocked.hold).toHaveBeenCalledOnce();
    expect(mocked.hold).toHaveBeenCalledWith(
      expect.objectContaining({ meter: "creation", action: "creation:image_post", amount: 2 }),
    );
    expect(mocked.saveLink).toHaveBeenCalledWith(
      expect.objectContaining({ meter: "creation", amount: 2 }),
    );
  });
  it("never switches to wallet credits when the point reservation is refused", async () => {
    mocked.hold.mockRejectedValue(
      new InsufficientBalanceError({
        meter: "creation",
        needed: 2,
        available: 0,
        options: ["wallet_credits"],
      }),
    );
    expect((await POST(request())).status).toBe(402);
    expect(mocked.hold).toHaveBeenCalledOnce();
    expect(mocked.hold).toHaveBeenCalledWith(expect.objectContaining({ meter: "creation" }));
    expect(mocked.createJob).not.toHaveBeenCalled();
  });
  it("links an included caption edit durably without another money reservation", async () => {
    const response = await POST(
      request({
        parentJobId: "00000000-0000-4000-8000-000000000003",
        includedCaptionEdit: true,
        refine: { target: "captions", instruction: "Shorten the existing caption" },
      }),
    );
    expect(response.status).toBe(200);
    expect(mocked.claim).toHaveBeenCalledOnce();
    expect(mocked.hold).not.toHaveBeenCalled();
    expect(mocked.saveLink).toHaveBeenCalledWith(
      expect.objectContaining({ meter: "creation", amount: 0, caption_edit_id: "edit-1" }),
    );
  });
  it("never silently charges after another tab consumes the last included edit", async () => {
    mocked.claim.mockResolvedValue(null);
    expect(
      (
        await POST(
          request({
            parentJobId: "00000000-0000-4000-8000-000000000003",
            includedCaptionEdit: true,
            refine: { target: "captions", instruction: "Shorten the caption" },
          }),
        )
      ).status,
    ).toBe(409);
    expect(mocked.hold).not.toHaveBeenCalled();
    expect(mocked.createJob).not.toHaveBeenCalled();
  });
  it("rejects using an included-caption claim to remake artwork", async () => {
    expect(
      (
        await POST(
          request({
            parentJobId: "00000000-0000-4000-8000-000000000003",
            includedCaptionEdit: true,
            refine: { target: "media", instruction: "Remake the photo" },
          }),
        )
      ).status,
    ).toBe(400);
    expect(mocked.hold).not.toHaveBeenCalled();
  });
});

describe("Studio billing shadow path", () => {
  it("links an inline job before execution and settles it through the durable billing path", async () => {
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
    expect(mocked.saveLink).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: "account-1",
        action: "post_set",
        meter: "credits",
        amount: 12,
        shadow_decision: "would_charge",
      }),
    );
    expect(mocked.hold).not.toHaveBeenCalled();
    expect(mocked.settle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "job-1", status: "succeeded" }),
    );
  });
});

describe("Studio async billing", () => {
  it.each(["image", "video"])(
    "reserves only text credits for a %s caption revision",
    async (type) => {
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
            type,
            idempotencyKey: "caption-revision-001",
            parentJobId: "00000000-0000-4000-8000-000000000003",
            intent: { brief: "The original product post" },
            controls: { platforms: ["instagram"] },
            refine: { instruction: "Make the caption shorter", target: "captions" },
          }),
        }),
      );
      expect(response.status).toBe(200);
      expect(mocked.hold).toHaveBeenCalledWith(
        expect.objectContaining({ action: "post_regenerate", meter: "credits", amount: 4 }),
      );
      expect(mocked.saveLink).toHaveBeenCalledWith(
        expect.objectContaining({ action: "post_regenerate", amount: 4 }),
      );
    },
  );

  it("releases a new reservation if the job was already created by another request", async () => {
    mocked.createJob.mockResolvedValue({ id: "existing-job", status: "succeeded" });
    mocked.getEntitlements.mockResolvedValue({
      accountId: "account-1",
      enforcement: "on",
      role: "editor",
      frozen: false,
      features: { studio: { allowed: true, requiredPlan: "free" } },
      meters: { credits: { available: 100 } },
    });
    const response = await POST(
      new Request("http://localhost/api/studio/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: "00000000-0000-4000-8000-000000000002",
          type: "script",
          idempotencyKey: "same-job-request-001",
          intent: { brief: "The same requested script" },
          controls: {},
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(mocked.release).toHaveBeenCalledWith(expect.objectContaining({ holdId: "hold-1" }));
    expect(mocked.settle).not.toHaveBeenCalled();
  });
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

  describe("2 free videos a month, then credits", () => {
    const videoRequest = (controls: Record<string, unknown> = {}) =>
      new Request("http://localhost/api/studio/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: "00000000-0000-4000-8000-000000000002",
          type: "video",
          idempotencyKey: "video-click-001",
          intent: { brief: "A calm video of our new candle" },
          controls: {
            platforms: ["instagram"],
            videoModelKey: "standard",
            durationSec: 24,
            ...controls,
          },
        }),
      });
    const withVideos = (available: number) =>
      mocked.getEntitlements.mockResolvedValue({
        accountId: "account-1",
        enforcement: "on",
        role: "editor",
        frozen: false,
        entitledPlan: "starter",
        features: {
          studio: { allowed: true, requiredPlan: "free" },
          ugc: { allowed: true, requiredPlan: "starter" },
          video_1080p: { allowed: true, requiredPlan: "growth" },
        },
        meters: {
          credits: { available: 5_000 },
          video: { available },
          premium_video: { available: 0 },
        },
      });
    beforeEach(() => {
      vi.stubEnv("VIDEO_PROVIDER_STANDARD", "kie");
      // These cases price the render itself; the storyboard step before a
      // long video has its own case below.
      vi.stubEnv("FEATURE_FLAG_VIDEO_STORYBOARD_ENABLED", "false");
      mocked.createJob.mockImplementation(async ({ onCreated }) => {
        await onCreated({ id: "job-1", status: "running" });
        return { id: "job-1", status: "running" };
      });
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("storyboards a long video first, for the storyboard's credits, keeping the free video", async () => {
      vi.stubEnv("FEATURE_FLAG_VIDEO_STORYBOARD_ENABLED", "true");
      withVideos(200);
      expect((await POST(videoRequest())).status).toBe(200);
      expect(mocked.hold).toHaveBeenCalledOnce();
      expect(mocked.hold).toHaveBeenCalledWith(
        expect.objectContaining({ meter: "credits", action: "video_storyboard" }),
      );
    });

    it("uses one free video while one is left", async () => {
      withVideos(200);
      expect((await POST(videoRequest())).status).toBe(200);
      expect(mocked.hold).toHaveBeenCalledOnce();
      expect(mocked.hold).toHaveBeenCalledWith(
        expect.objectContaining({ meter: "video", amount: 100 }),
      );
    });

    it("takes credits when the free videos are used", async () => {
      withVideos(0);
      expect((await POST(videoRequest())).status).toBe(200);
      expect(mocked.hold).toHaveBeenCalledWith(expect.objectContaining({ meter: "credits" }));
    });

    it("asks a person to look again when the free video shown is gone", async () => {
      withVideos(0);
      const response = await POST(
        videoRequest({ videoQuote: { hash: "a".repeat(64), units: 100, meter: "video" } }),
      );
      expect(response.status).toBe(409);
      expect(mocked.hold).not.toHaveBeenCalled();
      expect(mocked.createJob).not.toHaveBeenCalled();
    });

    it("charges credits when the last free video goes between the quote and the hold", async () => {
      withVideos(100);
      mocked.hold.mockImplementation(async (args: { meter: string }) => {
        if (args.meter === "video")
          throw new InsufficientBalanceError({
            meter: "video",
            needed: 100,
            available: 0,
            options: ["upgrade"],
          });
        return { ok: true, id: "hold-2" };
      });
      expect((await POST(videoRequest())).status).toBe(200);
      expect(mocked.hold).toHaveBeenCalledTimes(2);
      expect(mocked.hold).toHaveBeenLastCalledWith(expect.objectContaining({ meter: "credits" }));
      expect(mocked.saveLink).toHaveBeenCalledWith(
        expect.objectContaining({ meter: "credits", hold_id: "hold-2" }),
      );
    });
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
