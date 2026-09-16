import { describe, expect, it, vi } from "vitest";

// Self-contained in-memory stand-in for the service-role client. Files under
// src/ are type-checked by `next build`, and the deploy image excludes tests/
// (.dockerignore), so this test must not import from tests/fixtures.
type Row = Record<string, unknown>;
type Result = { data: unknown; error: null };

function createMemoryDb(seed: Record<string, Row[]>) {
  const tables = new Map<string, Row[]>(
    Object.entries(seed).map(([name, rows]) => [name, rows.map((r) => ({ ...r }))]),
  );
  const rowsOf = (name: string): Row[] => {
    let rows = tables.get(name);
    if (!rows) tables.set(name, (rows = []));
    return rows;
  };

  function from(table: string) {
    let op: "select" | "insert" | "delete" = "select";
    let payload: Row | Row[] = [];
    let returning = false;
    const filters: Array<(r: Row) => boolean> = [];
    const matched = () => rowsOf(table).filter((r) => filters.every((f) => f(r)));

    const run = (single: boolean): Result => {
      if (op === "insert") {
        const incoming = Array.isArray(payload) ? payload : [payload];
        rowsOf(table).push(...incoming.map((r) => ({ ...r })));
        return { data: returning ? incoming : null, error: null };
      }
      if (op === "delete") {
        const doomed = new Set(matched());
        tables.set(
          table,
          rowsOf(table).filter((r) => !doomed.has(r)),
        );
        return { data: returning ? [...doomed] : null, error: null };
      }
      const rows = matched();
      return { data: single ? (rows[0] ?? null) : rows, error: null };
    };

    const builder = {
      select() {
        if (op !== "select") returning = true;
        return builder;
      },
      insert(rows: Row | Row[]) {
        op = "insert";
        payload = rows;
        return builder;
      },
      delete() {
        op = "delete";
        return builder;
      },
      eq(column: string, value: unknown) {
        filters.push((r) => r[column] === value);
        return builder;
      },
      maybeSingle: () => Promise.resolve(run(true)),
      then<T>(resolve: (value: Result) => T, reject?: (reason: unknown) => T) {
        return Promise.resolve(run(false)).then(resolve, reject);
      },
    };
    return builder;
  }

  return { from, rows: (table: string): Row[] => rowsOf(table) };
}

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

const { deleteWorkspace, presentOverviewRow, workspaceHealth } = await import("./service.server");

const OWNER = "owner-1";
const EDITOR = "editor-1";
const A = "ws-a";
const B = "ws-b";

function seed() {
  return createMemoryDb({
    workspaces: [
      { id: A, name: "Mellox AI", domain: "mellox.ai", owner_id: OWNER },
      { id: B, name: "Northwind Coffee", domain: "northwindcoffee.com", owner_id: OWNER },
    ],
    workspace_members: [
      { workspace_id: A, user_id: OWNER, role: "owner" },
      { workspace_id: B, user_id: OWNER, role: "owner" },
      { workspace_id: A, user_id: EDITOR, role: "editor" },
    ],
    workspace_socialapi: [{ workspace_id: A, brand_id: "brand-a" }],
    workspace_deletions: [],
  });
}

function deps() {
  return {
    listObjects: vi.fn(async (id: string) => [`workspace/${id}/assets/one.png`]),
    removeObjects: vi.fn(async () => undefined),
    releaseSocialBrand: vi.fn(async () => undefined),
  };
}

describe("deleteWorkspace", () => {
  it("requires the exact typed confirmation", async () => {
    const db = seed();
    for (const confirmation of ["", "confirm", "CONFIRM ", "Confirm"]) {
      await expect(
        deleteWorkspace({ workspaceId: A, userId: OWNER, confirmation }, deps(), db as never),
      ).rejects.toThrow(/Type CONFIRM/);
    }
    expect(db.rows("workspaces")).toHaveLength(2);
  });

  it("refuses non-owners and strangers without touching anything", async () => {
    const db = seed();
    const d = deps();
    await expect(
      deleteWorkspace({ workspaceId: A, userId: EDITOR, confirmation: "CONFIRM" }, d, db as never),
    ).rejects.toThrow(/Only the workspace owner/);
    await expect(
      deleteWorkspace(
        { workspaceId: A, userId: "stranger", confirmation: "CONFIRM" },
        d,
        db as never,
      ),
    ).rejects.toThrow(/not found/i);
    expect(db.rows("workspaces")).toHaveLength(2);
    expect(d.removeObjects).not.toHaveBeenCalled();
  });

  it("deletes only that workspace, cleans its storage and provider brand, and records it", async () => {
    const db = seed();
    const d = deps();
    const out = await deleteWorkspace(
      { workspaceId: A, userId: OWNER, confirmation: "CONFIRM" },
      d,
      db as never,
    );
    expect(out).toEqual({ id: A, name: "Mellox AI", storageObjectsRemoved: 1 });
    expect(db.rows("workspaces").map((w: Row) => w.id)).toEqual([B]);
    expect(d.listObjects).toHaveBeenCalledWith(A);
    expect(d.removeObjects).toHaveBeenCalledWith([`workspace/${A}/assets/one.png`]);
    expect(d.releaseSocialBrand).toHaveBeenCalledWith("brand-a");
    expect(db.rows("workspace_deletions")[0]).toMatchObject({
      workspace_id: A,
      domain: "mellox.ai",
      deleted_by: OWNER,
    });
  });
});

describe("workspace overview presentation", () => {
  const row = {
    id: A,
    name: "Mellox AI",
    website_url: "https://mellox.ai",
    domain: "mellox.ai",
    industry: null,
    client_status: "active",
    plan: null,
    role: "owner",
    owner_id: OWNER,
    duplicate_of: null,
    onboarded_at: "2026-09-01T00:00:00Z",
    created_at: "2026-09-01T00:00:00Z",
    logo_url: "javascript:alert(1)",
    pending_approvals: "3",
    draft_count: 2,
    scheduled_count: "1",
    published_count: 0,
    failed_count: 0,
    connected_social_accounts: 1,
    geo_score: 71,
    geo_scanned_at: null,
    last_activity_at: null,
  };

  it("maps counts, ownership and health, and drops unsafe logo urls", () => {
    const s = presentOverviewRow(row, OWNER);
    expect(s).toMatchObject({
      pendingApprovals: 3,
      scheduledCount: 1,
      isOwner: true,
      plan: "free",
      logoUrl: null,
      health: "healthy",
      lastActivityAt: row.created_at,
    });
    expect(presentOverviewRow(row, EDITOR).isOwner).toBe(false);
  });

  it("flags setup and attention states", () => {
    expect(
      workspaceHealth({ onboarded: false, domain: "x.io", failedCount: 0, pendingApprovals: 0 }),
    ).toBe("setup");
    expect(
      workspaceHealth({ onboarded: true, domain: "x.io", failedCount: 1, pendingApprovals: 0 }),
    ).toBe("attention");
  });
});
