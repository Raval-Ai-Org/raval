// AI cost attribution, against the real migration baseline in PGlite.
// Proves: record_ai_usage keeps the workflow and prompt-cache tokens (and
// drops a malformed workflow id rather than the row); admin_cost_per_output
// counts failed work into the cost of each accepted piece; customers can't
// call the report.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error — plain .mjs helper shared with scripts/db-baseline.mjs
import { createMigratedDb } from "../../scripts/db/pglite-supabase.mjs";

const OWNER = "c1111111-1111-4111-8111-111111111111";
type Report = {
  totals: Record<string, unknown>;
  by_variant: Array<Record<string, unknown> & { kind: string; variant: string }>;
  prompt_cache: Array<Record<string, unknown> & { route: string }>;
};

let db: PGlite;
let ws: string;

async function job(status: string, contentStatus: string | null): Promise<string> {
  let items: string[] = [];
  if (contentStatus) {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.content_items (workspace_id, title, body, status, created_by)
       values ($1, 'Post', 'body', $2, $3) returning id`,
      [ws, contentStatus, OWNER],
    );
    items = [rows[0].id];
  }
  const { rows } = await db.query<{ id: string }>(
    `insert into public.studio_jobs (workspace_id, type, status, idempotency_key, content_item_ids)
     values ($1, 'image', $2, gen_random_uuid()::text, $3::uuid[]) returning id`,
    [ws, status, items],
  );
  return rows[0].id;
}

async function usage(event: Record<string, unknown>) {
  await db.query(`select public.record_ai_usage($1::jsonb)`, [
    JSON.stringify({ workspace_id: ws, provider: "openrouter", model: "m", ...event }),
  ]);
}

beforeAll(async () => {
  db = await createMigratedDb();
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [
    OWNER,
    "owner@example.com",
  ]);
  const { rows } = await db.query<{ id: string }>(
    `insert into public.workspaces (owner_id, name) values ($1, 'Acme Bakery') returning id`,
    [OWNER],
  );
  ws = rows[0].id;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("AI cost attribution", () => {
  it("stores the workflow and prompt-cache tokens, and rolls cached tokens up daily", async () => {
    const id = await job("succeeded", "approved");
    await usage({
      route: "studio.image",
      workflow_kind: "studio_job",
      workflow_id: id,
      workflow_stage: "writing",
      input_tokens: 5000,
      cached_input_tokens: 4096,
      cache_write_tokens: 10,
      reasoning_tokens: 300,
      est_cost_usd: 0.01,
    });
    const { rows } = await db.query<Record<string, unknown>>(
      `select workflow_kind, workflow_id, workflow_stage, cached_input_tokens, cache_write_tokens, reasoning_tokens
       from public.ai_usage_events where workflow_id = $1`,
      [id],
    );
    expect(rows[0]).toMatchObject({
      workflow_kind: "studio_job",
      workflow_stage: "writing",
      cached_input_tokens: 4096,
      cache_write_tokens: 10,
      reasoning_tokens: 300,
    });
    const daily = await db.query<{ cached_input_tokens: string }>(
      `select cached_input_tokens from public.ai_usage_daily where scope_key = $1`,
      [`ws:${ws}`],
    );
    expect(Number(daily.rows[0].cached_input_tokens)).toBe(4096);
  });

  it("keeps the usage row when the workflow id is malformed", async () => {
    await usage({ route: "bad.wf", workflow_kind: "studio_job", workflow_id: "not-a-uuid" });
    const { rows } = await db.query<Record<string, unknown>>(
      `select workflow_kind, workflow_id from public.ai_usage_events where route = 'bad.wf'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ workflow_kind: null, workflow_id: null });
  });

  it("charges failed work to the accepted pieces", async () => {
    const failed = await job("failed", null);
    await usage({
      route: "studio.image",
      workflow_kind: "studio_job",
      workflow_id: failed,
      workflow_stage: "image",
      kind: "image",
      est_cost_usd: 0.04,
      status: "error",
    });
    const unaccepted = await job("succeeded", "draft");
    await usage({
      route: "studio.image",
      workflow_kind: "studio_job",
      workflow_id: unaccepted,
      est_cost_usd: 0.05,
    });

    const { rows } = await db.query<{ r: Report }>(`select public.admin_cost_per_output(7) as r`);
    const report = rows[0].r;
    const image = report.by_variant.find((v) => v.kind === "studio_job" && v.variant === "image");
    expect(image).toMatchObject({ workflows: 3, succeeded: 2, failed: 1, accepted: 1 });
    expect(Number(image!.cost_usd)).toBeCloseTo(0.1, 6);
    expect(Number(image!.failed_cost_usd)).toBeCloseTo(0.04, 6);
    expect(Number(image!.cost_per_accepted_usd)).toBeCloseTo(0.1, 6);
    expect(Number(image!.cost_per_succeeded_usd)).toBeCloseTo(0.05, 6);
    expect(Number(report.totals.cached_input_tokens)).toBe(4096);
    const cache = report.prompt_cache.find((p) => p.route === "studio.image");
    expect(Number(cache!.cached_share)).toBeCloseTo(4096 / 5000, 3);
  });

  it("refuses the report to customers", async () => {
    await db.query(`set role authenticated`);
    await expect(db.query(`select public.admin_cost_per_output(7)`)).rejects.toThrow(
      /permission denied/,
    );
    await db.query(`reset role`);
  });
});
