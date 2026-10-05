import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { completeNotionOAuth } from "@/server/connectors/notion/service.server";

const cookieGet = vi.hoisted(() => vi.fn());
vi.mock("@/server/connectors/notion/service.server", () => ({
  completeNotionOAuth: vi.fn().mockRejectedValue(new Error("invalid state")),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ get: cookieGet, set: vi.fn() }),
}));

import { GET } from "./route";

describe("Notion OAuth callback redirects", () => {
  it("uses the browser origin for cancelled and invalid callbacks", async () => {
    const cancelled = await GET(
      new Request("http://0.0.0.0:8080/api/integrations/notion/callback?error=access_denied"),
    );
    expect(cancelled.status).toBe(302);
    expect(cancelled.headers.get("location")).toBe("/integrations/notion/result?status=cancelled");

    const failed = await GET(
      new Request("http://0.0.0.0:8080/api/integrations/notion/callback?state=abc&code=def"),
    );
    expect(failed.status).toBe(302);
    expect(failed.headers.get("location")).toBe("/integrations/notion/result?status=failed");
    expect(completeNotionOAuth).not.toHaveBeenCalled();
  });

  it("completes only with the initiating browser state", async () => {
    const state = "s".repeat(64);
    cookieGet.mockReturnValue({ value: createHash("sha256").update(state).digest("hex") });
    vi.mocked(completeNotionOAuth).mockResolvedValueOnce({
      workspaceId: "11111111-1111-4111-8111-111111111111",
    } as never);
    const response = await GET(
      new Request(`https://mellox.ai/api/integrations/notion/callback?state=${state}&code=code`),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain(
      "/w/11111111-1111-4111-8111-111111111111/app",
    );
    expect(completeNotionOAuth).toHaveBeenCalledWith({ state, code: "code" });
  });
});
