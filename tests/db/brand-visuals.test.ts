import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const a = "00000000-0000-4000-8000-000000000001";
const b = "00000000-0000-4000-8000-000000000002";
const user = "00000000-0000-4000-8000-000000000003";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema auth;create schema private;create role anon;create role authenticated;create role service_role bypassrls;
  create table auth.users(id uuid primary key);insert into auth.users values('${user}');
  create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create table public.workspaces(id uuid primary key);insert into public.workspaces values('${a}'),('${b}');
  create table public.workspace_members(workspace_id uuid,user_id uuid,role text default 'editor');insert into public.workspace_members(workspace_id,user_id) values('${a}','${user}');
  create function private.is_workspace_member(w uuid,u uuid) returns boolean language sql security definer as $$select exists(select 1 from public.workspace_members where workspace_id=w and user_id=u)$$;
  grant usage on schema auth,private to authenticated;grant execute on function auth.uid(),private.is_workspace_member(uuid,uuid) to authenticated;
  create table public.assets(id uuid primary key default gen_random_uuid(),workspace_id uuid,status text,deleted_at timestamptz,storage_path text,asset_type text);
  create table public.studio_jobs(id uuid primary key default gen_random_uuid(),workspace_id uuid,status text,output jsonb,content_item_ids uuid[],asset_ids uuid[]);
  create table public.content_items(id uuid primary key default gen_random_uuid(),workspace_id uuid,status text,meta jsonb,media_url text);
  create table public.workspace_brand_dna(workspace_id uuid primary key,dna jsonb,version integer default 1,updated_at timestamptz);
  insert into public.workspace_brand_dna values('${a}','{"brandName":"Original","look":{"visual":{"mood":"hand drawn"}}}',1,now());`);
  await db.exec(readFileSync("supabase/migrations/20261015090000_brand_visual_taste.sql", "utf8"));
}, 60000);
afterAll(() => db?.close());
describe("visual taste database invariants", () => {
  it("saves and replaces manual-look feedback while rejecting a creation in another workspace", async () => {
    const job = (
      await db.query<{ id: string }>(
        "insert into public.studio_jobs(workspace_id,status,output) values($1,'succeeded','{}') returning id",
        [a],
      )
    ).rows[0].id;
    const save = `insert into public.brand_visual_feedback(workspace_id,job_id,created_by,reason,note)
      values($1,$2,$3,$4,$5) on conflict(workspace_id,job_id,created_by)
      do update set reason=excluded.reason,note=excluded.note`;
    await db.query(save, [a, job, user, "too-busy", "Fewer props"]);
    await db.query(save, [a, job, user, "wrong-theme", "Warmer lighting"]);
    const feedback = await db.query<{ reason: string; note: string; profile_id: string | null }>(
      "select reason,note,profile_id from public.brand_visual_feedback where job_id=$1",
      [job],
    );
    expect(feedback.rows).toEqual([
      { reason: "wrong-theme", note: "Warmer lighting", profile_id: null },
    ]);
    await expect(db.query(save, [b, job, user, "matches", ""])).rejects.toThrow(
      /visual_job_wrong_workspace/,
    );
  });
  it("a cancelled or superseded worker cannot save an analysed profile", async () => {
    const token = "00000000-0000-4000-8000-000000000004";
    const job = (
      await db.query<{ id: string }>(
        "insert into public.brand_visual_capture_jobs(workspace_id,created_by,idempotency_key,url,status,lease_token) values($1,$2,'cancel-proof','https://example.com','running',$3) returning id",
        [a, user, token],
      )
    ).rows[0].id;
    await db.query(
      "update public.brand_visual_capture_jobs set status='cancelled',lease_token=null where id=$1",
      [job],
    );
    await expect(
      db.query("select public.complete_visual_analysis($1,$2,'{}')", [job, token]),
    ).rejects.toThrow(/cancelled/);
    expect(
      (await db.query("select id from public.brand_visual_profiles where capture_job_id=$1", [job]))
        .rows,
    ).toHaveLength(0);
  });
  it("allows only one active capture per brand", async () => {
    await db.query(
      "insert into public.brand_visual_capture_jobs(workspace_id,idempotency_key,url) values($1,'scan1','https://example.com')",
      [a],
    );
    await expect(
      db.query(
        "insert into public.brand_visual_capture_jobs(workspace_id,idempotency_key,url) values($1,'scan2','https://example.com')",
        [a],
      ),
    ).rejects.toThrow(/brand_visual_one_active_scan/);
    await db.query(
      "update public.brand_visual_capture_jobs set status='cancelled' where workspace_id=$1",
      [a],
    );
  });
  it("edits linked artwork atomically, preserves metadata and refuses scheduled/stale versions", async () => {
    const asset = (
      await db.query<{ id: string }>(
        "insert into public.assets(workspace_id,status,storage_path) values($1,'ready','owned/image.png') returning id",
        [a],
      )
    ).rows[0].id;
    const posts = (
      await db.query<{ id: string }>(
        "insert into public.content_items(workspace_id,status,meta) values($1,'approved','{\"keep\":true}'),($1,'scheduled','{}') returning id",
        [a],
      )
    ).rows.map((p) => p.id);
    const job = (
      await db.query<{ id: string }>(
        "insert into public.studio_jobs(workspace_id,status,output,content_item_ids) values($1,'succeeded','{\"version\":1}',$2) returning id",
        [a, posts],
      )
    ).rows[0].id;
    const replace = () =>
      db.query(
        "select public.replace_visual_artwork($1,$2,'{\"version\":1}','{\"version\":2}',$3,'New title')",
        [a, job, asset],
      );
    await expect(replace()).rejects.toThrow(/post_changed/);
    expect(
      (
        await db.query<{ status: string }>("select status from public.content_items where id=$1", [
          posts[0],
        ])
      ).rows[0].status,
    ).toBe("approved");
    await db.query("update public.content_items set status='draft' where id=$1", [posts[1]]);
    await replace();
    const first = (
      await db.query<{ status: string; meta: { keep: boolean; asset_id: string } }>(
        "select status,meta from public.content_items where id=$1",
        [posts[0]],
      )
    ).rows[0];
    expect(first.status).toBe("draft");
    expect(first.meta.keep).toBe(true);
    expect(first.meta.asset_id).toBe(asset);
    await expect(replace()).rejects.toThrow(/artwork_changed/);
  });
  it("prevents cross-workspace evidence even in service writes", async () => {
    const { rows } = await db.query<{ id: string }>(
      "insert into public.assets(workspace_id) values($1) returning id",
      [b],
    );
    await expect(
      db.query(
        "insert into public.brand_visual_sources(workspace_id,asset_id,kind,label) values($1,$2,'upload','Foreign')",
        [a, rows[0].id],
      ),
    ).rejects.toThrow(/wrong_workspace/);
  });
  it("approval is atomic, preserves manually edited DNA and detects a stale selection", async () => {
    const { rows } = await db.query<{ id: string }>(
      "insert into public.brand_visual_profiles(workspace_id,profile) values($1,$2) returning id",
      [a, JSON.stringify({ selected: 0, directions: [{ sourceIds: [] }] })],
    );
    await db.query("select public.activate_brand_visual_profile($1,$2,null)", [a, rows[0].id]);
    const { rows: details } = await db.query<{
      dna: { brandName: string; look: unknown; visualProfileId: string };
    }>("select dna from public.workspace_brand_dna where workspace_id=$1", [a]);
    expect(details[0].dna.brandName).toBe("Original");
    expect(details[0].dna.look).toEqual({ visual: { mood: "hand drawn" } });
    expect(details[0].dna.visualProfileId).toBe(rows[0].id);
    await expect(
      db.query("select public.activate_brand_visual_profile($1,$2,null)", [a, rows[0].id]),
    ).rejects.toThrow(/changed/);
  });
  it("members read only their own profiles and cannot write or approve through the browser role", async () => {
    const selected = (
      await db.query<{ active_profile_id: string }>(
        "select active_profile_id from public.brand_visual_settings where workspace_id=$1",
        [a],
      )
    ).rows[0].active_profile_id;
    await db.query(
      "update public.workspace_brand_dna set dna=dna-'visualProfileId' where workspace_id=$1",
      [a],
    );
    expect(
      (
        await db.query<{ dna: { visualProfileId: string } }>(
          "select dna from public.workspace_brand_dna where workspace_id=$1",
          [a],
        )
      ).rows[0].dna.visualProfileId,
    ).toBe(selected);
    await db.query(
      "insert into public.brand_visual_profiles(workspace_id,profile) values($1,'{}')",
      [b],
    );
    await db.exec("begin");
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
      await db.exec("set local role authenticated");
      const { rows } = await db.query<{ workspace_id: string }>(
        "select workspace_id from public.brand_visual_profiles",
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.workspace_id === a)).toBe(true);
      await expect(
        db.query("insert into public.brand_visual_profiles(workspace_id,profile) values($1,'{}')", [
          a,
        ]),
      ).rejects.toThrow(/permission/);
    } finally {
      await db.exec("rollback");
    }
    await db.exec("begin");
    try {
      await db.exec("set local role authenticated");
      await expect(
        db.query("select public.activate_brand_visual_profile($1,null,null)", [a]),
      ).rejects.toThrow(/permission/);
    } finally {
      await db.exec("rollback");
    }
  });
  it("rejects approval of an image-only video preview", async () => {
    const post = (
      await db.query<{ id: string }>(
        "insert into public.content_items(workspace_id,status,meta) values($1,'draft','{\"storyboard_preview\":true,\"requires_visual_video\":true}') returning id",
        [a],
      )
    ).rows[0].id;
    await db.query(
      'update public.content_items set meta=\'{"storyboard_preview":false,"requires_visual_video":false}\' where id=$1',
      [post],
    );
    await expect(
      db.query("update public.content_items set status='approved' where id=$1", [post]),
    ).rejects.toThrow(/finished video/);
    const video = (
      await db.query<{ id: string }>(
        "insert into public.assets(workspace_id,status,asset_type,storage_path) values($1,'ready','video','owned/video.mp4') returning id",
        [a],
      )
    ).rows[0].id;
    await db.query(
      "update public.content_items set meta=meta||jsonb_build_object('asset_id',$2::text),status='approved' where id=$1",
      [post, video],
    );
    expect(
      (
        await db.query<{ status: string }>("select status from public.content_items where id=$1", [
          post,
        ])
      ).rows[0].status,
    ).toBe("approved");
    await expect(
      db.query(
        "insert into public.content_items(workspace_id,status,meta) values($1,'approved','{\"storyboard_preview\":true}')",
        [a],
      ),
    ).rejects.toThrow(/Render the video/);
    await expect(
      db.query(
        "insert into public.content_items(workspace_id,status,meta) values($1,'draft','{\"storyboard_preview\":true}')",
        [a],
      ),
    ).resolves.toBeDefined();
  });
  it("can return to the manual look and restore an approved version without losing Brand DNA", async () => {
    const active = (
      await db.query<{ active_profile_id: string }>(
        "select active_profile_id from public.brand_visual_settings where workspace_id=$1",
        [a],
      )
    ).rows[0].active_profile_id;
    await expect(db.query("select public.use_manual_visual_look($1,null)", [a])).rejects.toThrow(
      /changed/,
    );
    await db.query("select public.use_manual_visual_look($1,$2)", [a, active]);
    const cleared = (
      await db.query<{ dna: { brandName: string; visualProfileId?: string } }>(
        "select dna from public.workspace_brand_dna where workspace_id=$1",
        [a],
      )
    ).rows[0].dna;
    expect(cleared.brandName).toBe("Original");
    expect(cleared.visualProfileId).toBeUndefined();
    await db.query("select public.activate_brand_visual_profile($1,$2,null)", [a, active]);
    expect(
      (
        await db.query<{ dna: { visualProfileId: string } }>(
          "select dna from public.workspace_brand_dna where workspace_id=$1",
          [a],
        )
      ).rows[0].dna.visualProfileId,
    ).toBe(active);
  });
});
