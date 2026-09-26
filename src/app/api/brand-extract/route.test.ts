import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  allowance: vi.fn(),
  remove: vi.fn(),
  extract: vi.fn(),
  begin: vi.fn(),
  capture: vi.fn(),
  release: vi.fn(),
}));

vi.mock("@/server/api-auth", () => ({
  requireUserId: async () => ({ ok: true, userId: "user-1", supabase: {} }),
  jsonError: (status: number, message: string) => Response.json({ error: message }, { status }),
  UUID_RE: /^[0-9a-f-]{36}$/i,
}));
vi.mock("@/server/rate-limit", () => ({
  enforceRateLimit: async () => null,
  RateLimitedError: class extends Error {},
  rateLimitResponse: () => Response.json({}, { status: 429 }),
}));
vi.mock("@/server/billing/accounts.server", () => ({
  paidTargetForUserRoute: async () => ({ role: "owner" }),
}));
vi.mock("@/server/billing/entitlements.server", () => ({
  getEntitlements: async () => ({
    accountId: "account-1",
    enforcement: "on",
    role: "owner",
    frozen: false,
  }),
}));
vi.mock("@/server/billing/metered.server", () => ({
  beginDeferredMetered: mocked.begin,
}));
vi.mock("@/lib/brand-extract.server", () => ({ runBrandExtraction: mocked.extract }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      insert: mocked.allowance,
      delete: () => ({
        eq: () => ({ eq: () => ({ eq: () => ({ eq: mocked.remove }) }) }),
      }),
    }),
  },
}));

import { POST } from "./route";

async function scan() {
  const response = await POST(
    new Request("http://localhost/api/brand-extract", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "scan-1" },
      body: JSON.stringify({ url: "https://example.com" }),
    }),
  );
  return { response, body: await response.text() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.allowance.mockResolvedValue({ error: null });
  mocked.begin.mockResolvedValue({ capture: mocked.capture, release: mocked.release });
  mocked.capture.mockResolvedValue(undefined);
  mocked.release.mockResolvedValue(undefined);
  mocked.remove.mockResolvedValue({ error: null });
  mocked.extract.mockImplementation(async (_url, send) => {
    send({ type: "result", data: { name: "Example" } });
  });
});

describe("Brand DNA billing", () => {
  it("makes the first scan free and charges a successful rescan before delivering its result", async () => {
    expect((await scan()).body).toContain('"type":"result"');
    expect(mocked.begin).not.toHaveBeenCalled();

    mocked.allowance.mockResolvedValue({ error: { code: "23505" } });
    const { body } = await scan();
    expect(mocked.begin).toHaveBeenCalledWith(
      expect.objectContaining({
        actionName: "brand_dna_rescan",
        amount: 125,
        workspaceId: undefined,
      }),
    );
    expect(mocked.capture).toHaveBeenCalledOnce();
    expect(body).toContain('"type":"result"');
  });

  it("releases a failed rescan without delivering a result", async () => {
    mocked.allowance.mockResolvedValue({ error: { code: "23505" } });
    mocked.extract.mockImplementation(async (_url, send) => {
      send({ type: "error", stage: "crawl", code: "website_unreadable", error: "No content" });
    });
    const { body } = await scan();
    expect(body).toContain("website_unreadable");
    expect(mocked.release).toHaveBeenCalledOnce();
    expect(mocked.capture).not.toHaveBeenCalled();
  });
});
