// Live check of Backlink Growth against the real provider and the real
// Supabase project (reads .env). Opt-in:
//   npx vitest run --config vitest.live.config.ts tests/live/links.live.ts
//
// SPENDS NOTHING BY DEFAULT. Every provider call here is a GET. The one test
// that would actually buy a placement is gated behind LINKS_LIVE_BUY=yes and
// is skipped otherwise, because it spends real money that cannot be refunded.
//
// What it proves without spending:
//   * the provider credential works and the catalog parses
//   * the catalog mirror, ranking and quoting run against real rows
//   * the credit ledger is genuinely idempotent and refuses an overdraft
//   * the provider lock really is single-flight, and a fencing token works
//   * RLS hides every new table from an anonymous client
//   * the database refuses to call a placement live without a verification
import { afterAll, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const hasSupabase = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
const hasProvider = Boolean(process.env.RIXOT_API_KEY);
const describeLive = hasSupabase && hasProvider ? describe : describe.skip;

/** Buying is opt-in twice over: this env var, and a real balance. */
const WILL_BUY = process.env.LINKS_LIVE_BUY === "yes";

describeLive("backlink growth (live)", () => {
  const createdOrders: string[] = [];
  let workspaceId = "";
  let userId: string | null = null;

  afterAll(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (createdOrders.length) {
      // Lines and events cascade from the order.
      await supabaseAdmin.from("link_orders").delete().in("id", createdOrders);
    }
    if (workspaceId) {
      await supabaseAdmin
        .from("workspace_credit_ledger")
        .delete()
        .eq("workspace_id", workspaceId)
        .like("idempotency_key", "livetest:%");
    }
  });

  it("finds a workspace to work in", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("workspaces")
      .select("id, owner_id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    expect(data?.id).toBeTruthy();
    workspaceId = data!.id;
    userId = (data as { owner_id?: string | null }).owner_id ?? null;
  });

  // ── Provider ──────────────────────────────────────────────────────────────

  it("authenticates against the provider and reads a balance", async () => {
    const { getAccount } = await import("@/server/links/rixot/client.server");
    const account = await getAccount();

    expect(account.email).toBeTruthy();
    expect(typeof account.balanceUsd).toBe("number");
    expect(account.balanceUsd).toBeGreaterThanOrEqual(0);
    console.log(`[live] provider balance: $${account.balanceUsd}`);
  });

  it("reads and parses a page of the real catalog", async () => {
    const { listDonors } = await import("@/server/links/rixot/client.server");
    const page = await listDonors({ page: 1 });

    expect(page.donors.length).toBeGreaterThan(0);
    expect(page.totalRecords).toBeGreaterThan(100);

    for (const donor of page.donors) {
      expect(donor.id).toBeGreaterThan(0);
      expect(donor.domain).toMatch(/\./);
      expect(donor.priceUsd).toBeGreaterThan(0);
      // dr is nullable by design: "unrated" must not become "rated zero".
      if (donor.dr !== null) expect(donor.dr).toBeLessThanOrEqual(100);
    }
  });

  it("honours the catalog filters the ranking relies on", async () => {
    const { listDonors } = await import("@/server/links/rixot/client.server");
    const page = await listDonors({ drMin: 40, priceMax: 50 });

    for (const donor of page.donors) {
      expect(donor.priceUsd).toBeLessThanOrEqual(50);
    }
  });

  it("fetches the provider's own article brief", async () => {
    const { getArticlePrompt } = await import("@/server/links/rixot/client.server");
    const prompt = await getArticlePrompt({
      keyword: "project management software",
      targetUrl: "https://example.com/pricing",
    });

    expect(prompt.defaultPrompt.length).toBeGreaterThan(20);
    expect(prompt.editableField).toBe("recommendations");
  });

  it("reads the shared basket without changing it", async () => {
    const { getBasket } = await import("@/server/links/rixot/client.server");
    const basket = await getBasket();
    expect(Array.isArray(basket)).toBe(true);
    console.log(`[live] provider basket holds ${basket.length} item(s)`);
  });

  // ── Catalog mirror ────────────────────────────────────────────────────────

  it("mirrors part of the catalog into Postgres", async () => {
    const { listDonors } = await import("@/server/links/rixot/client.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const page = await listDonors({ page: 1 });
    const { error } = await supabaseAdmin.rpc("upsert_rixot_donors", {
      p_rows: page.donors.map((d) => ({
        id: d.id,
        domain: d.domain,
        ext: d.ext,
        page: d.page,
        domain_hidden: d.domainHidden,
        price_usd: d.priceUsd,
        dr: d.dr,
        referring_domains: d.referringDomains,
        backlinks: d.backlinks,
        dfs_rank: d.dfsRank,
        top100: d.top100,
        cat: d.cat,
      })),
    });
    expect(error).toBeNull();

    const { count } = await supabaseAdmin
      .from("rixot_donors")
      .select("id", { count: "exact", head: true });
    expect(count ?? 0).toBeGreaterThan(0);
  });

  it("ranks the mirrored catalog and refuses the sites it should", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { rankDonors, disqualify } = await import("@/lib/links/rank");

    const { data } = await supabaseAdmin
      .from("rixot_donors")
      .select(
        "id, domain, ext, page, price_usd, dr, referring_domains, backlinks, dfs_rank, top100, cat",
      )
      .limit(200);

    const signals = (data ?? []).map((row) => ({
      id: Number(row.id),
      domain: String(row.domain),
      ext: row.ext,
      page: row.page,
      priceUsd: Number(row.price_usd ?? 0),
      dr: row.dr === null ? null : Number(row.dr),
      referringDomains: row.referring_domains === null ? null : Number(row.referring_domains),
      backlinks: row.backlinks === null ? null : Number(row.backlinks),
      dfsRank: row.dfs_rank === null ? null : Number(row.dfs_rank),
      top100: row.top100 === null ? null : Number(row.top100),
      cat: row.cat,
    }));

    const ranked = rankDonors(signals, { limit: 20 });
    expect(ranked.length).toBeGreaterThan(0);

    // Scores descend, and nothing disqualified survived the filter.
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
    }
    for (const donor of ranked) {
      expect(disqualify(donor)).toBeNull();
    }
    console.log(
      `[live] top placement: ${ranked[0].domain} (score ${ranked[0].score}, $${ranked[0].priceUsd})`,
    );
  });

  // ── The background pipeline (what pg_cron drives) ─────────────────────────

  it("mirrors the whole catalog inside one cron tick", async () => {
    const { syncCatalog } = await import("@/server/links/catalog.server");
    const started = Date.now();
    const result = await syncCatalog({ deadline: started + 110_000 });
    const seconds = Math.round((Date.now() - started) / 1000);

    console.log(
      `[live] full sync: ${result.pagesFetched}/${result.totalPages} pages, ` +
        `${result.donorsSeen} donors, ${seconds}s, delisted ${result.delisted}`,
    );
    expect(result.errors).toEqual([]);
    // The daily hook budgets 100s. A walk that does not finish would leave the
    // lowest-ranked part of the catalog permanently stale.
    expect(result.complete).toBe(true);
    expect(seconds).toBeLessThan(100);
  }, 180_000);

  it("reports catalog health from the mirror", async () => {
    const { catalogHealth } = await import("@/server/links/catalog.server");
    const health = await catalogHealth();

    expect(health.total).toBeGreaterThan(0);
    expect(health.fresh).toBeGreaterThan(0);
    expect(health.lastSyncedAt).toBeTruthy();
    console.log(`[live] catalog: ${health.fresh} fresh of ${health.total}`);
  });

  it("completes a cron tick without spending anything", async () => {
    const { runDueOrders } = await import("@/server/links/service.server");
    // No order is queued, so this exercises the claim loop, the provider link
    // poll, the verification sweep and the give-up sweep.
    const tick = await runDueOrders({ budgetMs: 40_000 });

    expect(tick.advanced).toBe(0);
    expect(tick.poll).not.toBeNull();
    expect(tick.refunded).toBe(0);
    console.log(`[live] tick polled ${tick.poll?.seen ?? 0} provider link(s)`);
  }, 120_000);

  // ── Credits ───────────────────────────────────────────────────────────────

  it("applies a credit entry exactly once, however many times it replays", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const key = `livetest:${Date.now()}`;

    const call = () =>
      supabaseAdmin.rpc("apply_credit_entry", {
        p: {
          workspace_id: workspaceId,
          kind: "topup",
          idempotency_key: key,
          delta_available: 500,
          reason: "live test",
        },
      });

    const first = await call();
    expect((first.data as Record<string, unknown>).ok).toBe(true);
    expect((first.data as Record<string, unknown>).replayed).toBe(false);
    const after = Number((first.data as Record<string, unknown>).available);

    // Three more identical calls must move nothing.
    for (let i = 0; i < 3; i += 1) {
      const again = await call();
      expect((again.data as Record<string, unknown>).ok).toBe(true);
      expect((again.data as Record<string, unknown>).replayed).toBe(true);
      expect(Number((again.data as Record<string, unknown>).available)).toBe(after);
    }

    // Give it straight back so the workspace balance is untouched.
    const undo = await supabaseAdmin.rpc("apply_credit_entry", {
      p: {
        workspace_id: workspaceId,
        kind: "adjustment",
        idempotency_key: `${key}:undo`,
        delta_available: -500,
        reason: "live test cleanup",
      },
    });
    expect((undo.data as Record<string, unknown>).ok).toBe(true);
  });

  it("refuses to let a balance go negative", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.rpc("apply_credit_entry", {
      p: {
        workspace_id: workspaceId,
        kind: "hold",
        idempotency_key: `livetest:overdraft:${Date.now()}`,
        delta_available: -999_999_999,
        delta_held: 999_999_999,
        reason: "live test overdraft",
      },
    });

    const result = data as Record<string, unknown>;
    expect(result.ok).toBe(false);
    expect(result.code).toBe("insufficient");
  });

  it("keeps the ledger append-only", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("workspace_credit_ledger")
      .select("id")
      .eq("workspace_id", workspaceId)
      .limit(1)
      .maybeSingle();

    if (!row) return;
    // Even service_role cannot rewrite a money row.
    const { error } = await supabaseAdmin
      .from("workspace_credit_ledger")
      .update({ reason: "tampered" })
      .eq("id", row.id);

    expect(error).not.toBeNull();
  });

  // ── The global provider lock ──────────────────────────────────────────────

  it("hands the basket to one holder at a time, and fences the loser out", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const first = await supabaseAdmin.rpc("acquire_provider_lock", {
      p_provider: "rixot",
      p_holder: "live-test-a",
      p_order_id: undefined,
      p_lease_seconds: 60,
    });
    const firstResult = first.data as Record<string, unknown>;

    // A quarantined lock is a real state; do not fight it in a test.
    if (firstResult.code === "quarantined") return;
    expect(firstResult.ok).toBe(true);
    const token = String(firstResult.token);

    const second = await supabaseAdmin.rpc("acquire_provider_lock", {
      p_provider: "rixot",
      p_holder: "live-test-b",
      p_order_id: undefined,
      p_lease_seconds: 60,
    });
    expect((second.data as Record<string, unknown>).ok).toBe(false);
    expect((second.data as Record<string, unknown>).code).toBe("busy");

    // A stale token cannot renew, which is what stops a zombie writing.
    const stale = await supabaseAdmin.rpc("renew_provider_lock", {
      p_provider: "rixot",
      p_token: "00000000-0000-4000-8000-000000000000",
      p_phase: undefined,
      p_lease_seconds: 60,
    });
    expect(stale.data).toBe(false);

    const released = await supabaseAdmin.rpc("release_provider_lock", {
      p_provider: "rixot",
      p_token: token,
    });
    expect(released.data).toBe(true);
  });

  // ── Database honesty guarantees ───────────────────────────────────────────

  it("refuses to record a placement as live without a verification", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Build a minimal order and line to aim the constraint at.
    const { data: donor } = await supabaseAdmin
      .from("rixot_donors")
      .select("id, domain, price_usd")
      .limit(1)
      .maybeSingle();
    expect(donor).toBeTruthy();

    const { data: order, error: orderError } = await supabaseAdmin
      .from("link_orders")
      .insert({
        workspace_id: workspaceId,
        target_url: "https://example.com/pricing",
        keyword: "live test",
        quoted_usd: 0,
        credit_rate: 100,
        idempotency_key: `livetest:${Date.now()}`,
        created_by: userId,
      })
      .select("id")
      .single();
    expect(orderError).toBeNull();
    createdOrders.push(order!.id);

    const { data: line, error: lineError } = await supabaseAdmin
      .from("link_order_lines")
      .insert({
        workspace_id: workspaceId,
        order_id: order!.id,
        donor_id: Number(donor!.id),
        donor_domain: String(donor!.domain),
        unit_price_usd: Number(donor!.price_usd),
        credits_price: 0,
      })
      .select("id")
      .single();
    expect(lineError).toBeNull();

    // status 'live' without verification 'live'/'nofollow' must be refused by
    // the CHECK constraint, even for service_role.
    const { error: cheat } = await supabaseAdmin
      .from("link_order_lines")
      .update({ status: "live", published_url: "https://blog.com/a", attribution: "operator" })
      .eq("id", line!.id);

    expect(cheat).not.toBeNull();
    expect(String(cheat?.message)).toMatch(/live_needs_proof|violates check/i);
  });

  it("refuses to record a placement as published with no attributed link", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: line } = await supabaseAdmin
      .from("link_order_lines")
      .select("id")
      .in("order_id", createdOrders)
      .limit(1)
      .maybeSingle();

    if (!line) return;
    const { error } = await supabaseAdmin
      .from("link_order_lines")
      .update({ status: "published" })
      .eq("id", line.id);

    expect(error).not.toBeNull();
  });

  it("refuses a line whose workspace does not match its order", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (!createdOrders.length) return;

    const { data: other } = await supabaseAdmin
      .from("workspaces")
      .select("id")
      .neq("id", workspaceId)
      .limit(1)
      .maybeSingle();
    if (!other) return;

    const { data: donor } = await supabaseAdmin
      .from("rixot_donors")
      .select("id, domain, price_usd")
      .limit(1)
      .maybeSingle();

    const { error } = await supabaseAdmin.from("link_order_lines").insert({
      workspace_id: other.id,
      order_id: createdOrders[0],
      donor_id: Number(donor!.id),
      donor_domain: String(donor!.domain),
      unit_price_usd: 0,
      credits_price: 0,
    });

    expect(error).not.toBeNull();
  });

  // ── RLS ───────────────────────────────────────────────────────────────────

  it("hides every workspace-scoped table from an anonymous client", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(
      process.env.SUPABASE_URL as string,
      process.env.SUPABASE_PUBLISHABLE_KEY as string,
    );

    for (const table of [
      "link_orders",
      "link_order_lines",
      "link_order_events",
      "workspace_credit_balances",
      "workspace_credit_ledger",
      "rixot_link_sightings",
      "provider_basket_lock",
      "billing_customers",
      "stripe_events",
    ]) {
      const { data, error } = await anon.from(table).select("*").limit(1);
      // Either refused outright, or visible as zero rows. Never any data.
      expect(error !== null || (data ?? []).length === 0).toBe(true);
    }
  });

  // ── The one test that spends money ────────────────────────────────────────

  it.skipIf(!WILL_BUY)(
    "buys one real placement end to end",
    async () => {
      const { getAccount, getBasket } = await import("@/server/links/rixot/client.server");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const account = await getAccount();
      const basketBefore = await getBasket();
      // Never start a cycle on a basket that already holds something.
      expect(basketBefore).toHaveLength(0);
      expect(account.balanceUsd).toBeGreaterThan(9);

      const { data: donor } = await supabaseAdmin
        .from("rixot_donors")
        .select("id, price_usd")
        .is("delisted_at", null)
        .order("price_usd", { ascending: true })
        .limit(1)
        .maybeSingle();
      expect(donor).toBeTruthy();

      const { saveCart, checkout } = await import("@/server/links/service.server");
      const target = process.env.LINKS_LIVE_TARGET || "https://example.com/";

      const cart = await saveCart({
        workspaceId,
        userId: userId as string,
        targetUrl: target,
        keyword: process.env.LINKS_LIVE_KEYWORD || "marketing automation",
        donorIds: [Number(donor!.id)],
      });
      createdOrders.push(cart.orderId);

      // Fund the hold so checkout is testing the flow, not the balance.
      await supabaseAdmin.rpc("apply_credit_entry", {
        p: {
          workspace_id: workspaceId,
          kind: "topup",
          idempotency_key: `livetest:buy:${cart.orderId}`,
          delta_available: cart.credits,
          reason: "live test funding",
        },
      });

      const confirmed = await checkout({
        workspaceId,
        userId: userId as string,
        orderId: cart.orderId,
        expectedCredits: cart.credits,
      });
      expect(confirmed.orderId).toBe(cart.orderId);

      // Drive the cycle to a terminal or waiting state.
      const { runDueOrders } = await import("@/server/links/service.server");
      for (let i = 0; i < 8; i += 1) {
        await runDueOrders({ budgetMs: 45_000 });
        const { data } = await supabaseAdmin
          .from("link_orders")
          .select("status, provider_charged_usd, needs_operator, last_error")
          .eq("id", cart.orderId)
          .maybeSingle();
        console.log(`[live] order status: ${data?.status}`);
        if (
          [
            "paid",
            "publishing",
            "published",
            "failed",
            "needs_operator",
            "blocked_balance",
          ].includes(String(data?.status))
        ) {
          expect(data?.status).not.toBe("failed");
          expect(data?.needs_operator).not.toBe(true);
          break;
        }
      }

      const { data: final } = await supabaseAdmin
        .from("link_orders")
        .select("status, provider_charged_usd")
        .eq("id", cart.orderId)
        .maybeSingle();

      expect(["paid", "publishing", "published"]).toContain(String(final?.status));
      console.log(`[live] charged $${final?.provider_charged_usd}`);
    },
    600_000,
  );
});
