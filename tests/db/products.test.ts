// Product catalogue database invariants (workspace_products).
//
// Replays the real migrations into PGlite and checks what the database itself
// guarantees, independent of server code:
//   - members read their own brand's products, other tenants see none;
//   - browsers never write (the server does, after a role check);
//   - a product's photo must be an asset and a storage path of its own workspace;
//   - one main product per brand; one row per product page.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error — plain .mjs helper shared with scripts/db-baseline.mjs
import { createMigratedDb } from "../../scripts/db/pglite-supabase.mjs";

const ALICE = "a1111111-1111-4111-8111-111111111111";
const BOB = "b2222222-2222-4222-8222-222222222222";

type Tx = { query: PGlite["query"] };
let db: PGlite;
let wsA: string;
let wsB: string;

async function as<T>(user: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  await db.exec("BEGIN");
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: user, role: "authenticated" }),
    ]);
    await db.exec("SET LOCAL ROLE authenticated");
    return await fn(db);
  } finally {
    await db.exec("ROLLBACK");
  }
}

async function service<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  await db.exec("BEGIN");
  try {
    return await fn(db);
  } finally {
    await db.exec("ROLLBACK");
  }
}

async function workspace(owner: string, name: string) {
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
}

const asset = async (tx: Tx, ws: string, key: string) => {
  const {
    rows: [row],
  } = await tx.query<{ id: string }>(
    `insert into public.assets (workspace_id, generation_id, idempotency_key, filename)
     values ($1, $2, $2, 'product.jpg') returning id`,
    [ws, key],
  );
  return row.id;
};

const path = (ws: string) => `workspace/${ws}/assets/product.jpg`;

const product = (
  tx: Tx,
  ws: string,
  url: string,
  opts: { assetId?: string | null; storagePath?: string | null; primary?: boolean } = {},
) =>
  tx.query(
    `insert into public.workspace_products
       (workspace_id, name, url, image_asset_id, image_storage_path, is_primary)
     values ($1, 'Cold Brew Kit', $2, $3, $4, $5)`,
    [ws, url, opts.assetId ?? null, opts.storagePath ?? null, opts.primary ?? false],
  );

beforeAll(async () => {
  db = await createMigratedDb();
  for (const [id, email] of [
    [ALICE, "alice@example.com"],
    [BOB, "bob@example.com"],
  ]) {
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
  }
  wsA = await workspace(ALICE, "Alice Co");
  wsB = await workspace(BOB, "Bob Co");
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("workspace_products", () => {
  it("members read their own products; other tenants see none", async () => {
    await db.exec("BEGIN");
    try {
      await product(db, wsA, "https://alice.example/products/kit");
      await db.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: BOB, role: "authenticated" }),
      ]);
      await db.exec("SET LOCAL ROLE authenticated");
      const { rows } = await db.query(`select id from public.workspace_products`);
      expect(rows).toHaveLength(0);
    } finally {
      await db.exec("ROLLBACK");
    }
    await db.exec("BEGIN");
    try {
      await product(db, wsA, "https://alice.example/products/kit");
      await db.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: ALICE, role: "authenticated" }),
      ]);
      await db.exec("SET LOCAL ROLE authenticated");
      const { rows } = await db.query(`select id from public.workspace_products`);
      expect(rows).toHaveLength(1);
    } finally {
      await db.exec("ROLLBACK");
    }
  });

  it("refuses writes from the browser", async () => {
    await as(ALICE, async (tx) => {
      await expect(product(tx, wsA, "https://alice.example/products/kit")).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  it("keeps a product's photo inside its own workspace", async () => {
    await service(async (tx) => {
      const other = await asset(tx, wsB, "product-b");
      await expect(
        product(tx, wsA, "https://alice.example/products/a", { assetId: other }),
      ).rejects.toThrow(/product_asset_wrong_workspace/);
    });
    await service(async (tx) => {
      await expect(
        product(tx, wsA, "https://alice.example/products/b", { storagePath: path(wsB) }),
      ).rejects.toThrow(/product_path_wrong_workspace/);
    });
    await service(async (tx) => {
      await expect(
        product(tx, wsA, "https://alice.example/products/c", {
          storagePath: `workspace/${wsA}/assets/../../${wsB}/assets/x.jpg`,
        }),
      ).rejects.toThrow(/product_path_wrong_workspace/);
    });
    await service(async (tx) => {
      const own = await asset(tx, wsA, "product-a");
      await product(tx, wsA, "https://alice.example/products/d", {
        assetId: own,
        storagePath: path(wsA),
      });
    });
  });

  it("allows one main product per brand and one row per page", async () => {
    await service(async (tx) => {
      await product(tx, wsA, "https://alice.example/products/a", { primary: true });
      await expect(
        product(tx, wsA, "https://alice.example/products/b", { primary: true }),
      ).rejects.toThrow(/workspace_products_one_primary/);
    });
    await service(async (tx) => {
      await product(tx, wsA, "https://alice.example/products/a");
      await expect(product(tx, wsA, "https://alice.example/products/a")).rejects.toThrow(
        /duplicate key/,
      );
    });
    await service(async (tx) => {
      // The same page in another brand is that brand's own row.
      await product(tx, wsA, "https://alice.example/products/a");
      await product(tx, wsB, "https://alice.example/products/a");
    });
  });
});
