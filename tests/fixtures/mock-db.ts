// mock-db.ts — Supabase-like mocks for the SDR handlers.
// makeMockContentDb: the original focused mock (content_items reads + updates,
// content_publications upserts/updates) used by publish/schedule/cancel tests.
// makeMockDb: a general query-builder mock (chained select/eq/in/lt/limit +
// update().eq().eq()/in()) used by the webhook receiver + reconcile tests.
import { vi } from "vitest";

export type MockContentItem = {
  id: string;
  workspace_id: string;
  body: string | null;
  media_url: string | null;
  status: string;
  meta: Record<string, any>;
};

export function makeMockContentDb(initialItems: MockContentItem[] = []) {
  const items = [...initialItems];
  const publications: any[] = [];
  const itemUpdates: Array<{ patch: any; id: string }> = [];
  const upserts: any[] = [];

  return {
    _items: items,
    _publications: publications,
    _itemUpdates: itemUpdates,
    _upserts: upserts,
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "content_publications") {
        return {
          upsert: vi.fn().mockImplementation(async (rows: any[]) => {
            upserts.push(...rows);
            publications.push(...rows);
            return { error: null };
          }),
          update: vi.fn((patch: any) => ({
            eq: vi.fn(async () => {
              publications.forEach((p) => Object.assign(p, patch));
              return { error: null };
            }),
          })),
        };
      }
      if (table === "content_items") {
        const filters: Record<string, any> = {};
        const self: any = {
          select: vi.fn(() => self),
          eq: vi.fn((col: string, val: any) => {
            filters[col] = val;
            return self;
          }),
          maybeSingle: vi.fn(async () => {
            const item = items.find(
              (i) => i.id === filters.id && i.workspace_id === filters.workspace_id,
            );
            return { data: item ?? null, error: null };
          }),
          update: vi.fn((patch: any) => ({
            eq: vi.fn(async (col: string, val: any) => {
              itemUpdates.push({ patch, id: String(val) });
              return { error: null };
            }),
          })),
        };
        return self;
      }
      throw new Error("unexpected mock table: " + table);
    }),
  };
}

export type MockRow = Record<string, any>;
type TableKey = "content_items" | "content_publications" | "workspace_sdr";

/** General query-builder mock for the webhook receiver + reconcile tests. */
export function makeMockDb(seed: Partial<Record<TableKey, MockRow[]>> = {}) {
  const state: Record<string, MockRow[]> = {
    content_items: [...(seed.content_items ?? [])],
    content_publications: [...(seed.content_publications ?? [])],
    workspace_sdr: [...(seed.workspace_sdr ?? [])],
  };
  const mutations: Array<{ table: string; patch: any }> = [];
  const upserts: any[] = [];

  function matches(
    row: MockRow,
    filters: Record<string, any>,
    inF: Record<string, any[]>,
    ltF: Record<string, any>,
  ) {
    for (const [k, v] of Object.entries(filters)) if (row[k] !== v) return false;
    for (const [k, vals] of Object.entries(inF)) if (!vals.includes(row[k])) return false;
    for (const [k, v] of Object.entries(ltF)) if (!(row[k] < v)) return false;
    return true;
  }

  function builder(table: string) {
    const filters: Record<string, any> = {};
    const inF: Record<string, any[]> = {};
    const ltF: Record<string, any> = {};
    const find = () => (state[table] ?? []).filter((r) => matches(r, filters, inF, ltF));
    // Real Supabase builders are THENABLE: `await from(...).select().eq()` works.
    // `then` makes this builder awaitable to { data, error } for select chains.
    const b: any = {
      select: () => b,
      eq: (col: string, val: any) => {
        filters[col] = val;
        return b;
      },
      in: (col: string, vals: any[]) => {
        inF[col] = vals;
        return b;
      },
      lt: (col: string, val: any) => {
        ltF[col] = val;
        return b;
      },
      limit: () => b,
      maybeSingle: async () => ({ data: find()[0] ?? null, error: null }),
      upsert: async (rows: any[]) => {
        state[table].push(...rows);
        upserts.push(...rows);
        return { error: null };
      },
      update: (patch: any) => make({}, patch),
      then: (resolve: (v: any) => void) => resolve({ data: find(), error: null }),
    };

    const make = (extra: Record<string, any>, patch: any) => {
      const apply = async () => {
        const combined = { ...filters, ...extra };
        const rows = (state[table] ?? []).filter((r) => {
          for (const [k, v] of Object.entries(combined)) {
            if (v && typeof v === "object" && "__in" in v) {
              if (!(v as any).__in.includes(r[k])) return false;
            } else if (r[k] !== v) {
              return false;
            }
          }
          return true;
        });
        rows.forEach((r) => Object.assign(r, patch));
        if (rows.length) mutations.push({ table, patch });
        return { error: null };
      };
      return Object.assign(apply, {
        eq: (col: string, val: any) => make({ ...extra, [col]: val }, patch),
        in: (col: string, vals: any[]) => make({ ...extra, [col]: { __in: vals } }, patch),
        then: (resolve: (v: any) => void) => resolve(apply()),
      });
    };

    return b;
  }

  return {
    _state: state,
    _mutations: mutations,
    _upserts: upserts,
    from: vi.fn((table: string) => builder(table)),
  };
}
