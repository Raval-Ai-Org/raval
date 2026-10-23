import "server-only";

import type { AdminFundingOverview } from "@/lib/admin/types";
import {
  calculateFunding,
  type FundingAccountInput,
  type ProviderBalanceInput,
} from "@/lib/admin/funding";
import type { Meter } from "@/lib/billing/catalog";
import { entitledPlanFor } from "@/server/billing/entitlements.server";
import type { BillingAccount } from "@/server/billing/accounts.server";
import { emailsFor, showEmail } from "./audit-read.server";
import { adminDb, httpErrorFromPg } from "./db.server";

const PAGE_SIZE = 1_000;
const BALANCE_CHUNK = 200;
const EMAIL_CHUNK = 100;

type BalanceRow = {
  account_id: string;
  meter: Meter;
  available: number | string;
  held: number | string;
  debt: number | string;
};

const emptyMeters = (): FundingAccountInput["meters"] => ({
  credits: { available: 0, held: 0, debt: 0 },
  video: { available: 0, held: 0, debt: 0 },
  pro_messages: { available: 0, held: 0, debt: 0 },
  flash_messages: { available: 0, held: 0, debt: 0 },
});

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    out.push(items.slice(index, index + size));
  return out;
}

async function loadAccounts(): Promise<BillingAccount[]> {
  const rows: BillingAccount[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await adminDb
      .from("billing_accounts")
      .select(
        "id,owner_user_id,plan_id,entitled_plan_id,billing_interval,status,trial_ends_at,trial_used,current_period_start,current_period_end,grant_anchor,next_grant_at,grace_until,comped_plan_id,comped_until,enforcement_override,pro_overage_mode,provider,created_at,updated_at",
      )
      .order("id", { ascending: true })
      .range(start, start + PAGE_SIZE - 1);
    if (error) throw httpErrorFromPg(error, "Could not load funding accounts.");
    const page = (data ?? []) as BillingAccount[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function loadBalances(
  accountIds: string[],
): Promise<Map<string, FundingAccountInput["meters"]>> {
  const out = new Map<string, FundingAccountInput["meters"]>();
  const results = await Promise.all(
    chunks(accountIds, BALANCE_CHUNK).map((ids) =>
      adminDb
        .from("meter_balances")
        .select("account_id,meter,available,held,debt")
        .in("account_id", ids),
    ),
  );
  for (const result of results) {
    if (result.error) throw httpErrorFromPg(result.error, "Could not load customer balances.");
    for (const row of (result.data ?? []) as BalanceRow[]) {
      const meters = out.get(row.account_id) ?? emptyMeters();
      if (row.meter in meters) {
        meters[row.meter] = {
          available: Number(row.available ?? 0),
          held: Number(row.held ?? 0),
          debt: Number(row.debt ?? 0),
        };
      }
      out.set(row.account_id, meters);
    }
  }
  return out;
}

async function loadEmails(ownerIds: string[], pii: boolean): Promise<Map<string, string>> {
  const combined = new Map<string, string>();
  const results = await Promise.all(chunks([...new Set(ownerIds)], EMAIL_CHUNK).map(emailsFor));
  for (const result of results) {
    for (const [id, email] of result) combined.set(id, showEmail(email, pii) ?? "");
  }
  return combined;
}

function manualBalance(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function unavailable(
  configured: boolean,
  checkedAt: string,
  message: string,
): ProviderBalanceInput {
  return {
    configured,
    state: configured ? "unavailable" : "not_configured",
    balance: null,
    checkedAt,
    message,
  };
}

async function openRouterBalance(): Promise<ProviderBalanceInput> {
  const checkedAt = new Date().toISOString();
  const key =
    process.env.OPENROUTER_MANAGEMENT_API_KEY?.trim() ?? process.env.OPENROUTER_API_KEY?.trim();
  if (!key) {
    const manual = manualBalance("ADMIN_OPENROUTER_BALANCE_USD");
    return manual === null
      ? unavailable(false, checkedAt, "Add an OpenRouter API key to read the live balance.")
      : {
          configured: false,
          state: "manual",
          balance: manual,
          checkedAt,
          message: "Using ADMIN_OPENROUTER_BALANCE_USD because no API key is configured.",
        };
  }
  try {
    const response = await fetch("https://openrouter.ai/api/v1/credits", {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(String(response.status));
    const payload = (await response.json()) as {
      data?: { total_credits?: number; total_usage?: number };
    };
    const purchased = Number(payload.data?.total_credits);
    const used = Number(payload.data?.total_usage);
    if (!Number.isFinite(purchased) || !Number.isFinite(used)) throw new Error("invalid");
    return {
      configured: true,
      state: "live",
      balance: Math.max(0, purchased - used),
      checkedAt,
      message: "Live balance from OpenRouter.",
    };
  } catch {
    const manual = manualBalance("ADMIN_OPENROUTER_BALANCE_USD");
    return manual === null
      ? unavailable(
          true,
          checkedAt,
          "Balance could not be verified. Use an OpenRouter management key or set ADMIN_OPENROUTER_BALANCE_USD.",
        )
      : {
          configured: true,
          state: "manual",
          balance: manual,
          checkedAt,
          message: "Live lookup failed; using ADMIN_OPENROUTER_BALANCE_USD.",
        };
  }
}

async function kieBalance(): Promise<ProviderBalanceInput> {
  const checkedAt = new Date().toISOString();
  const key = process.env.KIE_API_KEY?.trim();
  if (!key) {
    const manual = manualBalance("ADMIN_KIE_BALANCE_CREDITS");
    return manual === null
      ? unavailable(false, checkedAt, "Add KIE_API_KEY to read the live credit balance.")
      : {
          configured: false,
          state: "manual",
          balance: manual,
          checkedAt,
          message: "Using ADMIN_KIE_BALANCE_CREDITS because no API key is configured.",
        };
  }
  try {
    const response = await fetch("https://api.kie.ai/api/v1/chat/credit", {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(String(response.status));
    const payload = (await response.json()) as { code?: number; data?: number };
    const balance = Number(payload.data);
    if (payload.code !== 200 || !Number.isFinite(balance)) throw new Error("invalid");
    return {
      configured: true,
      state: "live",
      balance: Math.max(0, balance),
      checkedAt,
      message: "Live credit balance from KIE.",
    };
  } catch {
    const manual = manualBalance("ADMIN_KIE_BALANCE_CREDITS");
    return manual === null
      ? unavailable(
          true,
          checkedAt,
          "Balance could not be verified. Check KIE_API_KEY or set ADMIN_KIE_BALANCE_CREDITS.",
        )
      : {
          configured: true,
          state: "manual",
          balance: manual,
          checkedAt,
          message: "Live lookup failed; using ADMIN_KIE_BALANCE_CREDITS.",
        };
  }
}

function dependencies(): AdminFundingOverview["dependencies"] {
  return [
    {
      id: "tavily",
      label: "Tavily",
      configured: Boolean(process.env.TAVILY_API_KEY?.trim()),
      billingModel: "External plan / usage",
      message: "Search balance is not exposed by Mellox; monitor it in Tavily.",
    },
    {
      id: "firecrawl",
      label: "Firecrawl",
      configured: Boolean(
        process.env.FIRECRAWL_API_KEY?.trim() || process.env.FIRECRAWL_BASE_URL?.trim(),
      ),
      billingModel: "Hosted credits or self-hosted",
      message: "Mellox uses the configured Firecrawl deployment when enabled.",
    },
    {
      id: "post_for_me",
      label: "Post for Me",
      configured: Boolean(process.env.POST_FOR_ME_API_KEY?.trim()),
      billingModel: "External plan",
      message: "Publishing capacity is managed in the provider subscription.",
    },
  ];
}

export async function getFundingOverview(pii: boolean): Promise<AdminFundingOverview> {
  const generatedAt = new Date().toISOString();
  const [accounts, openRouter, kie] = await Promise.all([
    loadAccounts(),
    openRouterBalance(),
    kieBalance(),
  ]);
  const [balances, emails] = await Promise.all([
    loadBalances(accounts.map((account) => account.id)),
    loadEmails(
      accounts.map((account) => account.owner_user_id),
      pii,
    ),
  ]);
  return calculateFunding({
    generatedAt,
    openRouter,
    kie,
    dependencies: dependencies(),
    accounts: accounts.map((account) => ({
      accountId: account.id,
      ownerUserId: account.owner_user_id,
      ownerEmail: emails.get(account.owner_user_id) || null,
      planId: entitledPlanFor(account),
      status: account.status,
      interval: account.billing_interval,
      currentPeriodEnd: account.current_period_end,
      nextGrantAt: account.next_grant_at,
      meters: balances.get(account.id) ?? emptyMeters(),
    })),
  });
}
