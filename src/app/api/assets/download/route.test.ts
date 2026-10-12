import { beforeEach, describe, expect, it, vi } from "vitest";
const workspace = "00000000-0000-4000-8000-000000000001";
const outsider = "00000000-0000-4000-8000-000000000002";
const mocks = vi.hoisted(() => ({ sign: vi.fn(), authenticated: true }));
vi.mock("@/server/api-auth", () => ({
  requireUserId: async () =>
    mocks.authenticated
      ? { ok: true, userId: "user", supabase: {} }
      : { ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) },
  checkWorkspaceMembership: async (_auth: unknown, id: string) =>
    id.endsWith("1")
      ? { ok: true, workspaceId: id, role: "viewer" }
      : { ok: false, response: Response.json({ error: "Forbidden" }, { status: 403 }) },
  jsonError: (status: number, error: string) => Response.json({ error }, { status }),
  UUID_RE: /^[0-9a-f-]{36}$/i,
}));
vi.mock("@/server/assets/storage.server", () => ({ signStoragePath: mocks.sign }));
import { POST } from "./route";

const request = (body: unknown) =>
  POST(
    new Request("https://mellox.ai/api/assets/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticated = true;
  mocks.sign.mockResolvedValue("https://r2.example/attachment");
});
describe("private asset downloads", () => {
  it("authorizes viewer downloads and signs a short-lived attachment", async () => {
    const path = `workspace/${workspace}/assets/r2/asset/original.mp4`;
    const response = await request({ workspaceId: workspace, path, filename: 'video"\r\n.mp4' });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.sign).toHaveBeenCalledWith({}, path, 300, "video___.mp4");
  });
  it("rejects forged workspace paths and traversal before using R2 credentials", async () => {
    for (const path of [
      `workspace/${outsider}/assets/r2/a/file.mp4`,
      `workspace/${workspace}/assets/../file.mp4`,
    ]) {
      expect((await request({ workspaceId: workspace, path, filename: "file.mp4" })).status).toBe(
        403,
      );
    }
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("rejects anonymous users and nonmembers", async () => {
    const body = {
      workspaceId: outsider,
      path: `workspace/${outsider}/assets/r2/a/file.mp4`,
      filename: "file.mp4",
    };
    expect((await request(body)).status).toBe(403);
    mocks.authenticated = false;
    expect((await request(body)).status).toBe(401);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
});
