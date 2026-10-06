import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error plain .mjs helper shared with the migration verifier
import { createMigratedDb } from "../../scripts/db/pglite-supabase.mjs";

const OWNER = "a1111111-1111-4111-8111-111111111111";
const OTHER = "b2222222-2222-4222-8222-222222222222";
let db: PGlite;
let workspace: string;
let installation: string;
beforeAll(async () => {
  db = await createMigratedDb();
  await db.query(
    "insert into auth.users(id,email) values($1,'slack-owner@test.local'),($2,'other@test.local')",
    [OWNER, OTHER],
  );
  workspace = (
    await db.query<{ workspace_id: string }>(
      "select workspace_id from private.create_workspace_for_user($1,'Slack test','https://slack.test','slack-test')",
      [OWNER],
    )
  ).rows[0].workspace_id;
  installation = (
    await db.query<{ id: string }>(
      "insert into public.slack_installations(workspace_id,team_id,team_name,bot_user_id,bot_token_enc) values($1,'T123','Test','B123','encrypted') returning id",
      [workspace],
    )
  ).rows[0].id;
}, 120_000);
afterAll(async () => {
  await db?.close();
});

async function asAuthenticated(sql: string, params: unknown[] = []) {
  await db.exec("BEGIN");
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: OWNER, role: "authenticated" }),
    ]);
    await db.exec("SET LOCAL ROLE authenticated");
    return await db.query(sql, params);
  } finally {
    await db.exec("ROLLBACK");
  }
}

describe("Slack database isolation", () => {
  it("keeps tokens, user links, payloads, and preferences inaccessible to browser roles", async () => {
    for (const name of [
      "slack_installations",
      "slack_user_links",
      "slack_inbox",
      "slack_action_refs",
      "slack_preferences",
      "slack_outbound",
      "slack_threads",
    ])
      await expect(asAuthenticated(`select * from public.${name} limit 1`)).rejects.toThrow(
        /permission denied/i,
      );
  });
  it("does not grant authenticated users the queue claim RPC", async () => {
    await expect(asAuthenticated("select * from private.claim_slack_inbox(1)")).rejects.toThrow(
      /permission denied/i,
    );
  });
  it("enforces one live installation per Mellox workspace", async () => {
    await expect(
      db.query(
        "insert into public.slack_installations(workspace_id,team_id,team_name,bot_user_id,bot_token_enc) values($1,'T999','Other','B999','enc')",
        [workspace],
      ),
    ).rejects.toThrow();
  });
  it("enforces channel and inbound delivery uniqueness", async () => {
    await db.query(
      "insert into public.slack_channel_mappings(workspace_id,installation_id,team_id,purpose,channel_id,channel_name) values($1,$2,'T123','approvals','C123','approvals')",
      [workspace, installation],
    );
    await expect(
      db.query(
        "insert into public.slack_channel_mappings(workspace_id,installation_id,team_id,purpose,channel_id,channel_name) values($1,$2,'T123','marketing','C123','marketing')",
        [workspace, installation],
      ),
    ).rejects.toThrow();
    const clientWorkspace = (
      await db.query<{ workspace_id: string }>(
        "select workspace_id from private.create_workspace_for_user($1,'Second client','https://second.test','second-client')",
        [OTHER],
      )
    ).rows[0].workspace_id;
    const clientInstall = (
      await db.query<{ id: string }>(
        "insert into public.slack_installations(workspace_id,team_id,team_name,bot_user_id,bot_token_enc) values($1,'T123','Test','B123','encrypted') returning id",
        [clientWorkspace],
      )
    ).rows[0].id;
    await expect(
      db.query(
        "insert into public.slack_channel_mappings(workspace_id,installation_id,team_id,purpose,channel_id,channel_name) values($1,$2,'T123','approvals','C123','approvals')",
        [clientWorkspace, clientInstall],
      ),
    ).rejects.toThrow();
    await db.query(
      "insert into public.slack_inbox(workspace_id,installation_id,delivery_key,kind,payload) values($1,$2,'event:E123','event','{}')",
      [workspace, installation],
    );
    await expect(
      db.query(
        "insert into public.slack_inbox(workspace_id,installation_id,delivery_key,kind,payload) values($1,$2,'event:E123','event','{}')",
        [workspace, installation],
      ),
    ).rejects.toThrow();
  });
  it("deduplicates content created from one Slack shortcut", async () => {
    const meta = JSON.stringify({
      source: "slack",
      slack_ref: "00000000-0000-4000-8000-000000000099",
    });
    await db.query(
      "insert into public.content_items(workspace_id,title,status,created_by,meta) values($1,'Idea','draft',$2,$3)",
      [workspace, OWNER, meta],
    );
    await expect(
      db.query(
        "insert into public.content_items(workspace_id,title,status,created_by,meta) values($1,'Idea again','draft',$2,$3)",
        [workspace, OWNER, meta],
      ),
    ).rejects.toThrow();
  });
});
