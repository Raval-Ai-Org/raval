import "server-only";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptWithKey } from "@/server/crypto/secret-box.server";
import { slackConfig } from "./security.server";

export class SlackApiError extends Error {
  constructor(
    public code: string,
    public retryAfter: number | null = null,
  ) {
    super(code);
  }
}

export async function slackApi<T extends Record<string, unknown>>(
  token: string,
  method: string,
  body: Record<string, unknown> = {},
  timeoutMs = 8000,
): Promise<T> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (response.status === 429) {
    const n = Number(response.headers.get("retry-after"));
    throw new SlackApiError(
      "rate_limited",
      Number.isFinite(n) ? Math.min(Math.max(n, 1), 3600) : 60,
    );
  }
  if (!response.ok) throw new SlackApiError("slack_unavailable");
  const json = (await response.json()) as T & { ok?: boolean; error?: string };
  if (!json.ok) throw new SlackApiError(json.error ?? "slack_error");
  return json;
}

export async function slackToken(installationId: string, workspaceId: string) {
  const { data, error } = await supabaseAdmin
    .from("slack_installations" as never)
    .select("bot_token_enc,status")
    .eq("id", installationId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error || !data || (data as { status: string }).status !== "active")
    throw new SlackApiError("reconnect_needed");
  return decryptWithKey((data as { bot_token_enc: string }).bot_token_enc, slackConfig().key);
}

export async function markSlackError(installationId: string, workspaceId: string, error: unknown) {
  const code = error instanceof SlackApiError ? error.code : "network_error";
  const revoked = ["invalid_auth", "token_revoked", "account_inactive", "not_authed"].includes(
    code,
  );
  await supabaseAdmin
    .from("slack_installations" as never)
    .update({
      last_error: code.slice(0, 100),
      ...(revoked ? { status: "reconnect_needed" } : {}),
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", installationId)
    .eq("workspace_id", workspaceId);
}

/** A Slack error code in words a person can act on. */
export function slackErrorMessage(error: unknown): string {
  const code = error instanceof SlackApiError ? error.code : "network_error";
  if (["not_in_channel", "channel_not_found"].includes(code))
    return "Mellox isn't in that channel yet. In Slack, open the channel and type /invite @Mellox.";
  if (code === "is_archived") return "That channel is archived. Choose another one.";
  if (
    [
      "invalid_auth",
      "token_revoked",
      "account_inactive",
      "not_authed",
      "reconnect_needed",
    ].includes(code)
  )
    return "Slack needs to be connected again.";
  if (code === "missing_scope")
    return "Slack needs to be connected again so Mellox gets the right access.";
  if (code === "rate_limited") return "Slack is busy. Try again in a minute.";
  return "Slack didn't respond. Try again in a moment.";
}
