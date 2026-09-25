import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error — plain .mjs helper shared with scripts/db-baseline.mjs
import { createMigratedDb } from "../../scripts/db/pglite-supabase.mjs";

const OWNER = "a1111111-1111-4111-8111-111111111111";
const EDITOR = "e5555555-5555-4555-8555-555555555555";
const OTHER = "b2222222-2222-4222-8222-222222222222";

let db: PGlite;
let account: string;
let workspace: string;

type Result = {
  ok: boolean;
  replayed?: boolean;
  id?: string;
  grant_id?: string;
  code?: string;
  available?: number;
  held?: number;
  available_any?: number;
  debt?: number;
};

async function rpc(name: string, body: Record<string, unknown>): Promise<Result> {
  const { rows } = await db.query<{ r: Result }>(`select public.${name}($1::jsonb) as r`, [
    JSON.stringify(body),
  ]);
  return rows[0].r;
}

async function wallet() {
  const { rows } = await db.query<{ available: string; held: string; available_any: string }>(
    `select available, held, available_any from public.meter_balances where account_id=$1 and meter='credits'`,
    [account],
  );
  return {
    available: Number(rows[0].available),
    held: Number(rows[0].held),
    any: Number(rows[0].available_any),
  };
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
    [EDITOR, "editor@example.com"],
    [OTHER, "other@example.com"],
  ]) {
    await db.query(`insert into auth.users(id,email) values($1,$2)`, [id, email]);
  }
  const made = await db.query<{ workspace_id: string }>(
    `select workspace_id from private.create_workspace_for_user($1,'Brand','https://brand.test','billing-test')`,
    [OWNER],
  );
  workspace = made.rows[0].workspace_id;
  await db.query(
    `insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,'editor')`,
    [workspace, EDITOR],
  );
  const acct = await db.query<{ billing_account_id: string }>(
    `select billing_account_id from public.workspaces where id=$1`,
    [workspace],
  );
  account = acct.rows[0].billing_account_id;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("account meter foundation", () => {
  it("links every new brand of an owner to one account", async () => {
    const made = await db.query<{ workspace_id: string }>(
      `select workspace_id from private.create_workspace_for_user($1,'Second','https://second.test','billing-test-2')`,
      [OWNER],
    );
    const rows = await db.query<{ billing_account_id: string }>(
      `select billing_account_id from public.workspaces where id=$1`,
      [made.rows[0].workspace_id],
    );
    expect(rows.rows[0].billing_account_id).toBe(account);
  });

  it("grants, holds and captures only successful work, with stable replay", async () => {
    const ai = await rpc("meter_grant", {
      account_id: account,
      meter: "credits",
      source: "promo",
      restriction: "ai_only",
      amount: 50,
      idempotency_key: "test:promo:1",
      expires_at: "2030-01-01T00:00:00Z",
    });
    expect(ai.ok).toBe(true);
    const paid = await rpc("meter_grant", {
      account_id: account,
      meter: "credits",
      source: "pack",
      restriction: "any",
      amount: 100,
      idempotency_key: "test:pack:1",
    });
    expect(paid.ok).toBe(true);
    expect(
      (
        await rpc("meter_grant", {
          account_id: account,
          meter: "credits",
          source: "pack",
          restriction: "any",
          amount: 100,
          idempotency_key: "test:pack:1",
        })
      ).replayed,
    ).toBe(true);

    const hold = await rpc("meter_hold", {
      account_id: account,
      workspace_id: workspace,
      meter: "credits",
      action: "article_premium",
      amount: 80,
      idempotency_key: "test:article:1",
      expires_at: "2030-01-01T00:00:00Z",
    });
    expect(hold.ok).toBe(true);
    expect(hold.replayed).toBe(false);
    expect(
      (
        await rpc("meter_hold", {
          account_id: account,
          workspace_id: workspace,
          meter: "credits",
          action: "article_premium",
          amount: 80,
          idempotency_key: "test:article:1",
        })
      ).replayed,
    ).toBe(true);
    const allocation = await db.query<{
      allocations: Array<{ grant_id: string; remaining: number }>;
    }>(`select allocations from public.meter_holds where id=$1`, [hold.id]);
    expect(allocation.rows[0].allocations.map((x) => x.remaining)).toEqual([50, 30]);
    expect(await wallet()).toEqual({ available: 70, held: 80, any: 70 });

    const partial = await rpc("meter_capture", {
      account_id: account,
      hold_id: hold.id,
      amount: 40,
      finalize: false,
      idempotency_key: "test:capture:1",
    });
    expect(partial.ok).toBe(true);
    expect(
      (
        await rpc("meter_capture", {
          account_id: account,
          hold_id: hold.id,
          amount: 40,
          finalize: false,
          idempotency_key: "test:capture:1",
        })
      ).replayed,
    ).toBe(true);
    expect(await wallet()).toEqual({ available: 70, held: 40, any: 70 });

    const final = await rpc("meter_capture", {
      account_id: account,
      hold_id: hold.id,
      amount: 20,
      idempotency_key: "test:capture:2",
    });
    expect(final.ok).toBe(true);
    expect(await wallet()).toEqual({ available: 90, held: 0, any: 90 });
  });

  it("requires paid grants for backlinks and makes the old wrapper replay-safe", async () => {
    const blocked = await rpc("meter_hold", {
      account_id: account,
      workspace_id: workspace,
      meter: "credits",
      action: "backlink_order",
      amount: 91,
      require_any: true,
      idempotency_key: "test:links:too-large",
    });
    expect(blocked).toMatchObject({ ok: false, code: "insufficient_balance" });
    const hold = await rpc("apply_credit_entry", {
      workspace_id: workspace,
      kind: "hold",
      idempotency_key: "order:11111111-1111-4111-8111-111111111111:hold",
      delta_available: -60,
      delta_held: 60,
      order_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(hold.ok).toBe(true);
    const capture = await rpc("apply_credit_entry", {
      workspace_id: workspace,
      kind: "capture",
      idempotency_key: "line:22222222-2222-4222-8222-222222222222:capture",
      delta_held: -60,
      order_id: "11111111-1111-4111-8111-111111111111",
      line_id: "22222222-2222-4222-8222-222222222222",
    });
    expect(capture.ok).toBe(true);
    expect(
      (
        await rpc("apply_credit_entry", {
          workspace_id: workspace,
          kind: "capture",
          idempotency_key: "line:22222222-2222-4222-8222-222222222222:capture",
          delta_held: -60,
          order_id: "11111111-1111-4111-8111-111111111111",
        })
      ).replayed,
    ).toBe(true);
  });

  it("enforces a brand cap using captured charges and live holds", async () => {
    const charges = await db.query<{ used: string }>(
      `select coalesce(sum(amount),0) as used from public.billing_charges where workspace_id=$1 and meter='credits'`,
      [workspace],
    );
    const used = Number(charges.rows[0].used);
    await db.query(`update public.workspaces set monthly_credit_cap=$2 where id=$1`, [
      workspace,
      used + 5,
    ]);
    const blocked = await rpc("meter_hold", {
      account_id: account,
      workspace_id: workspace,
      meter: "credits",
      action: "post_set",
      amount: 6,
      idempotency_key: "test:brand-cap:blocked",
    });
    expect(blocked).toMatchObject({ ok: false, code: "brand_cap" });
    await db.query(`update public.workspaces set monthly_credit_cap=null where id=$1`, [workspace]);
  });

  it("expires only unheld units and releases an abandoned simple hold", async () => {
    const grant = await rpc("meter_grant", {
      account_id: account,
      meter: "pro_messages",
      source: "plan",
      restriction: "ai_only",
      amount: 10,
      expires_at: "2020-01-01T00:00:00Z",
      idempotency_key: "test:expired:1",
    });
    expect(grant.ok).toBe(true);
    const expired = await db.query<{ count: number }>(`select public.meter_expire_due() as count`);
    expect(expired.rows[0].count).toBeGreaterThan(0);
    const pro = await db.query<{ available: string }>(
      `select available from public.meter_balances where account_id=$1 and meter='pro_messages'`,
      [account],
    );
    expect(Number(pro.rows[0].available)).toBe(0);

    await rpc("meter_grant", {
      account_id: account,
      meter: "video",
      source: "pack",
      restriction: "any",
      amount: 40,
      idempotency_key: "test:video:pack",
    });
    const hold = await rpc("meter_hold", {
      account_id: account,
      workspace_id: workspace,
      meter: "video",
      action: "simple_video_test",
      amount: 10,
      expires_at: "2020-01-01T00:00:00Z",
      idempotency_key: "test:video:hold",
    });
    expect(hold.ok).toBe(true);
    const sweep = await db.query<{ count: number }>(
      `select public.meter_release_expired_holds() as count`,
    );
    expect(sweep.rows[0].count).toBe(1);
    const video = await db.query<{ available: string; held: string }>(
      `select available,held from public.meter_balances where account_id=$1 and meter='video'`,
      [account],
    );
    expect(Number(video.rows[0].available)).toBe(40);
    expect(Number(video.rows[0].held)).toBe(0);
  });

  it("turns a spent pack refund into debt and pays it from the next grant", async () => {
    const first = await rpc("meter_grant", {
      account_id: account,
      meter: "flash_messages",
      source: "pack",
      restriction: "any",
      amount: 10,
      idempotency_key: "test:flash:pack",
    });
    const hold = await rpc("meter_hold", {
      account_id: account,
      meter: "flash_messages",
      action: "chat",
      amount: 10,
      idempotency_key: "test:flash:hold",
    });
    expect(
      (
        await rpc("meter_capture", {
          account_id: account,
          hold_id: hold.id,
          idempotency_key: "test:flash:capture",
        })
      ).ok,
    ).toBe(true);
    const clawback = await rpc("meter_clawback", {
      account_id: account,
      grant_id: first.grant_id,
      amount: 10,
      idempotency_key: "test:flash:refund",
    });
    expect(clawback).toMatchObject({ ok: true, available: 0, debt: 10 });
    expect(
      (
        await rpc("meter_hold", {
          account_id: account,
          meter: "flash_messages",
          action: "chat",
          amount: 1,
          idempotency_key: "test:flash:blocked",
        })
      ).code,
    ).toBe("debt");
    const next = await rpc("meter_grant", {
      account_id: account,
      meter: "flash_messages",
      source: "plan",
      restriction: "ai_only",
      amount: 13,
      idempotency_key: "test:flash:next",
    });
    expect(next).toMatchObject({ ok: true, available: 3, debt: 0 });
  });

  it("rolls one annual plan window once with a one-month cap", async () => {
    const other = await db.query<{ id: string }>(`select public.ensure_billing_account($1) as id`, [
      OTHER,
    ]);
    const otherAccount = other.rows[0].id;
    await rpc("meter_grant", {
      account_id: otherAccount,
      meter: "credits",
      source: "plan",
      restriction: "ai_only",
      amount: 80,
      period_start: "2030-01-01T00:00:00Z",
      expires_at: "2030-02-01T00:00:00Z",
      idempotency_key: "test:annual:jan",
    });
    const rolled = await rpc("meter_rollover", {
      account_id: otherAccount,
      meter: "credits",
      window_start: "2030-02-01T00:00:00Z",
      cap: 50,
    });
    expect(rolled).toMatchObject({ ok: true, replayed: false, rolled: 50 });
    const again = await rpc("meter_rollover", {
      account_id: otherAccount,
      meter: "credits",
      window_start: "2030-02-01T00:00:00Z",
      cap: 50,
    });
    expect(again.replayed).toBe(true);
    const balance = await db.query<{ available: string }>(
      `select available from public.meter_balances where account_id=$1 and meter='credits'`,
      [otherAccount],
    );
    expect(Number(balance.rows[0].available)).toBe(50);
    const grants = await db.query<{ source: string; remaining: string }>(
      `select source,remaining from public.meter_grants where account_id=$1 order by created_at,id`,
      [otherAccount],
    );
    expect(grants.rows.some((g) => g.source === "rollover" && Number(g.remaining) === 50)).toBe(
      true,
    );
  });

  it("keeps the ledger immutable and billing account ids hidden from members", async () => {
    await expect(
      db.query(`delete from public.meter_ledger where account_id=$1`, [account]),
    ).rejects.toThrow(/append-only/);
    await as(EDITOR, async () => {
      await expect(
        db.query(`select billing_account_id from public.workspaces where id=$1`, [workspace]),
      ).rejects.toThrow();
    });
    await as(EDITOR, async () => {
      const own = await db.query(`select * from public.meter_grants where account_id=$1`, [
        account,
      ]);
      expect(own.rows).toHaveLength(0);
    });
    await as(OTHER, async () => {
      const rows = await db.query(`select * from public.billing_accounts where id=$1`, [account]);
      expect(rows.rows).toHaveLength(0);
    });
  });
});
