// The later admin migrations (operations, flags and announcements, insight, AI
// controls, workspace access, jobs and abuse), against the real migration
// baseline in PGlite. plpgsql bodies are only checked when they run, so this
// calls every function: it proves each one executes, writes its audit row in
// the same transaction, refuses a missing reason, and that a customer's role
// can neither read the new tables nor call the functions.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error — plain .mjs helper shared with scripts/db-baseline.mjs
import { createMigratedDb } from "../../scripts/db/pglite-supabase.mjs";

const ADMIN = "a1111111-1111-4111-8111-111111111111";
const OWNER = "c4444444-4444-4444-8444-444444444444";
const OTHER = "c5555555-5555-4555-8555-555555555555";
const REASON = "A perfectly good reason for this";

let db: PGlite;
let ws: string;
let seq = 0;
const meta = () => [`req-${++seq}`, "203.0.113.7", "vitest"];

async function actions(like: string): Promise<string[]> {
  const { rows } = await db.query<{ action: string }>(
    `select action from public.admin_audit_log where action like $1 order by created_at, id`,
    [like],
  );
  return rows.map((r) => r.action);
}

beforeAll(async () => {
  db = await createMigratedDb();
  for (const [id, email] of [
    [ADMIN, "admin@mellox.test"],
    [OWNER, "owner@bigcorp.test"],
    [OTHER, "other@bigcorp.test"],
  ]) {
    await db.query(
      `insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`,
      [id, email],
    );
  }
  const {
    rows: [w],
  } = await db.query<{ id: string }>(
    `insert into public.workspaces (owner_id, name) values ($1, 'Acme Bakery') returning id`,
    [OWNER],
  );
  ws = w.id;
  await db.query(
    `insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')
       on conflict do nothing`,
    [ws, OWNER],
  );
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("emergency switches", () => {
  it("seeds the four switches, engaged off", async () => {
    const { rows } = await db.query<{ key: string; engaged: boolean }>(
      `select key, engaged from public.platform_switches order by key`,
    );
    expect(rows.map((r) => r.key)).toEqual(["ai_image", "ai_search", "ai_text", "ai_video"]);
    expect(rows.every((r) => !r.engaged)).toBe(true);
  });

  it("flips one with an audit row, and refuses without a reason", async () => {
    await db.query(`select public.admin_switch_set($1,'operations','ai_image',true,$2,$3,$4,$5)`, [
      ADMIN,
      REASON,
      ...meta(),
    ]);
    const { rows } = await db.query<{ engaged: boolean }>(
      `select engaged from public.platform_switches where key = 'ai_image'`,
    );
    expect(rows[0].engaged).toBe(true);
    expect(await actions("switch.%")).toEqual(["switch.engaged"]);
    await expect(
      db.query(
        `select public.admin_switch_set($1,'operations','ai_image',false,'short',$2,$3,$4)`,
        [ADMIN, ...meta()],
      ),
    ).rejects.toThrow(/reason/);
    await expect(
      db.query(`select public.admin_switch_set($1,'operations','nope',true,$2,$3,$4,$5)`, [
        ADMIN,
        REASON,
        ...meta(),
      ]),
    ).rejects.toThrow();
  });
});

describe("health and usage reads", () => {
  it("run on an empty database", async () => {
    const { rows } = await db.query<{
      h: { studio: Record<string, number> };
      u: { totals: object };
    }>(`select public.admin_health() as h, public.admin_usage(7) as u`);
    expect(rows[0].h.studio).toMatchObject({ queued: 0, running: 0 });
    expect(rows[0].u.totals).toBeTruthy();
  });
});

describe("flags", () => {
  const save = (key: string, enabled: boolean, rollout: number, reason = REASON) =>
    db.query<{ r: { key: string; enabled: boolean } }>(
      `select public.admin_flag_save($1,'engineering',$2,'desc',$3,$4,$5::uuid[],null,$6,$7,$8,$9) as r`,
      [ADMIN, key, enabled, rollout, [ws], reason, ...meta()],
    );

  it("creates then updates a flag, auditing both", async () => {
    await save("new-editor", true, 25);
    await save("new-editor", false, 50);
    const { rows } = await db.query<{ enabled: boolean; rollout_percent: number }>(
      `select enabled, rollout_percent from public.platform_flags where key = 'new-editor'`,
    );
    expect(rows[0]).toEqual({ enabled: false, rollout_percent: 50 });
    expect(await actions("flag.%")).toEqual(["flag.created", "flag.updated"]);
  });

  it("refuses a bad key, a bad percentage and a missing reason", async () => {
    await expect(save("Bad Key", true, 10)).rejects.toThrow();
    await expect(save("ok-flag", true, 101)).rejects.toThrow();
    await expect(save("ok-flag", true, 10, "short")).rejects.toThrow(/reason/);
  });
});

describe("announcements", () => {
  const save = (id: string | null, title: string, active: boolean, endsAt: string | null) =>
    db.query<{ r: { id: string } }>(
      `select public.admin_announcement_save($1,'operations',$2,$3,'body','info',null,true,$4,null,$5,$6,$7,$8,$9) as r`,
      [ADMIN, id, title, active, endsAt, REASON, ...meta()],
    );

  it("creates and edits one, auditing the id and state but not the text", async () => {
    const created = await save(null, "Maintenance Saturday", true, null);
    await save(created.rows[0].r.id, "Maintenance Sunday", false, null);
    expect(await actions("announcement.%")).toEqual([
      "announcement.created",
      "announcement.updated",
    ]);
    const { rows } = await db.query<{ after_state: Record<string, unknown> }>(
      `select after_state from public.admin_audit_log where action = 'announcement.created'`,
    );
    expect(JSON.stringify(rows[0].after_state)).not.toMatch(/Maintenance/);
  });

  it("rejects an end before the start and a non-https link", async () => {
    await expect(save(null, "Bad window", true, "2000-01-01T00:00:00Z")).rejects.toThrow();
    await expect(
      db.query(
        `select public.admin_announcement_save($1,'operations',null,'t','','info','http://x.test',true,true,null,null,$2,$3,$4,$5)`,
        [ADMIN, REASON, ...meta()],
      ),
    ).rejects.toThrow();
  });

  it("lets a signed-in customer read only live announcements", async () => {
    await db.query(
      `insert into public.platform_announcements (title, active) values ('Live one', true), ('Hidden one', false)`,
    );
    await db.query(`set role authenticated`);
    try {
      const { rows } = await db.query<{ title: string }>(
        `select title from public.platform_announcements order by title`,
      );
      expect(rows.map((r) => r.title)).not.toContain("Hidden one");
      expect(rows.map((r) => r.title)).toContain("Live one");
    } finally {
      await db.query(`reset role`);
    }
  });
});

describe("insight reads", () => {
  it("analytics, integrations and lookup run", async () => {
    const { rows } = await db.query<{
      a: { funnel: { signed_up: number } };
      i: { social: unknown[] };
      byId: { workspaces: unknown[] };
      noEmail: { users: unknown[] };
      withEmail: { users: unknown[] };
    }>(
      `select public.admin_analytics(30) as a,
              public.admin_integrations() as i,
              public.admin_lookup($1, false) as "byId",
              public.admin_lookup('bigcorp', false) as "noEmail",
              public.admin_lookup('bigcorp', true) as "withEmail"`,
      [ws],
    );
    expect(rows[0].a.funnel.signed_up).toBeGreaterThan(0);
    expect(Array.isArray(rows[0].i.social)).toBe(true);
    expect(rows[0].byId.workspaces).toHaveLength(1);
    // Without permission to see emails, an email fragment finds nobody.
    expect(rows[0].noEmail.users).toHaveLength(0);
    expect(rows[0].withEmail.users.length).toBeGreaterThan(0);
  });
});

describe("AI controls", () => {
  it("sets and clears a routing override", async () => {
    const set = (models: string[] | null, effort: string | null) =>
      db.query(
        `select public.admin_route_override_set($1,'engineering','brand-extract',$2,$3,$4,$5,$6,$7)`,
        [ADMIN, models, effort, REASON, ...meta()],
      );
    await set(["google/gemini-3.1-flash-lite"], "low");
    let { rows } = await db.query(`select * from public.model_route_overrides`);
    expect(rows).toHaveLength(1);
    await set(null, null);
    ({ rows } = await db.query(`select * from public.model_route_overrides`));
    expect(rows).toHaveLength(0);
    expect(await actions("ai.route_override%")).toEqual([
      "ai.route_override_set",
      "ai.route_override_cleared",
    ]);
  });

  it("keeps one global cap and one cap per workspace, and removing clears it", async () => {
    const cap = (
      scope: string,
      workspace: string | null,
      daily: number | null,
      monthly: number | null,
    ) =>
      db.query(`select public.admin_spend_cap_set($1,'finance',$2,$3,$4,$5,$6,$7,$8,$9)`, [
        ADMIN,
        scope,
        workspace,
        daily,
        monthly,
        REASON,
        ...meta(),
      ]);
    await cap("global", null, 100, 2000);
    await cap("global", null, 150, 2000);
    await cap("workspace", ws, 10, null);
    let { rows } = await db.query<{ scope: string }>(
      `select scope from public.spend_caps order by scope`,
    );
    expect(rows.map((r) => r.scope)).toEqual(["global", "workspace"]);
    await cap("workspace", ws, null, null);
    ({ rows } = await db.query(`select scope from public.spend_caps`));
    expect(rows.map((r) => r.scope)).toEqual(["global"]);
    await expect(cap("workspace", "00000000-0000-4000-8000-000000000000", 5, null)).rejects.toThrow(
      /workspace/i,
    );
  });

  it("totals platform spend since a moment", async () => {
    await db.query(
      `insert into public.ai_usage_events (workspace_id, route, provider, model, est_cost_usd)
       values ($1, 'brand-extract', 'openrouter', 'google/gemini-3.8-flash', 1.25)`,
      [ws],
    );
    const { rows } = await db.query<{ s: string }>(
      `select public.platform_spend_since(now() - interval '1 hour') as s`,
    );
    expect(Number(rows[0].s)).toBeCloseTo(1.25);
  });
});

describe("workspace access and support views", () => {
  const setAccess = (mode: string) =>
    db.query(`select public.admin_workspace_set_access($1,'operations',$2,$3,$4,$5,$6,$7)`, [
      ADMIN,
      ws,
      mode,
      REASON,
      ...meta(),
    ]);

  it("restricts and restores a workspace, with no row meaning active", async () => {
    await setAccess("suspended");
    let { rows } = await db.query<{ mode: string }>(
      `select mode from public.workspace_access_state where workspace_id = $1`,
      [ws],
    );
    expect(rows[0].mode).toBe("suspended");
    await setAccess("read_only");
    await setAccess("active");
    ({ rows } = await db.query(`select mode from public.workspace_access_state`));
    expect(rows).toHaveLength(0);
    expect(await actions("workspace.access_%")).toEqual([
      "workspace.access_suspended",
      "workspace.access_read_only",
      "workspace.access_active",
    ]);
  });

  it("opens a support view that reads, audits every read, and ends", async () => {
    const start = await db.query<{ r: { session_id: string } }>(
      `select public.admin_view_start($1,'support',$2,$3,$4,$5,$6) as r`,
      [ADMIN, ws, REASON, ...meta()],
    );
    const session = start.rows[0].r.session_id;
    const read = (section: string, actor = ADMIN) =>
      db.query<{ r: { section: string; data: Record<string, unknown> } }>(
        `select public.admin_view_read($1,'support',$2,$3,$4,$5,$6) as r`,
        [actor, session, section, ...meta()],
      );
    for (const section of ["overview", "content", "accounts", "jobs"]) {
      const result = await read(section);
      expect(result.rows[0].r.section).toBe(section);
    }
    const overview = (await read("overview")).rows[0].r.data;
    expect(Object.keys(overview)).toEqual(
      expect.arrayContaining(["workspace", "members", "ai_30d"]),
    );
    // Only the allow-listed columns: no body text, brand data or tokens.
    expect(JSON.stringify(overview)).not.toMatch(/token|secret|password|brand_voice|body/i);
    expect((await actions("support_view.read")).length).toBe(5);

    // Another admin cannot use this session.
    await expect(read("overview", OTHER)).rejects.toThrow(/ended/);
    await expect(read("everything")).rejects.toThrow(/section/i);

    await db.query(`select public.admin_view_end($1,'support',$2,$3,$4,$5)`, [
      ADMIN,
      session,
      ...meta(),
    ]);
    await expect(read("overview")).rejects.toThrow(/ended/);
  });

  it("ends the previous view when a new one starts, and expires after 30 minutes", async () => {
    const open = async () =>
      (
        await db.query<{ r: { session_id: string } }>(
          `select public.admin_view_start($1,'support',$2,$3,$4,$5,$6) as r`,
          [ADMIN, ws, REASON, ...meta()],
        )
      ).rows[0].r.session_id;
    const first = await open();
    const second = await open();
    const { rows } = await db.query<{ id: string; ended_at: string | null }>(
      `select id, ended_at from public.admin_view_sessions where id in ($1, $2)`,
      [first, second],
    );
    expect(rows.find((r) => r.id === first)?.ended_at).not.toBeNull();
    expect(rows.find((r) => r.id === second)?.ended_at).toBeNull();

    await db.query(
      `update public.admin_view_sessions set expires_at = now() - interval '1 minute' where id = $1`,
      [second],
    );
    await expect(
      db.query(`select public.admin_view_read($1,'support',$2,'overview',$3,$4,$5)`, [
        ADMIN,
        second,
        ...meta(),
      ]),
    ).rejects.toThrow(/ended/);
  });
});

describe("jobs and abuse", () => {
  it("lists jobs across sources and flags a stuck one", async () => {
    await db.query(
      `insert into public.studio_jobs (workspace_id, type, status, idempotency_key, updated_at, created_at)
       values ($1, 'video', 'running', 'k-stuck', now() - interval '2 hours', now() - interval '3 hours'),
              ($1, 'carousel', 'failed', 'k-failed', now(), now())`,
      [ws],
    );
    const { rows } = await db.query<{
      r: {
        rows: Array<{ source: string; kind: string; stuck: boolean }>;
        counts: Array<{ source: string; stuck: number }>;
      };
    }>(`select public.admin_jobs('studio','all',25,0) as r`);
    const video = rows[0].r.rows.find((j) => j.kind === "video");
    expect(video?.stuck).toBe(true);
    expect(rows[0].r.counts.find((c) => c.source === "studio")?.stuck).toBe(1);

    const failed = await db.query<{ r: { total: number } }>(
      `select public.admin_jobs('all','failed',25,0) as r`,
    );
    expect(failed.rows[0].r.total).toBe(1);
  });

  it("finds a signup burst and ignores free mailbox providers", async () => {
    for (let i = 0; i < 6; i++) {
      await db.query(`insert into auth.users (id, email) values (gen_random_uuid(), $1)`, [
        `bot${i}@tempbox.test`,
      ]);
      await db.query(`insert into auth.users (id, email) values (gen_random_uuid(), $1)`, [
        `person${i}@gmail.com`,
      ]);
    }
    const { rows } = await db.query<{ r: { signup_bursts: Array<{ domain: string }> } }>(
      `select public.admin_abuse_signals() as r`,
    );
    const domains = rows[0].r.signup_bursts.map((b) => b.domain);
    expect(domains).toContain("tempbox.test");
    expect(domains).not.toContain("gmail.com");
  });
});

describe("who may call the new functions and read the new tables", () => {
  const tables = [
    "platform_switches",
    "platform_flags",
    "model_route_overrides",
    "spend_caps",
    "workspace_access_state",
    "admin_view_sessions",
  ];

  it("keeps a customer's role out of the admin tables", async () => {
    await db.query(`set role authenticated`);
    try {
      for (const table of tables) {
        await expect(db.query(`select * from public.${table}`), table).rejects.toThrow(
          /permission denied/,
        );
      }
    } finally {
      await db.query(`reset role`);
    }
  });

  it("keeps a customer's role from calling the functions", async () => {
    await db.query(`set role authenticated`);
    try {
      for (const call of [
        `public.admin_health()`,
        `public.admin_usage(7)`,
        `public.admin_analytics(7)`,
        `public.admin_integrations()`,
        `public.admin_abuse_signals()`,
        `public.admin_jobs('all','all',5,0)`,
        `public.platform_spend_since(now())`,
      ]) {
        await expect(db.query(`select ${call}`), call).rejects.toThrow(/permission denied/);
      }
    } finally {
      await db.query(`reset role`);
    }
  });
});
