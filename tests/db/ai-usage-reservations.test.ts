// AI usage reservations + UGC render tables, against the real migration
// baseline in PGlite. Proves the allowance maths (quota, spend, concurrency,
// idempotency, capture-once, release, expiry) and that browsers can read but
// never forge UGC render state.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error — plain .mjs helper shared with scripts/db-baseline.mjs
import { createMigratedDb } from "../../scripts/db/pglite-supabase.mjs";

const OWNER = "d4444444-4444-4444-8444-444444444444";
const OTHER = "e5555555-5555-4555-8555-555555555555";

let db: PGlite;
let ws: string;
let wsOther: string;
let seq = 0;

type ReserveResult = { ok: boolean; id?: string; code?: string; reason?: string; state?: string };

async function reserve(overrides: Record<string, unknown> = {}): Promise<ReserveResult> {
  const { rows } = await db.query<{ r: ReserveResult }>(
    `select public.reserve_ai_usage($1::jsonb) as r`,
    [
      JSON.stringify({
        scope_key: `ws:${ws}`,
        workspace_id: ws,
        user_id: OWNER,
        kind: "video",
        units: 1,
        est_cost_usd: 0.3,
        provider: "kie",
        model: "veo-3-1",
        route: "ugc/renders:create",
        source: "ugc_render",
        source_id: `render-${++seq}`,
        ttl_seconds: 3600,
        limits: { daily_usd: 10, monthly_usd: 100, monthly_units: 3 },
        max_concurrent: 0,
        ...overrides,
      }),
    ],
  );
  return rows[0].r;
}

async function summary() {
  const { rows } = await db.query<{ month_videos: number; month_cost_usd: string }>(
    `select month_videos::int, month_cost_usd from public.ai_usage_summary($1)`,
    [`ws:${ws}`],
  );
  return { videos: rows[0].month_videos, cost: Number(rows[0].month_cost_usd) };
}

async function resetHolds() {
  await db.query(`delete from public.ai_usage_reservations`);
  await db.query(`delete from public.ai_usage_daily`);
  await db.query(`delete from public.ai_usage_events`);
}

async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.exec("BEGIN");
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: user, role: "authenticated" }),
    ]);
    await db.exec("SET LOCAL ROLE authenticated");
    return await fn();
  } finally {
    await db.exec("ROLLBACK");
  }
}

beforeAll(async () => {
  db = await createMigratedDb();
  for (const [id, email] of [
    [OWNER, "owner@example.com"],
    [OTHER, "other@example.com"],
  ]) {
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
  }
  const mk = async (owner: string, name: string) => {
    const {
      rows: [row],
    } = await db.query<{ id: string }>(
      `insert into public.workspaces (owner_id, name) values ($1, $2) returning id`,
      [owner, name],
    );
    await db.query(
      `insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')
       on conflict do nothing`,
      [row.id, owner],
    );
    return row.id;
  };
  ws = await mk(OWNER, "Owner Co");
  wsOther = await mk(OTHER, "Other Co");
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("reserve_ai_usage", () => {
  it("holds allowance up to the monthly quota and refuses the next one", async () => {
    await resetHolds();
    expect((await reserve()).ok).toBe(true);
    expect((await reserve()).ok).toBe(true);
    expect((await reserve()).ok).toBe(true);
    const fourth = await reserve();
    expect(fourth).toMatchObject({ ok: false, code: "quota" });
    // Holds are visible to every budget check through ai_usage_summary.
    expect(await summary()).toEqual({ videos: 3, cost: 0.9 });
  });

  it("refuses when metered spend plus holds would pass a ceiling", async () => {
    await resetHolds();
    const first = await reserve({ est_cost_usd: 6, limits: { daily_usd: 10, monthly_usd: 100 } });
    expect(first.ok).toBe(true);
    const second = await reserve({ est_cost_usd: 6, limits: { daily_usd: 10, monthly_usd: 100 } });
    expect(second).toMatchObject({ ok: false, code: "spend" });
  });

  it("is idempotent per (source, source_id)", async () => {
    await resetHolds();
    const a = await reserve({ source_id: "same" });
    const b = await reserve({ source_id: "same" });
    expect(a.ok && b.ok).toBe(true);
    expect(b.id).toBe(a.id);
    expect((await summary()).videos).toBe(1);
  });

  it("caps concurrent holds for one source", async () => {
    await resetHolds();
    expect((await reserve({ max_concurrent: 2 })).ok).toBe(true);
    expect((await reserve({ max_concurrent: 2 })).ok).toBe(true);
    expect(await reserve({ max_concurrent: 2 })).toMatchObject({ ok: false, code: "concurrency" });
  });
});

describe("capture / release", () => {
  it("captures once: usage is recorded a single time and the hold becomes metered", async () => {
    await resetHolds();
    const hold = await reserve();
    const first = await db.query<{ c: boolean }>(
      `select public.capture_ai_usage_reservation($1, 0.15, 5000) as c`,
      [hold.id],
    );
    const second = await db.query<{ c: boolean }>(
      `select public.capture_ai_usage_reservation($1, 0.15, 5000) as c`,
      [hold.id],
    );
    expect(first.rows[0].c).toBe(true);
    expect(second.rows[0].c).toBe(false);
    const events = await db.query<{ n: number }>(
      `select count(*)::int as n from public.ai_usage_events where kind = 'video'`,
    );
    expect(events.rows[0].n).toBe(1);
    // The actual provider cost replaces the estimate.
    expect(await summary()).toEqual({ videos: 1, cost: 0.15 });
  });

  it("release returns the allowance and cannot be captured afterwards", async () => {
    await resetHolds();
    const hold = await reserve();
    const released = await db.query<{ r: boolean }>(
      `select public.release_ai_usage_reservation($1, 'provider_failed') as r`,
      [hold.id],
    );
    expect(released.rows[0].r).toBe(true);
    expect(await summary()).toEqual({ videos: 0, cost: 0 });
    const captured = await db.query<{ c: boolean }>(
      `select public.capture_ai_usage_reservation($1) as c`,
      [hold.id],
    );
    expect(captured.rows[0].c).toBe(false);
  });

  it("an expired hold is swept, but a render that still delivers is captured", async () => {
    await resetHolds();
    const hold = await reserve();
    await db.query(
      `update public.ai_usage_reservations set expires_at = now() - interval '1 minute' where id = $1`,
      [hold.id],
    );
    expect((await summary()).videos).toBe(0);
    const swept = await db.query<{ n: number }>(
      `select public.release_expired_ai_usage_reservations() as n`,
    );
    expect(swept.rows[0].n).toBe(1);
    const captured = await db.query<{ c: boolean }>(
      `select public.capture_ai_usage_reservation($1) as c`,
      [hold.id],
    );
    expect(captured.rows[0].c).toBe(true);
    expect((await summary()).videos).toBe(1);
  });

  it("browsers cannot call the reservation functions", async () => {
    await expect(
      as(OWNER, () => db.query(`select public.release_expired_ai_usage_reservations()`)),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("ugc tables", () => {
  let renderId: string;

  beforeAll(async () => {
    const {
      rows: [project],
    } = await db.query<{ id: string }>(
      `insert into public.ugc_projects (workspace_id, created_by, title) values ($1, $2, 'Ad') returning id`,
      [ws, OWNER],
    );
    const {
      rows: [render],
    } = await db.query<{ id: string }>(
      `insert into public.ugc_renders (workspace_id, project_id, created_by, idempotency_key, model_key,
         provider, provider_model, generation_type, duration_sec, aspect_ratio, resolution, script, prompt)
       values ($1, $2, $3, 'k1', 'veo-3-1-fast', 'kie', 'veo-3-1', 'TEXT_2_VIDEO', 8, '9:16', '720p', '{}', 'p')
       returning id`,
      [ws, project.id, OWNER],
    );
    renderId = render.id;
  });

  it("members read their renders; other tenants see nothing", async () => {
    const own = await as(OWNER, () =>
      db.query(`select id from public.ugc_renders where workspace_id = $1`, [ws]),
    );
    expect(own.rows).toHaveLength(1);
    const other = await as(OTHER, () =>
      db.query(`select id from public.ugc_renders where workspace_id = $1`, [ws]),
    );
    expect(other.rows).toHaveLength(0);
    const otherProjects = await as(OTHER, () =>
      db.query(`select id from public.ugc_projects where workspace_id = $1`, [ws]),
    );
    expect(otherProjects.rows).toHaveLength(0);
  });

  it("a browser can never mark a render succeeded or insert one", async () => {
    await expect(
      as(OWNER, () =>
        db.query(`update public.ugc_renders set status = 'succeeded' where id = $1`, [renderId]),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      as(OWNER, () =>
        db.query(
          `insert into public.ugc_renders (workspace_id, project_id, idempotency_key, model_key, provider,
             provider_model, generation_type, duration_sec, aspect_ratio, resolution, script, prompt)
           select workspace_id, project_id, 'k2', model_key, provider, provider_model, generation_type,
             duration_sec, aspect_ratio, resolution, script, prompt from public.ugc_renders where id = $1`,
          [renderId],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("another tenant cannot create a project in someone else's workspace", async () => {
    await expect(
      as(OTHER, () =>
        db.query(`insert into public.ugc_projects (workspace_id, title) values ($1, 'x')`, [ws]),
      ),
    ).rejects.toThrow(/row-level security/i);
    expect(wsOther).toBeTruthy();
  });

  it("claim_ugc_renders leases a render to one worker at a time", async () => {
    const first = await db.query(`select id from public.claim_ugc_renders('w1', 5, 60, null)`);
    const second = await db.query(`select id from public.claim_ugc_renders('w2', 5, 60, null)`);
    expect(first.rows).toHaveLength(1);
    expect(second.rows).toHaveLength(0);
  });
});
