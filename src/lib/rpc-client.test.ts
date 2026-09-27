import { describe, expect, it, vi } from "vitest";
import type { ServerFn } from "@/server/server-fn";

const authedFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authed-fetch", () => ({ authedFetch }));

import { ServerFnError, serverFn } from "./rpc-client";

const list = serverFn<ServerFn<null, unknown>>("workspaces/listWorkspaces");

describe("RPC client errors", () => {
  it("shows the billing reason returned by the server", async () => {
    authedFetch.mockResolvedValueOnce(
      Response.json(
        { code: "limit_reached", message: "This plan limit has been reached." },
        { status: 402 },
      ),
    );
    await expect(list()).rejects.toMatchObject({
      status: 402,
      message: "This plan limit has been reached.",
    });
  });

  it("identifies a missing route even if Next returns HTML", async () => {
    authedFetch.mockResolvedValueOnce(new Response("<html>Not found</html>", { status: 404 }));
    await expect(list()).rejects.toEqual(new ServerFnError(404, "Request failed with status 404"));
  });
});
