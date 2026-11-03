import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error — shared JavaScript migration harness
import { createMigratedDb, readMigration } from "../../scripts/db/pglite-supabase.mjs";

const owner = "a1111111-1111-4111-8111-111111111111";
const stranger = "b2222222-2222-4222-8222-222222222222";
const state = "c3333333-3333-4333-8333-333333333333";
let db: PGlite;
let workspace: string;

async function install(access: string | null = "encrypted-access") {
  const { rows } = await db.query<{ id: string }>(
    "select public.save_canva_authorization($1,$2,$3,$4,$5,now()+interval '1 hour',$6,'canva-user','canva-team') as id",
    [workspace, owner, state, access, "encrypted-refresh", ["asset:read"]],
  );
  return rows[0].id;
}

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(readMigration("20261012090100_canva_atomic_authorization.sql"));
  for (const id of [owner, stranger])
    await db.query("insert into auth.users (id) values ($1)", [id]);
  const { rows } = await db.query<{ id: string }>(
    "insert into public.workspaces(owner_id,name) values ($1,'Canva security test') returning id",
    [owner],
  );
  workspace = rows[0].id;
  await db.query(
    "insert into public.workspace_members(workspace_id,user_id,role) values ($1,$2,'owner') on conflict do nothing",
    [workspace, owner],
  );
}, 120_000);
beforeEach(async () => {
  await db.exec("BEGIN");
  await db.query(
    "insert into public.connector_install_states(id,state_hash,workspace_id,user_id,provider,expires_at,consumed_at) values ($1,'test-hash',$2,$3,'canva',now()+interval '10 minutes',now())",
    [state, workspace, owner],
  );
});
afterEach(async () => {
  await db.exec("ROLLBACK");
});
afterAll(async () => {
  await db?.close();
});

describe("Canva credential transaction boundaries", () => {
  it("cascades workspace deletion through Canva design versions, imported assets and credentials", async () => {
    await install();
    const {
      rows: [asset],
    } = await db.query<{ id: string }>(
      "insert into public.assets(workspace_id,generation_id,idempotency_key,filename) values ($1,'canva-test','canva-test','edited.png') returning id",
      [workspace],
    );
    const {
      rows: [mapping],
    } = await db.query<{ id: string }>(
      "insert into public.canva_design_mappings(workspace_id,source_key,canva_design_id,asset_id) values ($1,'source','design',$2) returning id",
      [workspace, asset.id],
    );
    const {
      rows: [version],
    } = await db.query<{ id: string }>(
      "insert into public.canva_import_versions(workspace_id,mapping_id,version_number) values ($1,$2,1) returning id",
      [workspace, mapping.id],
    );
    await db.query(
      "insert into public.canva_import_pages(workspace_id,version_id,page_number,asset_id) values ($1,$2,1,$3)",
      [workspace, version.id, asset.id],
    );
    await db.query("delete from public.workspaces where id=$1", [workspace]);
    for (const table of [
      "workspace_connections",
      "canva_oauth_credentials",
      "canva_design_mappings",
      "canva_import_versions",
      "canva_import_pages",
      "assets",
    ]) {
      expect(
        (await db.query(`select id from public.workspaces where id=$1`, [workspace])).rows,
      ).toHaveLength(0);
      expect(
        (await db.query(`select * from public.${table} where workspace_id=$1`, [workspace])).rows,
      ).toHaveLength(0);
    }
  });
  it.each(["anon", "authenticated"])("denies credential-table reads to %s", async (role) => {
    await install();
    await db.exec(`SET LOCAL ROLE ${role}`);
    await expect(
      db.query("select access_token_enc, refresh_token_enc from public.canva_oauth_credentials"),
    ).rejects.toThrow(/permission denied/);
  });
  it("installs connection and credentials together and removes finalized state", async () => {
    const id = await install();
    const { rows } = await db.query(
      "select access_token_enc from public.canva_oauth_credentials where connection_id=$1",
      [id],
    );
    expect(rows).toEqual([{ access_token_enc: "encrypted-access" }]);
    expect(
      (await db.query("select metadata from public.workspace_connections where id=$1", [id])).rows,
    ).toEqual([{ metadata: { canva_user_id: "canva-user", canva_team_id: "canva-team" } }]);
    expect(
      (await db.query("select id from public.connector_install_states where id=$1", [state])).rows,
    ).toHaveLength(0);
  });
  it("rejects a callback completing after withdrawal", async () => {
    await db.query("select * from public.withdraw_canva_authorization($1)", [workspace]);
    await expect(install()).rejects.toThrow(/expired or withdrawn/);
  });
  it("withdraws credentials even if installation completed first", async () => {
    const id = await install();
    const { rows } = await db.query("select * from public.withdraw_canva_authorization($1)", [
      workspace,
    ]);
    expect(rows).toEqual([{ refresh_token_enc: "encrypted-refresh" }]);
    expect(
      (await db.query("select * from public.canva_oauth_credentials where connection_id=$1", [id]))
        .rows,
    ).toHaveLength(0);
    expect(
      (await db.query("select status from public.workspace_connections where id=$1", [id])).rows,
    ).toEqual([{ status: "revoked" }]);
  });
  it("cannot restore a rotated token after withdrawal", async () => {
    const id = await install();
    await db.query("select * from public.withdraw_canva_authorization($1)", [workspace]);
    const { rows } = await db.query(
      "select public.refresh_canva_authorization($1,$2,$3,$4,$5,now()+interval '1 hour') as saved",
      [workspace, id, "encrypted-refresh", "new-access", "new-refresh"],
    );
    expect(rows).toEqual([{ saved: false }]);
  });
  it("uses compare-and-set so a stale refresh cannot overwrite newer credentials", async () => {
    const id = await install();
    const refresh = (previous: string) =>
      db.query(
        "select public.refresh_canva_authorization($1,$2,$3,$4,$5,now()+interval '1 hour') as saved",
        [workspace, id, previous, "new-access", "new-refresh"],
      );
    expect((await refresh("encrypted-refresh")).rows).toEqual([{ saved: true }]);
    expect((await refresh("encrypted-refresh")).rows).toEqual([{ saved: false }]);
  });
  it.each([
    "expires_at=now()-interval '1 second'",
    "consumed_at=NULL",
    "user_id='b2222222-2222-4222-8222-222222222222'",
  ])("rejects invalid installation state: %s", async (change) => {
    await db.exec(`update public.connector_install_states set ${change}`);
    await expect(install()).rejects.toThrow(/expired or withdrawn/);
  });
  it("checks current membership again when finalizing the grant", async () => {
    await db.query("delete from public.workspace_members where workspace_id=$1 and user_id=$2", [
      workspace,
      owner,
    ]);
    await expect(install()).rejects.toThrow(/authorization required/);
  });
  it("restricts credential functions to service_role", async () => {
    for (const name of [
      "save_canva_authorization",
      "withdraw_canva_authorization",
      "refresh_canva_authorization",
    ]) {
      const { rows } = await db.query<{ anon: boolean; member: boolean; service: boolean }>(
        "select has_function_privilege('anon',oid,'EXECUTE') as anon, has_function_privilege('authenticated',oid,'EXECUTE') as member, has_function_privilege('service_role',oid,'EXECUTE') as service from pg_proc where proname=$1",
        [name],
      );
      expect(rows).toEqual([{ anon: false, member: false, service: true }]);
    }
  });
});
