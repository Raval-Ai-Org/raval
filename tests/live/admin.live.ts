// Live check of the admin console against the real Supabase project (reads .env).
// Opt-in:
//   npx vitest run --config vitest.live.config.ts tests/live/admin.live.ts
//
// READ-ONLY BY DEFAULT. It calls the admin read functions with the service role,
// checks the tables the console depends on exist and are seeded, and proves an
// anonymous client can neither read the admin tables nor call the functions.
// The one test that writes (it adds a single row to the append-only audit log,
// which can never be removed) is gated behind ADMIN_LIVE_WRITE=yes.
//
// What it cannot prove: a real admin sign-in, a real second factor, or the
// console in a browser. Do those by hand once after the migrations are applied.
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable =
  process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const hasEnv = Boolean(url && publishable && process.env.SUPABASE_SERVICE_ROLE_KEY);
const describeLive = hasEnv ? describe : describe.skip;
const WRITE = process.env.ADMIN_LIVE_WRITE === "yes";

const ADMIN_TABLES = [
  "admin_users",
  "admin_audit_log",
  "admin_user_notes",
  "entitlement_overrides",
  "platform_switches",
  "platform_flags",
  "model_route_overrides",
  "spend_caps",
  "workspace_access_state",
  "admin_view_sessions",
];

// Functions that take no admin arguments, safe to call as a read.
const READ_CALLS: Array<[string, Record<string, unknown>]> = [
  ["admin_overview", {}],
  ["admin_health", {}],
  ["admin_usage", { p_days: 7 }],
  ["admin_analytics", { p_days: 30 }],
  ["admin_integrations", {}],
  ["admin_abuse_signals", {}],
  ["admin_jobs", { p_source: "all", p_state: "all", p_limit: 5, p_offset: 0 }],
  ["admin_lookup", { p_query: "zzz-no-such-thing", p_match_email: false }],
  ["platform_spend_since", { p_since: new Date(Date.now() - 3_600_000).toISOString() }],
];

describeLive("admin console (live)", () => {
  it("the admin read functions run against the real schema", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    for (const [name, args] of READ_CALLS) {
      const { data, error } = await supabaseAdmin.rpc(name as never, args as never);
      expect(error, `${name}: ${error?.message}`).toBeNull();
      expect(data, name).not.toBeUndefined();
    }
  });

  it("every admin table exists and the four emergency switches are seeded", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    for (const table of ADMIN_TABLES) {
      const { error } = await supabaseAdmin
        .from(table as never)
        .select("*", { head: true, count: "exact" });
      expect(error, `${table}: ${error?.message}`).toBeNull();
    }
    const { data } = await supabaseAdmin.from("platform_switches").select("key, engaged");
    expect((data ?? []).map((r) => r.key).sort()).toEqual([
      "ai_image",
      "ai_search",
      "ai_text",
      "ai_video",
    ]);
    // Informational: say plainly if something is stopped right now.
    const stopped = (data ?? []).filter((r) => r.engaged).map((r) => r.key);
    if (stopped.length) console.warn(`[admin.live] switches currently engaged: ${stopped}`);
  });

  it("an anonymous client cannot read the admin tables", async () => {
    const anon = createClient(url!, publishable!, { auth: { persistSession: false } });
    for (const table of ADMIN_TABLES) {
      const { data, error } = await anon.from(table).select("*").limit(1);
      // Either the request is refused, or RLS returns nothing. Never rows.
      expect(data ?? [], table).toHaveLength(0);
      if (!error) expect(data, table).toEqual([]);
    }
  });

  it("an anonymous client cannot call the admin functions", async () => {
    const anon = createClient(url!, publishable!, { auth: { persistSession: false } });
    for (const [name, args] of READ_CALLS) {
      const { data, error } = await anon.rpc(name, args);
      expect(error, `${name} should be refused`).not.toBeNull();
      expect(data, name).toBeNull();
    }
  });

  (WRITE ? it : it.skip)("the audit log refuses an edit, even for the service role", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error: insertError } = await supabaseAdmin
      .from("admin_audit_log")
      .insert({ action: "live.check", success: true })
      .select("id")
      .single();
    expect(insertError).toBeNull();
    const { error } = await supabaseAdmin
      .from("admin_audit_log")
      .update({ action: "live.edited" })
      .eq("id", row!.id);
    expect(error?.message ?? "").toMatch(/append-only/);
    const { error: deleteError } = await supabaseAdmin
      .from("admin_audit_log")
      .delete()
      .eq("id", row!.id);
    expect(deleteError?.message ?? "").toMatch(/append-only/);
  });
});
