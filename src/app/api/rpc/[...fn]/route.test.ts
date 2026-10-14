import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveServerFn = vi.hoisted(() => vi.fn());
const runWithRequest = vi.hoisted(() => vi.fn());
const setRequestScope = vi.hoisted(() => vi.fn());
const requireUserId = vi.hoisted(() => vi.fn());

vi.mock("@/server/fns", () => ({ resolveServerFn }));
vi.mock("@/server/request-context", () => ({ runWithRequest, setRequestScope }));
vi.mock("@/server/api-auth", async (original) => ({
  ...(await original<typeof import("@/server/api-auth")>()),
  requireUserId,
}));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/rpc/content/list", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data: body }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  runWithRequest.mockImplementation((_: Request, callback: () => unknown) => callback());
  requireUserId.mockResolvedValue({ ok: true });
});

describe("RPC transport", () => {
  it("rejects unsigned calls before reading or invoking a server function", async () => {
    const invoke = vi.fn();
    resolveServerFn.mockReturnValue({ invoke });
    requireUserId.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Authentication required" }, { status: 401 }),
    });
    const incoming = request(null);
    const response = await POST(incoming, { params: Promise.resolve({ fn: ["content", "list"] }) });
    expect(response.status).toBe(401);
    expect(incoming.bodyUsed).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });
  it("does not expose unexpected exception details", async () => {
    const failure = new Error("relation private_table does not exist");
    resolveServerFn.mockReturnValue({
      invoke: vi.fn().mockRejectedValue(failure),
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(request(null), {
      params: Promise.resolve({ fn: ["content", "list"] }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Request failed" });
    expect(errorSpy).toHaveBeenCalledWith("[rpc] content/list", failure);
    errorSpy.mockRestore();
  });
});
