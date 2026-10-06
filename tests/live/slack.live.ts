// Opt-in read-only check against an installed Slack app and mapped channels.
// SLACK_LIVE_TEST_ENABLED=1 and SLACK_LIVE_WORKSPACE_ID are required.
import { describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // The host may inject environment variables directly.
}

const live =
  process.env.SLACK_LIVE_TEST_ENABLED === "1" &&
  /^[0-9a-f-]{36}$/i.test(process.env.SLACK_LIVE_WORKSPACE_ID ?? "") &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;

(live ? describe : describe.skip)("Mellox Slack installation (live)", () => {
  it("validates the active installation and mapped channels", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { slackApi, slackToken } = await import("@/server/slack/client.server");
    const workspaceId = process.env.SLACK_LIVE_WORKSPACE_ID!;
    const { data: installation, error } = await supabaseAdmin
      .from("slack_installations")
      .select("id,team_id,status")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .single();
    expect(error).toBeNull();
    expect(installation).toBeTruthy();
    const token = await slackToken(installation!.id, workspaceId);
    const auth = await slackApi<{ team_id?: string }>(token, "auth.test");
    expect(auth.team_id).toBe(installation!.team_id);
    const { data: mappings } = await supabaseAdmin
      .from("slack_channel_mappings")
      .select("channel_id")
      .eq("workspace_id", workspaceId);
    for (const mapping of mappings ?? []) {
      const channel = await slackApi<{ channel?: { id?: string } }>(token, "conversations.info", {
        channel: mapping.channel_id,
      });
      expect(channel.channel?.id).toBe(mapping.channel_id);
    }
  });
});
