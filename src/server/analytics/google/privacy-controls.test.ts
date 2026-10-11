import { beforeEach, describe, expect, it, vi } from "vitest";
import { GOOGLE_DISCLOSURE_VERSION } from "@/marketing/lib/google-disclosure";
import { requireGoogleAiConsent } from "./consent.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
const state = vi.hoisted(() => ({
  connections: [{ id: "conn-1" }],
  fail: "",
  operations: [] as Array<{
    table: string;
    op: string;
    filters: Array<[string, unknown]>;
    value?: unknown;
  }>,
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const operation = {
        table,
        op: "",
        filters: [] as Array<[string, unknown]>,
        value: undefined as unknown,
      };
      const chain = {
        select: () => {
          operation.op = "select";
          return chain;
        },
        delete: () => {
          operation.op = "delete";
          return chain;
        },
        update: (value: unknown) => {
          operation.op = "update";
          operation.value = value;
          return chain;
        },
        eq: (key: string, value: unknown) => {
          operation.filters.push([key, value]);
          return chain;
        },
        neq: (key: string, value: unknown) => {
          operation.filters.push([key, value]);
          return chain;
        },
        then: (resolve: (value: unknown) => unknown) => {
          state.operations.push(operation);
          return Promise.resolve(
            resolve({
              data: operation.op === "select" ? state.connections : null,
              error:
                state.fail === table && operation.op !== "select"
                  ? { message: "deletion failed" }
                  : null,
            }),
          );
        },
      };
      return chain;
    },
  },
}));
vi.mock("./tokens.server", () => ({
  readRefreshToken: vi.fn(async () => "encrypted-token-fixture"),
  deleteCredentials: vi.fn(async () => {}),
}));
vi.mock("./oauth.server", () => ({ revokeToken: vi.fn(async () => false) }));
vi.mock("@/server/audit.server", () => ({ recordAudit: vi.fn(async () => {}) }));
import { disconnect, removeSource } from "./service.server";
import { deleteCredentials } from "./tokens.server";
import { recordAudit } from "@/server/audit.server";
beforeEach(() => {
  state.operations = [];
  state.fail = "";
  state.connections = [{ id: "conn-1" }];
  vi.clearAllMocks();
});
describe("Google disconnection and deletion", () => {
  it("deletes credentials, workspace-scoped sources and insights even when external revocation fails", async () => {
    expect(await disconnect({ workspaceId: "ws-1", userId: "user-1" })).toEqual({
      disconnected: true,
      googleRevoked: false,
    });
    expect(deleteCredentials).toHaveBeenCalledWith("conn-1");
    const deletions = state.operations.filter((op) => op.op === "delete");
    expect(deletions.map((op) => op.table)).toEqual(["analytics_sources", "analytics_insights"]);
    for (const op of deletions) expect(op.filters).toContainEqual(["workspace_id", "ws-1"]);
    expect(state.operations.find((op) => op.op === "update")?.value).toMatchObject({
      status: "revoked",
      metadata: {},
      permissions: {},
    });
  });
  it.each(["analytics_sources", "analytics_insights", "workspace_connections"])(
    "surfaces failure of %s instead of claiming deletion succeeded",
    async (table) => {
      state.fail = table;
      await expect(disconnect({ workspaceId: "ws-1", userId: "user-1" })).rejects.toThrow(
        "deletion failed",
      );
      expect(recordAudit).not.toHaveBeenCalled();
    },
  );
  it("retries insights cleanup even if no active connection remains", async () => {
    state.connections = [];
    await disconnect({ workspaceId: "ws-1", userId: "user-1" });
    expect(
      state.operations.some((op) => op.table === "analytics_insights" && op.op === "delete"),
    ).toBe(true);
  });
  it("does not conceal failed insight removal when a source is removed", async () => {
    state.fail = "analytics_insights";
    await expect(
      removeSource({ workspaceId: "ws-1", userId: "user-1", kind: "gsc_site" }),
    ).rejects.toThrow("deletion failed");
  });
});
function dbWith(metadata: unknown, error: unknown = null) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    neq: () => Promise.resolve({ data: [{ id: "conn", metadata }], error }),
  };
  return { from: () => chain } as unknown as SupabaseClient<Database>;
}
describe("Google AI consent", () => {
  it("requires renewed consent on a legacy grant", async () => {
    await expect(requireGoogleAiConsent(dbWith({}), "ws")).rejects.toMatchObject({ status: 409 });
  });
  it("accepts only the current disclosure and affirmative AI consent", async () => {
    await expect(
      requireGoogleAiConsent(
        dbWith({ disclosureVersion: GOOGLE_DISCLOSURE_VERSION, aiProcessing: true }),
        "ws",
      ),
    ).resolves.toBe("conn");
    await expect(
      requireGoogleAiConsent(
        dbWith({ disclosureVersion: GOOGLE_DISCLOSURE_VERSION, aiProcessing: false }),
        "ws",
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("fails closed on a database error", async () => {
    await expect(requireGoogleAiConsent(dbWith({}, { message: "offline" }), "ws")).rejects.toThrow(
      "offline",
    );
  });
});
