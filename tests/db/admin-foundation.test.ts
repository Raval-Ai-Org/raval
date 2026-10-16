// Admin console foundation, against the real migration baseline in PGlite.
// Proves the guarantees the console relies on: the audit trail cannot be
// edited, a change and its audit row happen together, nobody edits their own
// access or removes the last super admin, and a customer's role can neither
// read the admin tables nor call the admin functions.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error — plain .mjs helper shared with scripts/db-baseline.mjs
import { createMigratedDb } from "../../scripts/db/pglite-supabase.mjs";

const ROOT = "a1111111-1111-4111-8111-111111111111"; // acts as the first super admin
const SECOND = "a2222222-2222-4222-8222-222222222222";
const SUPPORT = "a3333333-3333-4333-8333-333333333333";
const CUSTOMER = "c4444444-4444-4444-8444-444444444444";
const OTHER = "c5555555-5555-4555-8555-555555555555";

let db: PGlite;
let seq = 0;

const meta = () => [`req-${++seq}`, "203.0.113.7", "vitest"];

async function saveAdmin(
  actor: string,
  user: string,
  role: string,
  status = "active",
  extra: string[] = [],
  denied: string[] = [],
) {
  const { rows } = await db.query<{ r: Record<string, unknown> }>(
    `select public.admin_team_save($1,'super_admin',$2,$3,$4,$5,$6,null,'a good reason',$7,$8,$9) as r`,
    [actor, user, role, status, extra, denied, ...meta()],
  );
  return rows[0].r;
}

async function auditActions(): Promise<string[]> {
  const { rows } = await db.query<{ action: string }>(
    `select action from public.admin_audit_log order by created_at, id`,
  );
  return rows.map((r) => r.action);
}

beforeAll(async () => {
  db = await createMigratedDb();
  for (const [id, email] of [
    [ROOT, "root@mellox.test"],
    [SECOND, "second@mellox.test"],
    [SUPPORT, "support@mellox.test"],
    [CUSTOMER, "Customer.One@example.com"],
    [OTHER, "other_person@example.com"],
  ]) {
    await db.query(
      `insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`,
      [id, email],
    );
  }
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("audit trail", () => {
  it("cannot be edited or deleted, even by the service role", async () => {
    await db.query(
      `insert into public.admin_audit_log (actor_user_id, action) values ($1, 'test.row')`,
      [ROOT],
    );
    await expect(
      db.query(`update public.admin_audit_log set action = 'forged' where action = 'test.row'`),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.query(`delete from public.admin_audit_log where action = 'test.row'`),
    ).rejects.toThrow(/append-only/);
  });
});

describe("team changes", () => {
  it("adds an admin and writes the audit row in the same step", async () => {
    const before = (await auditActions()).length;
    const row = await saveAdmin(ROOT, SECOND, "super_admin");
    expect(row.role).toBe("super_admin");
    const actions = await auditActions();
    expect(actions).toHaveLength(before + 1);
    expect(actions.at(-1)).toBe("admin.added");

    await saveAdmin(ROOT, SUPPORT, "support", "active", ["audit.read"], ["users.pii.read"]);
    const {
      rows: [stored],
    } = await db.query<{ extra_permissions: string[]; denied_permissions: string[] }>(
      `select extra_permissions, denied_permissions from public.admin_users where user_id = $1`,
      [SUPPORT],
    );
    expect(stored.extra_permissions).toEqual(["audit.read"]);
    expect(stored.denied_permissions).toEqual(["users.pii.read"]);
  });

  it("records before and after when an admin is changed", async () => {
    await saveAdmin(ROOT, SUPPORT, "operations");
    const {
      rows: [entry],
    } = await db.query<{
      action: string;
      before_state: { role: string };
      after_state: { role: string };
    }>(
      `select action, before_state, after_state from public.admin_audit_log
        where action = 'admin.changed' and target_id = $1 order by created_at desc limit 1`,
      [SUPPORT],
    );
    expect(entry.before_state.role).toBe("support");
    expect(entry.after_state.role).toBe("operations");
  });

  it("refuses to change your own access", async () => {
    await expect(saveAdmin(ROOT, ROOT, "analyst")).rejects.toThrow(/own admin access/);
  });

  it("refuses a role or status that does not exist", async () => {
    await expect(saveAdmin(ROOT, OTHER, "wizard")).rejects.toThrow();
    await expect(saveAdmin(ROOT, OTHER, "analyst", "banished")).rejects.toThrow(/Invalid status/);
  });

  it("refuses a user that does not exist", async () => {
    await expect(
      saveAdmin(ROOT, "99999999-9999-4999-8999-999999999999", "analyst"),
    ).rejects.toThrow(/No such user/);
  });

  it("keeps at least one active super admin", async () => {
    // ROOT acts, SECOND is the other super admin: demoting SECOND is fine only
    // while someone else stays. ROOT is not in the table, so SECOND is the last.
    await expect(saveAdmin(ROOT, SECOND, "analyst")).rejects.toThrow(
      /at least one active super admin/,
    );
    await expect(saveAdmin(ROOT, SECOND, "super_admin", "disabled")).rejects.toThrow(
      /at least one active super admin/,
    );
    // With a second one in the table, the first can be demoted.
    await saveAdmin(SECOND, SUPPORT, "super_admin");
    await saveAdmin(SUPPORT, SECOND, "analyst");
    const { rows } = await db.query<{ role: string }>(
      `select role from public.admin_users where user_id = $1`,
      [SECOND],
    );
    expect(rows[0].role).toBe("analyst");
  });
});

describe("customer suspension", () => {
  async function suspend(actor: string, user: string, on: boolean) {
    const { rows } = await db.query<{ r: { suspended: boolean; sessions_ended: number } }>(
      `select public.admin_user_set_suspended($1,'operations',$2,$3,'a good reason',$4,$5,$6) as r`,
      [actor, user, on, ...meta()],
    );
    return rows[0].r;
  }

  it("bans, ends sessions, and audits; then restores", async () => {
    await db.query(`insert into auth.sessions (user_id) values ($1), ($1)`, [CUSTOMER]);
    const result = await suspend(ROOT, CUSTOMER, true);
    expect(result).toEqual({ suspended: true, sessions_ended: 2 });

    const {
      rows: [user],
    } = await db.query<{ banned: boolean }>(
      `select banned_until > now() + interval '10 years' as banned from auth.users where id = $1`,
      [CUSTOMER],
    );
    expect(user.banned).toBe(true);
    const { rows: left } = await db.query(`select 1 from auth.sessions where user_id = $1`, [
      CUSTOMER,
    ]);
    expect(left).toHaveLength(0);
    expect(await auditActions()).toContain("user.suspended");

    const restored = await suspend(ROOT, CUSTOMER, false);
    expect(restored.suspended).toBe(false);
    const {
      rows: [after],
    } = await db.query<{ banned_until: string | null }>(
      `select banned_until from auth.users where id = $1`,
      [CUSTOMER],
    );
    expect(after.banned_until).toBeNull();
    expect(await auditActions()).toContain("user.unsuspended");
  });

  it("will not suspend yourself, an active admin, or a stranger", async () => {
    await expect(suspend(CUSTOMER, CUSTOMER, true)).rejects.toThrow(/your own account/);
    await expect(suspend(ROOT, SUPPORT, true)).rejects.toThrow(/admin team/);
    await expect(suspend(ROOT, "99999999-9999-4999-8999-999999999999", true)).rejects.toThrow(
      /No such user/,
    );
  });

  it("signs a person out everywhere and says how many", async () => {
    await db.query(`insert into auth.sessions (user_id) values ($1), ($1), ($1)`, [OTHER]);
    const {
      rows: [row],
    } = await db.query<{ r: { sessions_ended: number } }>(
      `select public.admin_user_revoke_sessions($1,'operations',$2,'a good reason',$3,$4,$5) as r`,
      [ROOT, OTHER, ...meta()],
    );
    expect(row.r.sessions_ended).toBe(3);
    expect(await auditActions()).toContain("user.sessions_revoked");
  });
});

describe("notes", () => {
  it("are saved with an audit row that holds no text, and cannot be edited", async () => {
    const {
      rows: [row],
    } = await db.query<{ r: { id: string } }>(
      `select public.admin_user_add_note($1,'support',$2,'  Customer asked for a refund.  ',$3,$4,$5) as r`,
      [ROOT, CUSTOMER, ...meta()],
    );
    const {
      rows: [note],
    } = await db.query<{ body: string }>(`select body from public.admin_user_notes where id = $1`, [
      row.r.id,
    ]);
    expect(note.body).toBe("Customer asked for a refund.");

    const {
      rows: [audit],
    } = await db.query<{ after_state: Record<string, unknown> }>(
      `select after_state from public.admin_audit_log where action = 'user.note_added' order by created_at desc limit 1`,
    );
    expect(JSON.stringify(audit.after_state)).not.toContain("refund");
    expect(audit.after_state.length).toBe("Customer asked for a refund.".length);

    await expect(
      db.query(`update public.admin_user_notes set body = 'x' where id = $1`, [row.r.id]),
    ).rejects.toThrow(/append-only/);
  });
});

describe("directory reads", () => {
  type Directory = { total: number; rows: Array<{ id: string; email: string; is_admin: boolean }> };
  async function users(search: string, filter = "all", limit = 25, offset = 0) {
    const { rows } = await db.query<{ r: Directory }>(
      `select public.admin_user_directory($1,$2,'created',$3,$4) as r`,
      [search, filter, limit, offset],
    );
    return rows[0].r;
  }

  it("finds a user by part of an email, ignoring case", async () => {
    const result = await users("customer.one");
    expect(result.rows.map((r) => r.id)).toEqual([CUSTOMER]);
  });

  it("finds a user by exact id", async () => {
    expect((await users(OTHER)).rows.map((r) => r.id)).toEqual([OTHER]);
  });

  it("treats % and _ as plain characters", async () => {
    expect((await users("%")).total).toBe(0);
    expect((await users("other_person")).rows).toHaveLength(1);
    expect((await users("other-person")).rows).toHaveLength(0);
  });

  it("filters, counts the full total, and pages", async () => {
    const all = await users("");
    expect(all.total).toBe(5);
    const page = await users("", "all", 2, 0);
    expect(page.total).toBe(5);
    expect(page.rows).toHaveLength(2);
    const next = await users("", "all", 2, 2);
    expect(next.rows.map((r) => r.id)).not.toEqual(page.rows.map((r) => r.id));

    const admins = await users("", "admins");
    expect(admins.rows.every((r) => r.is_admin)).toBe(true);
    expect(admins.total).toBeGreaterThan(0);
  });

  it("caps an oversized page request", async () => {
    const result = await users("", "all", 100_000, 0);
    expect(result.rows.length).toBeLessThanOrEqual(100);
  });

  it("lists workspaces with owner and member counts", async () => {
    const {
      rows: [workspace],
    } = await db.query<{ id: string }>(
      `insert into public.workspaces (owner_id, name) values ($1, 'Acme Bakery') returning id`,
      [CUSTOMER],
    );
    await db.query(
      `insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')
       on conflict do nothing`,
      [workspace.id, CUSTOMER],
    );
    const {
      rows: [dir],
    } = await db.query<{
      r: { total: number; rows: Array<{ id: string; owner_email: string; member_count: number }> };
    }>(`select public.admin_workspace_directory('bakery','all',25,0) as r`);
    expect(dir.r.total).toBe(1);
    expect(dir.r.rows[0]).toMatchObject({
      id: workspace.id,
      owner_email: "Customer.One@example.com",
    });
    expect(Number(dir.r.rows[0].member_count)).toBeGreaterThanOrEqual(1);

    const {
      rows: [members],
    } = await db.query<{ r: Array<{ user_id: string; email: string }> }>(
      `select public.admin_workspace_members($1) as r`,
      [workspace.id],
    );
    expect(members.r.map((m) => m.user_id)).toContain(CUSTOMER);
  });

  it("returns real overview counts", async () => {
    const {
      rows: [row],
    } = await db.query<{
      r: { users: { total: number; suspended: number }; admins: { active: number } };
    }>(`select public.admin_overview() as r`);
    expect(row.r.users.total).toBe(5);
    expect(row.r.users.suspended).toBe(0);
    expect(row.r.admins.active).toBeGreaterThanOrEqual(2);
  });

  it("looks up emails in a batch", async () => {
    const { rows } = await db.query<{ id: string; email: string }>(
      `select * from public.admin_emails_for(array[$1,$2]::uuid[])`,
      [ROOT, OTHER],
    );
    expect(rows.map((r) => r.email).sort()).toEqual([
      "other_person@example.com",
      "root@mellox.test",
    ]);
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

  it.each(["anon", "authenticated"])("%s cannot read the admin tables", async (role) => {
    for (const table of ["admin_users", "admin_audit_log", "admin_user_notes"]) {
      await expect(asRole(role, () => db.query(`select * from public.${table}`))).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it.each(["anon", "authenticated"])("%s cannot call the admin functions", async (role) => {
    await expect(asRole(role, () => db.query(`select public.admin_overview()`))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asRole(role, () =>
        db.query(`select public.admin_user_directory('', 'all', 'created', 5, 0)`),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("the service role can", async () => {
    await asRole("service_role", async () => {
      const { rows } = await db.query(`select public.admin_overview() as r`);
      expect(rows).toHaveLength(1);
    });
  });
});
