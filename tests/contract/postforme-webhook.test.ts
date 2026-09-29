import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listAccountsHandler: vi.fn(),
  syncPostHandler: vi.fn(),
}));

vi.mock("@/lib/postforme/client.server", () => ({
  createPostForMeAdapter: () => vi.fn(),
}));
vi.mock("@/lib/postforme/handlers", () => ({
  listAccountsHandler: mocks.listAccountsHandler,
  syncPostHandler: mocks.syncPostHandler,
}));
vi.mock("@/lib/postforme/workspace.server", () => ({
  postForMeDb: {},
  getPostForMeDeps: () => ({}),
}));

import { POST } from "@/app/api/public/hooks/postforme/route";

const workspaceId = "3b7837c5-9532-47e1-9afe-2cea3dc2bbab";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.POST_FOR_ME_WEBHOOK_SECRET = "test-webhook-secret";
});
afterEach(() => {
  delete process.env.POST_FOR_ME_WEBHOOK_SECRET;
});

describe("Post for Me webhook", () => {
  it("rejects a request without the project secret", async () => {
    const response = await POST(
      new Request("https://mellox.ai/api/public/hooks/postforme", {
        method: "POST",
        body: JSON.stringify({
          event_type: "social.account.created",
          data: { external_id: workspaceId },
        }),
      }),
    );
    expect(response.status).toBe(401);
    expect(mocks.listAccountsHandler).not.toHaveBeenCalled();
  });

  it("syncs an account event scoped to its workspace", async () => {
    const response = await POST(
      new Request("https://mellox.ai/api/public/hooks/postforme", {
        method: "POST",
        headers: { "Post-For-Me-Webhook-Secret": "test-webhook-secret" },
        body: JSON.stringify({
          event_type: "social.account.created",
          data: { external_id: workspaceId },
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.listAccountsHandler).toHaveBeenCalledWith(workspaceId, expect.anything());
  });
});
