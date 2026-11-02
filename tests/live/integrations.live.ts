// Live check of the Composio integration layer (ADR-0042) against the real
// Composio project (COMPOSIO_API_KEY) and the real Supabase project.
//
//   the key works and every tool slug in the catalog exists at Composio
//   for every connectable Composio app: the gateway finds (or makes once) a
//   managed sign-in, makes a sign-in link for a throwaway user, reads the
//   pending account back, and deletes it again
//   the migration is applied: both tables answer
//
// Opt-in: COMPOSIO_LIVE_ACCOUNT_<APP>=<connected account id> (an account a
// person connected through the app) also runs that app's first read tool.
// Nothing here posts, and every account it makes is deleted.
//   npx vitest run --config vitest.live.config.ts tests/live/integrations.live.ts
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { INTEGRATION_APPS, composioUserId } from "@/lib/integrations/catalog";
import {
  ComposioGatewayError,
  authConfigFor,
  createLink,
  deleteAccount,
  executeTool,
  getAccount,
} from "@/server/integrations/composio/gateway.server";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const KEY = process.env.COMPOSIO_API_KEY?.trim();
const BASE = (process.env.COMPOSIO_BASE_URL || "https://backend.composio.dev/api/v3.1").replace(
  /\/$/,
  "",
);
const describeLive = KEY ? describe : describe.skip;
const composioApps = INTEGRATION_APPS.filter((app) => app.method === "composio" && app.toolkit);

describeLive("Composio integration layer (live)", () => {
  it("knows every tool slug in the catalog", async () => {
    const slugs = [...new Set(composioApps.flatMap((app) => app.tools.map((t) => t.slug)))];
    const missing: string[] = [];
    for (const slug of slugs) {
      const res = await fetch(`${BASE}/tools/${encodeURIComponent(slug)}`, {
        headers: { "x-api-key": KEY! },
      });
      if (res.status !== 200) missing.push(`${slug} (${res.status})`);
    }
    expect(missing).toEqual([]);
  });

  const social = composioApps.filter((app) => app.availability !== "later");
  for (const app of social) {
    it(`makes and removes a sign-in link for ${app.name}`, async () => {
      const authConfigId = await authConfigFor(app.toolkit!);
      expect(authConfigId).toMatch(/^ac_/);
      const userId = composioUserId(`live-check-${Date.now()}`);
      const link = await createLink({
        toolkit: app.toolkit!,
        userId,
        callbackUrl: "https://example.com/api/integrations/apps/callback?state=live-check",
      });
      try {
        expect(link.redirectUrl).toMatch(/^https:\/\//);
        const pending = await getAccount(link.connectedAccountId);
        expect(pending.toolkit).toBe(app.toolkit);
        if (pending.userId) expect(pending.userId).toBe(userId);
        expect(["INITIALIZING", "INITIATED", "INACTIVE"]).toContain(pending.status);
      } finally {
        await deleteAccount(link.connectedAccountId);
      }
      await expect(getAccount(link.connectedAccountId)).rejects.toSatisfy(
        (e) => e instanceof ComposioGatewayError && e.kind === "not_found",
      );
    });

    const accountId = process.env[`COMPOSIO_LIVE_ACCOUNT_${app.id.toUpperCase()}`];
    const read = app.tools.find((t) => !t.write);
    (accountId && read ? it : it.skip)(`reads from a connected ${app.name} account`, async () => {
      const account = await getAccount(accountId!);
      expect(account.status).toBe("ACTIVE");
      const result = await executeTool({
        tool: read!.slug,
        userId: account.userId ?? "",
        connectedAccountId: accountId!,
        arguments: {},
        write: false,
      });
      expect(result.successful, result.error ?? "").toBe(true);
    });
  }
});

const describeDb = process.env.SUPABASE_SERVICE_ROLE_KEY ? describe : describe.skip;
describeDb("integration tables (live)", () => {
  it("answer on the real database", async () => {
    const admin = createClient(
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    for (const table of ["integration_accounts", "integration_tool_calls"]) {
      const { error } = await admin.from(table).select("id").limit(1);
      expect(error, table).toBeNull();
    }
  });
});
