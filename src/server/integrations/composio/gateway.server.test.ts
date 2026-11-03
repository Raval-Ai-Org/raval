import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ComposioGatewayError,
  classifyFailure,
  createLink,
  deleteAccount,
  executeTool,
  setComposioTransport,
  toAccount,
  type ComposioRequest,
} from "./gateway.server";

let requests: ComposioRequest[] = [];

function reply(map: (req: ComposioRequest) => { status: number; json: unknown }) {
  setComposioTransport(async (req) => {
    requests.push(req);
    return map(req);
  });
}

beforeEach(() => {
  requests = [];
  process.env.COMPOSIO_API_KEY = "test-key";
  process.env.COMPOSIO_AUTH_CONFIG_INSTAGRAM = "ac_pinned";
});
afterEach(() => {
  setComposioTransport(null);
  delete process.env.COMPOSIO_AUTH_CONFIG_INSTAGRAM;
});

describe("classifyFailure", () => {
  it("separates Mellox's key from a person's connection", () => {
    const key = classifyFailure(
      401,
      { error: { slug: "APIKey_InvalidAPIKey", message: "bad" } },
      false,
    );
    expect(key.kind).toBe("auth");
    const account = classifyFailure(
      400,
      { error: { slug: "ConnectedAccount_Expired", message: "x" } },
      false,
    );
    expect(account.kind).toBe("account_auth");
  });

  it("never calls a failed write a plain failure", () => {
    expect(classifyFailure(500, null, true).kind).toBe("unknown_outcome");
    expect(classifyFailure(500, null, false).kind).toBe("provider_error");
  });

  it("maps the usual statuses", () => {
    expect(classifyFailure(404, null, false).kind).toBe("not_found");
    expect(classifyFailure(429, null, true).kind).toBe("rate_limited");
    expect(classifyFailure(422, null, false).kind).toBe("invalid_request");
  });
});

describe("gateway calls", () => {
  it("uses the pinned auth config and returns the new account id", async () => {
    reply(() => ({
      status: 201,
      json: {
        redirect_url: "https://connect.example/x",
        connected_account_id: "ca_1",
        expires_at: null,
      },
    }));
    const link = await createLink({
      toolkit: "instagram",
      userId: "mellox_ws_1",
      callbackUrl: "https://app/cb",
    });
    expect(link).toMatchObject({ connectedAccountId: "ca_1", authConfigId: "ac_pinned" });
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toEqual({
      auth_config_id: "ac_pinned",
      user_id: "mellox_ws_1",
      callback_url: "https://app/cb",
    });
  });

  it("treats a missing account as already removed", async () => {
    reply(() => ({ status: 404, json: { error: { slug: "NotFound", message: "gone" } } }));
    await expect(deleteAccount("ca_9")).resolves.toBeUndefined();
    expect(requests[0]).toMatchObject({ method: "DELETE", write: true });
  });

  it("marks tool writes and turns an expired grant into a reconnect", async () => {
    reply(() => ({
      status: 200,
      json: {
        successful: false,
        data: {},
        error: "Error validating access token: token has expired",
        log_id: "l1",
      },
    }));
    const run = executeTool({
      tool: "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH",
      userId: "mellox_ws_1",
      connectedAccountId: "ca_1",
      arguments: {},
      write: true,
    });
    await expect(run).rejects.toBeInstanceOf(ComposioGatewayError);
    await expect(run).rejects.toMatchObject({ kind: "account_auth" });
    expect(requests[0]).toMatchObject({
      write: true,
      path: "/tools/execute/INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH",
    });
  });

  it("returns a tool's own failure without throwing", async () => {
    reply(() => ({
      status: 200,
      json: { successful: false, data: {}, error: "Media is too large", log_id: "l2" },
    }));
    const result = await executeTool({
      tool: "INSTAGRAM_GET_USER_INFO",
      userId: "u",
      connectedAccountId: "ca_1",
      arguments: {},
      write: false,
    });
    expect(result).toMatchObject({ successful: false, error: "Media is too large", logId: "l2" });
  });

  it("refuses to run without a key", async () => {
    delete process.env.COMPOSIO_API_KEY;
    setComposioTransport(null);
    await expect(
      executeTool({ tool: "X", userId: "u", connectedAccountId: "c", arguments: {}, write: false }),
    ).rejects.toMatchObject({ kind: "missing_config" });
  });
});

describe("toAccount", () => {
  it("normalises Composio's account shape", () => {
    expect(
      toAccount({
        id: "ca_1",
        status: "active",
        toolkit: { slug: "Instagram" },
        auth_config: { id: "ac_1" },
        word_id: "instagram_frost",
      }),
    ).toMatchObject({
      id: "ca_1",
      status: "ACTIVE",
      toolkit: "instagram",
      authConfigId: "ac_1",
      wordId: "instagram_frost",
    });
  });
});
