// Entitlement overrides, against the real migration baseline in PGlite.
// Proves: shape and range rules hold in the database, a workspace can only be
// targeted under its own billing account, a newer override replaces the open
// one, an ended override cannot be ended again, every change writes its audit
// row in the same step, and customers cannot reach any of it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error — plain .mjs helper shared with scripts/db-baseline.mjs
import { createMigratedDb } from "../../scripts/db/pglite-supabase.mjs";

const STAFF = "b1111111-1111-4111-8111-111111111111";
const OWNER_A = "b2222222-2222-4222-8222-222222222222";
const OWNER_B = "b3333333-3333-4333-8333-333333333333";

let db: PGlite;
let accountA: string;
let accountB: string;
let wsA: string;
let wsB: string;
let seq = 0;

const meta = () => [`req-${++seq}`, "203.0.113.9", "vitest"];
const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();

async function create(args: {
  account?: string;
  workspace?: string | null;
  kind?: string;
  key?: string;
  allowed?: boolean | null;
  limit?: number | null;
  starts?: string | null;
  expires?: string | null;
  reason?: string;
}) {
  const a = {
    account: accountA,
    workspace: null,
    kind: "feature",
    key: "ugc",
    allowed: true,
    limit: null,
    starts: null,
    expires: null,
    reason: "Partner pilot for the quarter",
    ...args,
  };
  const { rows } = await db.query<{ r: { id: string; revoked_at: string | null } }>(
    `select public.admin_override_create($1,'operations',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) as r`,
    [
      STAFF,
      a.account,
      a.workspace,
      a.kind,
      a.key,
      a.allowed,
      a.limit,
      a.starts,
      a.expires,
      a.reason,
      ...meta(),
    ],
  );
  return rows[0].r;
}

async function revoke(id: string, reason = "Pilot is over, removing it") {
  const { rows } = await db.query<{ r: { id: string } }>(
    `select public.admin_override_revoke($1,'operations',$2,$3,$4,$5,$6) as r`,
    [STAFF, id, reason, ...meta()],
  );
  return rows[0].r;
}

async function actions(): Promise<string[]> {
  const { rows } = await db.query<{ action: string }>(
    `select action from public.admin_audit_log order by created_at, id`,
  );
  return rows.map((r) => r.action);
}

beforeAll(async () => {
  db = await createMigratedDb();
  for (const [id, email] of [
    [STAFF, "staff@mellox.test"],
    [OWNER_A, "a@example.com"],
    [OWNER_B, "b@example.com"],
  ]) {
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
  }
  const mk = async (owner: string, name: string) => {
    const {
      rows: [row],
    } = await db.query<{ id: string; billing_account_id: string }>(
      `insert into public.workspaces (owner_id, name) values ($1, $2) returning id, billing_account_id`,
      [owner, name],
    );
    return row;
  };
  const a = await mk(OWNER_A, "Brand A");
  const b = await mk(OWNER_B, "Brand B");
  wsA = a.id;
  accountA = a.billing_account_id;
  wsB = b.id;
  accountB = b.billing_account_id;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("creating overrides", () => {
  it("stores a feature override for the account and audits it", async () => {
    const before = (await actions()).length;
    const row = await create({ key: "ugc", allowed: true, expires: inDays(30) });
    const {
      rows: [stored],
    } = await db.query<{
      kind: string;
      allowed: boolean;
      workspace_id: string | null;
      created_by: string;
    }>(
      `select kind, allowed, workspace_id, created_by from public.entitlement_overrides where id = $1`,
      [row.id],
    );
    expect(stored).toMatchObject({
      kind: "feature",
      allowed: true,
      workspace_id: null,
      created_by: STAFF,
    });
    const all = await actions();
    expect(all).toHaveLength(before + 1);
    expect(all.at(-1)).toBe("entitlement.override_created");
  });

  it("stores a workspace-scoped limit override", async () => {
    const row = await create({
      workspace: wsA,
      kind: "limit",
      key: "trackedPrompts",
      allowed: null,
      limit: 250,
    });
    const {
      rows: [stored],
    } = await db.query<{ workspace_id: string; limit_value: number }>(
      `select workspace_id, limit_value from public.entitlement_overrides where id = $1`,
      [row.id],
    );
    expect(stored).toEqual({ workspace_id: wsA, limit_value: 250 });
    const {
      rows: [audit],
    } = await db.query<{ target_type: string; target_id: string; workspace_id: string }>(
      `select target_type, target_id, workspace_id from public.admin_audit_log
        where action = 'entitlement.override_created' order by created_at desc, id desc limit 1`,
    );
    expect(audit).toEqual({ target_type: "workspace", target_id: wsA, workspace_id: wsA });
  });

  it("will not target a workspace under another billing account", async () => {
    await expect(create({ account: accountA, workspace: wsB })).rejects.toThrow(/does not belong/);
  });

  it("will not target an account that does not exist", async () => {
    await expect(create({ account: "99999999-9999-4999-8999-999999999999" })).rejects.toThrow(
      /No such billing account/,
    );
  });

  it("needs a real reason", async () => {
    await expect(create({ key: "autopilot", reason: "short" })).rejects.toThrow(/reason/);
    await expect(create({ key: "autopilot", reason: "         " })).rejects.toThrow(/reason/);
  });

  it("refuses an end date in the past or before the start", async () => {
    await expect(create({ key: "audience", expires: inDays(-1) })).rejects.toThrow(/future/);
    await expect(
      create({ key: "audience", starts: inDays(10), expires: inDays(5) }),
    ).rejects.toThrow(/future and after the start/);
  });

  it("keeps the value shape: a feature has allowed, a limit has a number", async () => {
    await expect(create({ key: "audience", allowed: null })).rejects.toThrow();
    await expect(
      create({ kind: "limit", key: "competitors", allowed: true, limit: 5 }),
    ).rejects.toThrow();
    await expect(
      create({ kind: "limit", key: "competitors", allowed: null, limit: null }),
    ).rejects.toThrow();
  });

  it("keeps limits in range", async () => {
    await expect(
      create({ kind: "limit", key: "competitors", allowed: null, limit: -1 }),
    ).rejects.toThrow();
    await expect(
      create({ kind: "limit", key: "competitors", allowed: null, limit: 1_000_001 }),
    ).rejects.toThrow();
    const ok = await create({ kind: "limit", key: "competitors", allowed: null, limit: 0 });
    expect(ok.id).toBeTruthy();
  });

  it("refuses a malformed key and an unknown kind", async () => {
    await expect(create({ key: "bad key!" })).rejects.toThrow();
    await expect(create({ kind: "plan" })).rejects.toThrow(/Invalid override kind/);
  });
});

describe("replacing and ending", () => {
  it("a newer override for the same target ends the open one", async () => {
    const first = await create({ key: "campaigns", allowed: true });
    const second = await create({ key: "campaigns", allowed: false });
    expect(second.id).not.toBe(first.id);

    const { rows } = await db.query<{
      id: string;
      revoked_at: string | null;
      revoke_reason: string | null;
    }>(
      `select id, revoked_at, revoke_reason from public.entitlement_overrides
        where account_id = $1 and workspace_id is null and key = 'campaigns' order by created_at`,
      [accountA],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].revoked_at).not.toBeNull();
    expect(rows[0].revoke_reason).toMatch(/Replaced/);
    expect(rows[1].revoked_at).toBeNull();

    const {
      rows: [audit],
    } = await db.query<{ before_state: { replaced: string } | null }>(
      `select before_state from public.admin_audit_log
        where action = 'entitlement.override_created' order by created_at desc, id desc limit 1`,
    );
    expect(audit.before_state?.replaced).toBe(first.id);
  });

  it("the database allows only one open override per target", async () => {
    await create({ key: "approvals", allowed: true });
    await expect(
      db.query(
        `insert into public.entitlement_overrides (account_id, kind, key, allowed, reason, created_by)
         values ($1, 'feature', 'approvals', false, 'a second open one', $2)`,
        [accountA, STAFF],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it("an account-wide and a workspace override on one key can both be open", async () => {
    await create({ key: "experiments", allowed: true });
    const ws = await create({ key: "experiments", allowed: false, workspace: wsA });
    expect(ws.id).toBeTruthy();
  });

  it("ends an override, keeps the row, and audits who and why", async () => {
    const row = await create({ key: "backlinks", allowed: true });
    await revoke(row.id, "Pilot is over, removing it");
    const {
      rows: [stored],
    } = await db.query<{ revoked_at: string; revoked_by: string; revoke_reason: string }>(
      `select revoked_at, revoked_by, revoke_reason from public.entitlement_overrides where id = $1`,
      [row.id],
    );
    expect(stored.revoked_by).toBe(STAFF);
    expect(stored.revoke_reason).toBe("Pilot is over, removing it");
    expect((await actions()).at(-1)).toBe("entitlement.override_revoked");
  });

  it("cannot end an override twice, or one that does not exist", async () => {
    const row = await create({ key: "client_portal", allowed: true });
    await revoke(row.id);
    await expect(revoke(row.id)).rejects.toThrow(/already ended/);
    await expect(revoke("99999999-9999-4999-8999-999999999999")).rejects.toThrow(
      /No such override/,
    );
    await expect(revoke(row.id, "no")).rejects.toThrow(/reason/);
  });

  it("an ended key can be set again", async () => {
    const row = await create({ key: "white_label", allowed: true });
    await revoke(row.id);
    const again = await create({ key: "white_label", allowed: false });
    expect(again.id).not.toBe(row.id);
  });
});

describe("account isolation", () => {
  it("overrides for one account never appear under another", async () => {
    await create({ account: accountB, key: "market_brain", allowed: true });
    const { rows } = await db.query<{ account_id: string }>(
      `select account_id from public.entitlement_overrides where key = 'market_brain'`,
    );
    expect(rows.map((r) => r.account_id)).toEqual([accountB]);
  });

  it("deleting a workspace removes its overrides", async () => {
    const {
      rows: [tmp],
    } = await db.query<{ id: string; billing_account_id: string }>(
      `insert into public.workspaces (owner_id, name) values ($1, 'Temp') returning id, billing_account_id`,
      [OWNER_B],
    );
    const row = await create({ account: tmp.billing_account_id, workspace: tmp.id, key: "ugc" });
    await db.query(`delete from public.workspaces where id = $1`, [tmp.id]);
    const { rows } = await db.query(`select 1 from public.entitlement_overrides where id = $1`, [
      row.id,
    ]);
    expect(rows).toHaveLength(0);
  });
});

describe("who can reach it", () => {
  async function asRole<T>(role: string, fn: () => Promise<T>): Promise<T> {
    await db.exec(`set role ${role}`);
    try {
      return await fn();
    } finally {
      await db.exec("reset role");
    }
  }

  it.each(["anon", "authenticated"])("%s cannot read or call anything", async (role) => {
    await expect(
      asRole(role, () => db.query(`select * from public.entitlement_overrides`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asRole(role, () =>
        db.query(
          `select public.admin_override_revoke($1,'x','99999999-9999-4999-8999-999999999999','a good reason',null,null,null)`,
          [STAFF],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
