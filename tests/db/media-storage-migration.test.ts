import { describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const workspace = "00000000-0000-4000-8000-000000000001";
const oldPath = `workspace/${workspace}/assets/upload/original.mp4`;
const newPath = `workspace/${workspace}/assets/r2/migrated/upload/original.mp4`;

describe("media migration transaction and isolation", () => {
  it("rewrites exact nested references, rolls back, and restricts alias access", async () => {
    const db = new PGlite();
    try {
      await db.exec(`create schema private; create role anon; create role authenticated; create role service_role;
        create table public.media(id int primary key, path text, meta jsonb);
        create table public.content_items(id int primary key, workspace_id uuid, media_url text, meta jsonb);
        insert into public.content_items values(1,'${workspace}','https://example.supabase.co/storage/v1/object/sign/generated-assets/${oldPath}?token=expired','{"asset_storage_path":"${oldPath}"}');
        insert into public.media values (1,'${oldPath}','{"paths":["${oldPath}"],"nested":{"path":"${oldPath}"},"text":"prefix ${oldPath}"}');`);
      await db.exec(
        readFileSync("supabase/migrations/20261012190000_r2_storage_migration.sql", "utf8"),
      );
      await db.query(
        "insert into private.media_storage_migrations(source_bucket,source_path,target_path,workspace_id,status) values('generated-assets',$1,$2,$3,'active')",
        [oldPath, newPath, workspace],
      );
      await db.query("select private.switch_media_references($1,$2)", [oldPath, newPath]);
      const { rows } = await db.query<{
        path: string;
        meta: { paths: string[]; nested: { path: string }; text: string };
      }>("select * from public.media");
      expect(rows[0].path).toBe(newPath);
      expect(rows[0].meta.paths).toEqual([newPath]);
      expect(rows[0].meta.nested.path).toBe(newPath);
      expect(rows[0].meta.text).toBe(`prefix ${oldPath}`);
      expect(
        (
          await db.query<{ media_url: string | null; meta: { asset_storage_path: string } }>(
            "select * from public.content_items",
          )
        ).rows[0],
      ).toMatchObject({ media_url: null, meta: { asset_storage_path: newPath } });
      await db.query("select private.switch_media_references($1,$2)", [newPath, oldPath]);
      expect((await db.query<{ path: string }>("select path from public.media")).rows[0].path).toBe(
        oldPath,
      );
      await expect(
        db.query("select private.switch_media_references($1,$2)", [
          oldPath,
          newPath.replace(workspace, "00000000-0000-4000-8000-000000000002"),
        ]),
      ).rejects.toThrow("Invalid workspace");
      await db.exec("set role authenticated");
      await expect(db.query("select * from private.media_storage_migrations")).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        db.query("select * from public.resolve_media_storage_paths($1)", [[oldPath]]),
      ).rejects.toThrow(/permission denied/);
      await db.exec("reset role; set role service_role");
      expect(
        (await db.query("select * from public.resolve_media_storage_paths($1)", [[oldPath]])).rows,
      ).toHaveLength(1);
      await db.query("select public.tombstone_migrated_media($1)", [[newPath]]);
      expect(
        (
          await db.query<{ status: string }>(
            "select * from public.resolve_media_storage_paths($1)",
            [[oldPath]],
          )
        ).rows[0].status,
      ).toBe("deleted");
    } finally {
      await db.close();
    }
  }, 30000);
});
