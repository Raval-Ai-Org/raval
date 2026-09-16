// memory-supabase.ts — an in-memory, Supabase-shaped query builder for the
// SocialAPI handler tests. Supports the subset of PostgREST chaining the
// handlers use: select/insert/upsert/update/delete, eq/neq/in/lt/lte/gt/gte/is/
// not(in)/or, order/limit, maybeSingle, `.select()` returning rows after a
// write, `{ count, head }`, unique constraints (23505) and storage.
import { randomUUID } from "node:crypto";

export type Row = Record<string, any>;
type Filter = (r: Row) => boolean;

export type MemoryDb = ReturnType<typeof createMemoryDb>;

export function createMemoryDb(
  seed: Record<string, Row[]> = {},
  opts: { unique?: Record<string, string[][]>; storage?: Record<string, Blob> } = {},
) {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));
  const writes: Array<{ table: string; op: string; payload?: unknown }> = [];
  const uniques = opts.unique ?? {};

  const tableRows = (name: string) => (tables[name] ??= []);

  const cmp = (a: any, b: any) => (a === b ? 0 : a < b ? -1 : 1);

  function parseList(raw: string): string[] {
    return raw
      .replace(/^\(|\)$/g, "")
      .split(",")
      .map((s) => s.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
  }

  function orFilter(expr: string): Filter {
    const parts = expr.split(",").map((p) => {
      const [col, op, ...rest] = p.split(".");
      const value = rest.join(".");
      return (r: Row) => {
        if (op === "is") return value === "null" ? r[col] == null : r[col] === value;
        if (op === "eq") return String(r[col]) === value;
        if (op === "lt") return r[col] != null && cmp(r[col], value) < 0;
        if (op === "gt") return r[col] != null && cmp(r[col], value) > 0;
        return false;
      };
    });
    return (r) => parts.some((f) => f(r));
  }

  function query(table: string) {
    let op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
    let payload: any = null;
    let onConflict: string[] = [];
    let returning = false;
    let wantCount = false;
    let head = false;
    let limitN: number | null = null;
    let order: { col: string; asc: boolean } | null = null;
    const filters: Filter[] = [];

    const matched = () => tableRows(table).filter((r) => filters.every((f) => f(r)));

    const violates = (row: Row, ignore?: Row) =>
      (uniques[table] ?? []).some((cols) =>
        tableRows(table).some(
          (other) =>
            other !== ignore &&
            cols.every((c) => other[c] !== undefined && other[c] !== null && other[c] === row[c]),
        ),
      );

    function exec(): { data: any; error: any; count?: number | null } {
      if (op === "select") {
        let rows = matched();
        if (order) {
          const { col, asc } = order;
          rows = [...rows].sort((a, b) => (asc ? cmp(a[col], b[col]) : cmp(b[col], a[col])));
        }
        const count = rows.length;
        if (limitN !== null) rows = rows.slice(0, limitN);
        return {
          data: head ? null : rows.map((r) => ({ ...r })),
          error: null,
          count: wantCount ? count : null,
        };
      }
      writes.push({ table, op, payload });
      if (op === "insert" || op === "upsert") {
        const list: Row[] = Array.isArray(payload) ? payload : [payload];
        const out: Row[] = [];
        for (const incoming of list) {
          if (op === "upsert" && onConflict.length) {
            const existing = tableRows(table).find((r) =>
              onConflict.every((c) => r[c] === incoming[c]),
            );
            if (existing) {
              Object.assign(existing, incoming);
              out.push({ ...existing });
              continue;
            }
          }
          const row = { id: incoming.id ?? randomUUID(), ...incoming };
          if (violates(row))
            return { data: null, error: { code: "23505", message: "duplicate key value" } };
          tableRows(table).push(row);
          out.push({ ...row });
        }
        return { data: returning ? out : null, error: null };
      }
      if (op === "update") {
        const rows = matched();
        for (const r of rows) Object.assign(r, payload);
        return { data: returning ? rows.map((r) => ({ ...r })) : null, error: null };
      }
      const doomed = new Set(matched());
      tables[table] = tableRows(table).filter((r) => !doomed.has(r));
      return { data: returning ? [...doomed].map((r) => ({ ...r })) : null, error: null };
    }

    const b: any = {
      select(_cols?: string, o?: { count?: string; head?: boolean }) {
        if (op !== "select") returning = true;
        if (o?.count) {
          wantCount = true;
          head = Boolean(o.head);
        }
        return b;
      },
      insert(rows: any) {
        op = "insert";
        payload = rows;
        return b;
      },
      upsert(rows: any, o?: { onConflict?: string }) {
        op = "upsert";
        payload = rows;
        onConflict = (o?.onConflict ?? "").split(",").filter(Boolean);
        return b;
      },
      update(patch: any) {
        op = "update";
        payload = patch;
        return b;
      },
      delete() {
        op = "delete";
        return b;
      },
      eq: (c: string, v: any) => (filters.push((r) => r[c] === v), b),
      neq: (c: string, v: any) => (filters.push((r) => r[c] !== v), b),
      in: (c: string, vals: any[]) => (filters.push((r) => vals.includes(r[c])), b),
      lt: (c: string, v: any) => (filters.push((r) => r[c] != null && cmp(r[c], v) < 0), b),
      lte: (c: string, v: any) => (filters.push((r) => r[c] != null && cmp(r[c], v) <= 0), b),
      gt: (c: string, v: any) => (filters.push((r) => r[c] != null && cmp(r[c], v) > 0), b),
      gte: (c: string, v: any) => (filters.push((r) => r[c] != null && cmp(r[c], v) >= 0), b),
      is: (c: string, v: any) => (filters.push((r) => (v === null ? r[c] == null : r[c] === v)), b),
      not: (c: string, operator: string, v: any) => {
        if (operator === "in") {
          const list = parseList(String(v));
          filters.push((r) => !list.includes(r[c]));
        } else if (operator === "is") {
          filters.push((r) => (v === null ? r[c] != null : r[c] !== v));
        }
        return b;
      },
      or: (expr: string) => (filters.push(orFilter(expr)), b),
      order: (col: string, o?: { ascending?: boolean }) => (
        (order = { col, asc: o?.ascending !== false }),
        b
      ),
      limit: (n: number) => ((limitN = n), b),
      maybeSingle: async () => {
        const res = exec();
        const rows = Array.isArray(res.data) ? res.data : [];
        return { data: rows[0] ?? null, error: res.error };
      },
      then: (resolve: (v: any) => unknown, reject?: (e: unknown) => unknown) => {
        try {
          return Promise.resolve(exec()).then(resolve, reject);
        } catch (e) {
          return reject ? Promise.resolve(reject(e)) : Promise.reject(e);
        }
      },
    };
    return b;
  }

  const blobs = opts.storage ?? {};
  return {
    tables,
    writes,
    rows: (table: string) => tableRows(table),
    from: (table: string) => query(table),
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: `https://storage.test/${bucket}/${path}?token=signed` },
          error: null,
        }),
        download: async (path: string) =>
          blobs[path]
            ? { data: blobs[path], error: null }
            : { data: null, error: { message: "not found" } },
      }),
    },
  };
}

export type ApiRequest = {
  method?: string;
  path: string;
  query?: Record<string, unknown>;
  body?: any;
  form?: FormData;
  retry?: boolean;
  timeoutMs?: number;
};

/** A scripted SocialAPI client: route by "METHOD /path", record every request. */
export function scriptedApi(
  handler: (
    req: ApiRequest,
    key: string,
  ) => { status: number; data?: any } | Promise<{ status: number; data?: any }>,
) {
  const calls: ApiRequest[] = [];
  const api = async (req: ApiRequest) => {
    calls.push(req);
    const res = await handler(req, `${req.method ?? "GET"} ${req.path}`);
    return { status: res.status, data: res.data ?? null, requestId: "req-test" };
  };
  return {
    api: api as any,
    calls,
    find: (key: string) => calls.filter((c) => `${c.method ?? "GET"} ${c.path}` === key),
  };
}
