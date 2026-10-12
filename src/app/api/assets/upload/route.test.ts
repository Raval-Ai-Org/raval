import { beforeEach, describe, expect, it, vi } from "vitest";

const workspace = "00000000-0000-4000-8000-000000000001";
const mocks = vi.hoisted(() => ({ persist: vi.fn(), authenticated: true, role: "editor" }));
vi.mock("@/server/api-auth", () => ({
  requireUserId: async () =>
    mocks.authenticated
      ? { ok: true, userId: "user", supabase: {} }
      : { ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) },
  checkWorkspaceMembership: async (_auth: unknown, id: string, opts: { minRole?: string }) =>
    id.endsWith("1") && (opts.minRole !== "editor" || mocks.role !== "viewer")
      ? { ok: true, workspaceId: id, role: mocks.role }
      : { ok: false, response: Response.json({ error: "Forbidden" }, { status: 403 }) },
  jsonError: (status: number, error: string) => Response.json({ error }, { status }),
  UUID_RE: /^[0-9a-f-]{36}$/i,
}));
vi.mock("@/server/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  RateLimitedError: class extends Error {},
}));
vi.mock("@/server/assets/persist.server", () => ({
  MAX_ASSET_BYTES: 16,
  persistAsset: mocks.persist,
}));
import { POST } from "./route";

function request(body: Uint8Array, length?: number) {
  return POST(
    new Request(
      `https://mellox.ai/api/assets/upload?workspaceId=${workspace}&requestId=${workspace}&filename=file.png`,
      {
        method: "POST",
        headers: {
          "Content-Type": "image/png",
          ...(length === undefined ? {} : { "Content-Length": String(length) }),
        },
        body: new Uint8Array(body),
      },
    ),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticated = true;
  mocks.role = "editor";
  mocks.persist.mockResolvedValue({
    ok: true,
    asset: { storage_path: `workspace/${workspace}/assets/r2/a/file.png` },
  });
});
describe("secure bounded upload endpoint", () => {
  it("rejects anonymous and viewer writes before persistence", async () => {
    mocks.authenticated = false;
    expect((await request(new Uint8Array())).status).toBe(401);
    mocks.authenticated = true;
    mocks.role = "viewer";
    expect((await request(new Uint8Array())).status).toBe(403);
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it("enforces declared and actual body limits and media signatures", async () => {
    expect((await request(new Uint8Array(1), 17)).status).toBe(413);
    expect((await request(new Uint8Array(17))).status).toBe(413);
    expect((await request(Buffer.from("<html>"))).status).toBe(415);
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it("uses workspace-scoped idempotent persistence and prevents response caching", async () => {
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const response = await request(bytes);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: workspace,
        idempotencyKey: `upload:${workspace}`,
        bytes,
        assetType: "image",
      }),
    );
  });
});
