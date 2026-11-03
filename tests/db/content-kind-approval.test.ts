import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
// @ts-expect-error — shared migration replay helper.
import { createMigratedDb } from "../../scripts/db/pglite-supabase.mjs";

const user = "11111111-1111-4111-8111-111111111111";
let db: PGlite;
let workspace: string;
beforeAll(async () => {
  db = await createMigratedDb();
  await db.query("insert into auth.users(id,email) values ($1,'editor@example.test')", [user]);
  workspace = (
    await db.query<{ id: string }>(
      "insert into public.workspaces(name,owner_id) values ('Lifecycle test',$1) returning id",
      [user],
    )
  ).rows[0].id;
}, 120_000);
afterAll(async () => {
  await db?.close();
});

async function approvedPost() {
  const id = (
    await db.query<{ id: string }>(
      "insert into public.content_items(workspace_id,title,body,kind,status) values ($1,'Original','Copy','post','draft') returning id",
      [workspace],
    )
  ).rows[0].id;
  await db.query("update public.content_items set status='approved' where id=$1", [id]);
  return id;
}

describe("database format-change approval", () => {
  it("requires fresh approval after the format changes", async () => {
    const id = await approvedPost();
    const result = await db.query<{ status: string }>(
      "update public.content_items set kind='video' where id=$1 returning status",
      [id],
    );
    expect(result.rows[0].status).toBe("draft");
  });
  it("preserves approval when the format is unchanged", async () => {
    const id = await approvedPost();
    const result = await db.query<{ status: string }>(
      "update public.content_items set kind='post' where id=$1 returning status",
      [id],
    );
    expect(result.rows[0].status).toBe("approved");
  });
  it("preserves approval when only calendar planning changes", async () => {
    const id = await approvedPost();
    const result = await db.query<{ status: string }>(
      "update public.content_items set meta=$2::jsonb where id=$1 returning status",
      [id, JSON.stringify({ calendar_date: "2026-10-20", calendar_time: "09:00" })],
    );
    expect(result.rows[0].status).toBe("approved");
  });
  it("keeps provider delivery transitions intact", async () => {
    const id = await approvedPost();
    const result = await db.query<{ status: string }>(
      "update public.content_items set status='publishing',kind='video' where id=$1 returning status",
      [id],
    );
    expect(result.rows[0].status).toBe("publishing");
  });
  it("keeps existing copy invalidation and illegal-transition checks", async () => {
    const id = await approvedPost();
    expect(
      (
        await db.query<{ status: string }>(
          "update public.content_items set body='Changed' where id=$1 returning status",
          [id],
        )
      ).rows[0].status,
    ).toBe("draft");
    await expect(
      db.query("update public.content_items set status='published' where id=$1", [id]),
    ).rejects.toThrow(/Invalid content status transition/);
  });
  it("can reapply the migration safely", async () => {
    await db.exec(
      readFileSync("supabase/migrations/20261018090100_content_kind_approval.sql", "utf8"),
    );
    const id = await approvedPost();
    expect(
      (
        await db.query<{ status: string }>(
          "update public.content_items set kind='carousel' where id=$1 returning status",
          [id],
        )
      ).rows[0].status,
    ).toBe("draft");
  });
});
