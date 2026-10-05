import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkWorkspaceMembership, requireUserId } from "@/server/api-auth";
import { startNotionOAuth } from "@/server/connectors/notion/oauth.server";

vi.mock("@/server/api-auth", () => ({
  requireUserId: vi.fn(),
  checkWorkspaceMembership: vi.fn(),
}));
vi.mock("@/server/connectors/notion/oauth.server", () => ({
  startNotionOAuth: vi.fn(),
}));

import { GET } from "./route";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const request = () =>
  new Request(`https://mellox.ai/api/integrations/notion/connect?workspaceId=${workspaceId}`);

beforeEach(() => vi.clearAllMocks());

describe("Notion OAuth connect route", () => {
  it("rejects unauthenticated callers before touching the workspace", async () => {
    vi.mocked(requireUserId).mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });
    expect((await GET(request())).status).toBe(401);
    expect(checkWorkspaceMembership).not.toHaveBeenCalled();
    expect(startNotionOAuth).not.toHaveBeenCalled();
  });

  it("requires editor access to the verified workspace", async () => {
    vi.mocked(requireUserId).mockResolvedValue({ ok: true, userId: "user-one" } as never);
    vi.mocked(checkWorkspaceMembership).mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 403 }),
    });
    expect((await GET(request())).status).toBe(403);
    expect(checkWorkspaceMembership).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-one" }),
      workspaceId,
      { minRole: "editor" },
    );
    expect(startNotionOAuth).not.toHaveBeenCalled();
  });

  it("starts OAuth for the authorized workspace", async () => {
    vi.mocked(requireUserId).mockResolvedValue({ ok: true, userId: "user-one" } as never);
    vi.mocked(checkWorkspaceMembership).mockResolvedValue({
      ok: true,
      workspaceId,
      role: "editor",
    });
    vi.mocked(startNotionOAuth).mockResolvedValue("https://api.notion.com/v1/oauth/authorize");
    const response = await GET(request());
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://api.notion.com/v1/oauth/authorize");
    expect(startNotionOAuth).toHaveBeenCalledWith("user-one", workspaceId);
  });
});
