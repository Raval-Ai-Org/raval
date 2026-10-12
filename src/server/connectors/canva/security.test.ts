import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptWithKey } from "@/server/crypto/secret-box.server";
import { canvaAccessToken, completeCanvaOAuth, disconnectCanva } from "./service.server";
import { consumeCanvaState, hashState } from "./oauth.server";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  tokenGrant: vi.fn(),
  identity: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: mocks.from, rpc: mocks.rpc },
}));
vi.mock("@/server/audit.server", () => ({ recordAudit: vi.fn() }));
vi.mock("./api.server", async (original) => ({
  ...(await original<typeof import("./api.server")>()),
  tokenGrant: mocks.tokenGrant,
  getCanvaIdentity: mocks.identity,
  revokeCanvaToken: mocks.revoke,
}));

type Row = Record<string, unknown>;
const key = Buffer.alloc(32, 9);
const workspaceId = "workspace-a";
const state = "s".repeat(64);
let tables: Record<string, Row[]>;
let failedOperation: string | undefined;

// Execute the real service queries, including conditional writes and workspace filters.
function query(table: string) {
  let operation = "select";
  let values: Row = {};
  const filters: Array<(row: Row) => boolean> = [];
  const run = () => {
    if (`${table}:${operation}` === failedOperation)
      return { data: null, error: { message: "unavailable" } };
    const rows = (tables[table] ?? []).filter((row) => filters.every((test) => test(row)));
    if (operation === "delete")
      tables[table] = (tables[table] ?? []).filter((row) => !rows.includes(row));
    if (operation === "update") rows.forEach((row) => Object.assign(row, values));
    return { data: rows, error: null };
  };
  const chain = {
    select: () => chain,
    order: () => chain,
    limit: () => chain,
    eq: (column: string, value: unknown) => {
      filters.push((row) => row[column] === value);
      return chain;
    },
    neq: (column: string, value: unknown) => {
      filters.push((row) => row[column] !== value);
      return chain;
    },
    is: (column: string, value: unknown) => {
      filters.push((row) => row[column] === value);
      return chain;
    },
    gt: (column: string, value: string) => {
      filters.push((row) => String(row[column]) > value);
      return chain;
    },
    update: (input: Row) => {
      operation = "update";
      values = input;
      return chain;
    },
    delete: () => {
      operation = "delete";
      return chain;
    },
    maybeSingle: async () => {
      const result = run();
      return { ...result, data: result.data?.[0] ?? null };
    },
    then: (resolve: (result: ReturnType<typeof run>) => unknown) =>
      Promise.resolve(run()).then(resolve),
  };
  return chain;
}

beforeEach(() => {
  vi.stubEnv("CANVA_CLIENT_ID", "test-client");
  vi.stubEnv("CANVA_CLIENT_SECRET", "test-secret");
  vi.stubEnv("CANVA_TOKEN_ENCRYPTION_KEY", key.toString("base64"));
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubEnv("APP_URL", "https://mellox.ai");
  failedOperation = undefined;
  tables = {
    workspace_connections: [
      { id: "connection-a", workspace_id: workspaceId, provider: "canva", status: "active" },
    ],
    canva_oauth_credentials: [
      {
        connection_id: "connection-a",
        workspace_id: workspaceId,
        access_token_enc: encryptWithKey("access", key),
        refresh_token_enc: encryptWithKey("refresh", key),
        access_token_expires_at: new Date(0).toISOString(),
      },
    ],
    connector_install_states: [
      {
        id: "state-a",
        provider: "canva",
        workspace_id: workspaceId,
        user_id: "user-a",
        state_hash: hashState(state),
        consumed_at: null,
        pkce_verifier_enc: encryptWithKey("v".repeat(64), key),
        expires_at: new Date(Date.now() + 600_000).toISOString(),
      },
    ],
  };
  mocks.from.mockImplementation(query);
  mocks.rpc.mockImplementation(async (name: string, args: Row) => {
    if (failedOperation) return { data: null, error: { message: "unavailable" } };
    if (name === "withdraw_canva_authorization") {
      const credentials = tables.canva_oauth_credentials.filter(
        (row) => row.workspace_id === args.p_workspace_id,
      );
      tables.canva_oauth_credentials = tables.canva_oauth_credentials.filter(
        (row) => row.workspace_id !== args.p_workspace_id,
      );
      tables.connector_install_states = tables.connector_install_states.filter(
        (row) => row.workspace_id !== args.p_workspace_id,
      );
      tables.workspace_connections.forEach((row) => {
        if (row.workspace_id === args.p_workspace_id) row.status = "revoked";
      });
      return { data: credentials, error: null };
    }
    const connected = tables.workspace_connections.find(
      (row) => row.id === args.p_connection_id && row.status === "active",
    );
    const credential = tables.canva_oauth_credentials.find(
      (row) =>
        row.connection_id === args.p_connection_id &&
        row.refresh_token_enc === args.p_previous_refresh_token_enc,
    );
    if (!connected || !credential) return { data: false, error: null };
    Object.assign(credential, {
      access_token_enc: args.p_access_token_enc,
      refresh_token_enc: args.p_refresh_token_enc,
      access_token_expires_at: args.p_expires_at,
    });
    return { data: true, error: null };
  });
  mocks.revoke.mockResolvedValue(true);
  mocks.identity.mockResolvedValue({ user_id: "canva-user", team_id: "canva-team" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("Canva authorization and withdrawal", () => {
  it("does not exchange a code after workspace permission is denied", async () => {
    await expect(
      completeCanvaOAuth({
        state,
        code: "code",
        userId: "user-a",
        authorize: async () => {
          throw new Error("not authorized");
        },
      }),
    ).rejects.toThrow("not authorized");
    expect(mocks.tokenGrant).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("attempts remote revocation if atomic credential installation fails", async () => {
    mocks.tokenGrant.mockResolvedValue({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 3600,
    });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "withdrawn" } });
    await expect(
      completeCanvaOAuth({
        state,
        code: "code",
        userId: "user-a",
        authorize: async () => undefined,
      }),
    ).rejects.toThrow(/withdrawn/);
    expect(mocks.revoke).toHaveBeenCalledWith("new-refresh");
    expect(mocks.rpc).toHaveBeenCalledWith(
      "save_canva_authorization",
      expect.objectContaining({
        p_state_id: "state-a",
        p_workspace_id: workspaceId,
        p_user_id: "user-a",
      }),
    );
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain('"new-access"');
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain('"new-refresh"');
  });
  it("rejects another user, then consumes state only once and clears the encrypted verifier", async () => {
    await expect(consumeCanvaState(state, "other-user")).rejects.toThrow(/expired/);
    await expect(consumeCanvaState(state, "user-a")).resolves.toMatchObject({
      workspaceId,
      verifier: "v".repeat(64),
    });
    expect(tables.connector_install_states[0].pkce_verifier_enc).toBeNull();
    await expect(consumeCanvaState(state, "user-a")).rejects.toThrow(/expired/);
  });

  it("fails closed when reading OAuth state fails", async () => {
    failedOperation = "connector_install_states:select";
    await expect(consumeCanvaState(state, "user-a")).rejects.toThrow(/unavailable/);
    expect(tables.connector_install_states[0].consumed_at).toBeNull();
  });

  it("withdraws local credentials and pending authorization even when Canva revocation fails", async () => {
    tables.canva_oauth_credentials.push({
      workspace_id: "other-workspace",
      refresh_token_enc: "other",
    });
    mocks.revoke.mockResolvedValue(false);
    await expect(disconnectCanva(workspaceId, "user-a")).resolves.toEqual({
      disconnected: true,
      revocationConfirmed: false,
    });
    expect(tables.canva_oauth_credentials).toEqual([
      { workspace_id: "other-workspace", refresh_token_enc: "other" },
    ]);
    expect(tables.connector_install_states).toHaveLength(0);
    expect(tables.workspace_connections[0].status).toBe("revoked");
    await expect(canvaAccessToken(workspaceId)).rejects.toThrow(/Connect Canva/);
  });

  it("reports withdrawal failures without partially removing authorization and can retry", async () => {
    failedOperation = "canva_oauth_credentials:delete";
    await expect(disconnectCanva(workspaceId, "user-a")).rejects.toThrow(
      /remove Canva authorization/,
    );
    expect(tables.workspace_connections[0].status).toBe("active");
    expect(tables.canva_oauth_credentials).toHaveLength(1);
    failedOperation = undefined;
    await expect(disconnectCanva(workspaceId, "user-a")).resolves.toMatchObject({
      revocationConfirmed: true,
    });
    expect(tables.canva_oauth_credentials).toHaveLength(0);
  });

  it("does not return or restore a token refreshed while the workspace disconnects", async () => {
    let finish!: (tokens: {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    }) => void;
    mocks.tokenGrant.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = canvaAccessToken(workspaceId);
    const rejection = expect(pending).rejects.toThrow(/disconnected/i);
    await vi.waitFor(() => expect(mocks.tokenGrant).toHaveBeenCalled());
    await disconnectCanva(workspaceId, "user-a");
    finish({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 });
    await rejection;
    expect(tables.canva_oauth_credentials).toHaveLength(0);
    expect(tables.workspace_connections[0].status).toBe("revoked");
    expect(mocks.revoke).toHaveBeenCalledWith("new-refresh");
  });

  it("does not mark a connection disconnected when its state or status update fails", async () => {
    for (const failure of ["connector_install_states:delete", "workspace_connections:update"]) {
      failedOperation = failure;
      await expect(disconnectCanva(workspaceId, "user-a")).rejects.toThrow();
      expect(tables.canva_oauth_credentials).toHaveLength(1);
      expect(tables.workspace_connections[0].status).toBe("active");
    }
  });
});
