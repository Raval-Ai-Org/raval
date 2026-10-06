import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const inbound = vi.hoisted(() => ({
  resolveSlackTarget: vi.fn(),
  enqueueSlackInbound: vi.fn(),
}));
vi.mock("@/server/slack/inbound.server", () => inbound);
import { POST } from "./route";

const secret = "test-signing-secret";
function request(body: unknown, { valid = true, age = 0 } = {}) {
  const raw = JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000) - age;
  const sig = createHmac("sha256", secret).update(`v0:${ts}:${raw}`).digest("hex");
  return new Request("https://mellox.ai/api/integrations/slack/events", {
    method: "POST",
    body: raw,
    headers: {
      "x-slack-request-timestamp": String(ts),
      "x-slack-signature": `v0=${valid ? sig : "0".repeat(64)}`,
    },
  });
}

beforeEach(() => {
  process.env.SLACK_CLIENT_ID = "test-client";
  process.env.SLACK_CLIENT_SECRET = "test-secret";
  process.env.SLACK_SIGNING_SECRET = secret;
  process.env.SLACK_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  inbound.resolveSlackTarget.mockReset();
  inbound.enqueueSlackInbound.mockReset();
});

describe("Slack Events API", () => {
  it("rejects invalid signatures and replayed timestamps before any state change", async () => {
    const body = { type: "url_verification", challenge: "verification" };
    expect((await POST(request(body, { valid: false }))).status).toBe(401);
    expect((await POST(request(body, { age: 301 }))).status).toBe(401);
    expect(inbound.resolveSlackTarget).not.toHaveBeenCalled();
    expect(inbound.enqueueSlackInbound).not.toHaveBeenCalled();
  });
  it("answers Slack URL verification only after signature validation", async () => {
    const response = await POST(request({ type: "url_verification", challenge: "verification" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ challenge: "verification" });
  });
  it("queues a mapped mention with the event id as its deduplication key", async () => {
    const target = {
      workspaceId: "00000000-0000-4000-8000-000000000001",
      installation: { id: "installation-1", workspace_id: "00000000-0000-4000-8000-000000000001" },
    };
    inbound.resolveSlackTarget.mockResolvedValue(target);
    const response = await POST(
      request({
        type: "event_callback",
        event_id: "Ev123",
        team_id: "T123",
        event: {
          type: "app_mention",
          channel: "C123",
          user: "U123",
          text: "<@BOT> brief",
          ts: "123.456",
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(inbound.enqueueSlackInbound).toHaveBeenCalledWith(
      target,
      "event:Ev123",
      "event",
      expect.objectContaining({ channel: "C123", user: "U123", text: "<@BOT> brief" }),
    );
  });
  it("ignores bot messages and unmapped client channels", async () => {
    inbound.resolveSlackTarget.mockResolvedValue(null);
    const body = {
      type: "event_callback",
      event_id: "Ev124",
      team_id: "T123",
      event: { type: "message", channel_type: "im", bot_id: "B123", user: "U123", text: "ignored" },
    };
    expect((await POST(request(body))).status).toBe(200);
    expect(inbound.resolveSlackTarget).not.toHaveBeenCalled();
    expect(inbound.enqueueSlackInbound).not.toHaveBeenCalled();
  });
});
