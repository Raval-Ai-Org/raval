import { beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  installations: [] as Record<string, unknown>[],
  mappings: [] as Record<string, unknown>[],
  links: [] as Record<string, unknown>[],
  members: [] as Record<string, unknown>[],
  calls: [] as string[],
}));
vi.mock("@/lib/feature-flags", () => ({ isSlackEnabled: () => true }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (name: string) => {
      fixtures.calls.push(name);
      const data =
        name === "slack_installations"
          ? fixtures.installations
          : name === "slack_channel_mappings"
            ? fixtures.mappings
            : name === "slack_user_links"
              ? fixtures.links
              : name === "workspace_members"
                ? fixtures.members
                : [{ name: "Client brand" }];
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "neq", "order", "limit", "in"])
        query[method] = () => query;
      query.then = (resolve: (v: unknown) => void) => resolve({ data, error: null });
      query.maybeSingle = async () => ({ data: data[0] ?? null, error: null });
      return query;
    },
  },
}));
import { listSlackUserTargets, resolveSlackTarget } from "./inbound.server";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
beforeEach(() => {
  fixtures.installations = [
    { id: "I1", workspace_id: A, team_id: "T123", status: "active" },
    { id: "I2", workspace_id: B, team_id: "T123", status: "active" },
  ];
  fixtures.mappings = [];
  fixtures.links = [];
  fixtures.members = [];
  fixtures.calls = [];
});
describe("Slack workspace resolution", () => {
  it("resolves an explicitly mapped channel", async () => {
    fixtures.mappings = [{ installation_id: "I2", workspace_id: B }];
    expect(
      (await resolveSlackTarget({ teamId: "T123", channelId: "C123", slackUserId: "U123" }))
        ?.workspaceId,
    ).toBe(B);
  });
  it("never falls back to a linked user's workspace in an unmapped channel", async () => {
    fixtures.links = [{ installation_id: "I1", workspace_id: A }];
    expect(
      await resolveSlackTarget({ teamId: "T123", channelId: "C999", slackUserId: "U123" }),
    ).toBeNull();
    expect(fixtures.calls).not.toContain("slack_user_links");
  });
  it("refuses ambiguous mappings and ambiguous direct messages", async () => {
    fixtures.mappings = [
      { installation_id: "I1", workspace_id: A },
      { installation_id: "I2", workspace_id: B },
    ];
    expect(
      await resolveSlackTarget({ teamId: "T123", channelId: "C123", slackUserId: "U123" }),
    ).toBeNull();
    fixtures.links = [
      { installation_id: "I1", workspace_id: A },
      { installation_id: "I2", workspace_id: B },
    ];
    expect(await resolveSlackTarget({ teamId: "T123", slackUserId: "U123" })).toBeNull();
  });
  it("offers only linked client workspaces with current membership for the shortcut", async () => {
    fixtures.links = [
      { installation_id: "I1", workspace_id: A, mellox_user_id: "user" },
      { installation_id: "I2", workspace_id: B, mellox_user_id: "user" },
    ];
    fixtures.members = [{ role: "editor" }];
    const options = await listSlackUserTargets("T123", "U123");
    expect(options.map((x) => x.workspaceId)).toEqual([A, B]);
    expect(options[0].name).toBe("Client brand");
    fixtures.members = [];
    expect(await listSlackUserTargets("T123", "U123")).toEqual([]);
  });
});
