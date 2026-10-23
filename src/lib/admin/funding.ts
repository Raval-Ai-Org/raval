import type {
  AdminFundingAccount,
  AdminFundingOverview,
  AdminFundingProvider,
} from "@/lib/admin/types";
import { PLANS, type Meter, type PlanId } from "@/lib/billing/catalog";

/** KIE operating reserve requested for launch. One KIE credit is currently $0.005. */
export const KIE_CREDIT_USD = 0.005;
export const OPENROUTER_STANDARD_FEE_PERCENT = 5.5;
export const OPENROUTER_MINIMUM_FEE_USD = 0.8;
export const KIE_RESERVE_USD: Record<PlanId, number> = {
  free: 0,
  starter: 10,
  growth: 15,
  agency: 25,
  scale: 50,
};

export type FundingAccountInput = {
  accountId: string;
  ownerUserId: string;
  ownerEmail: string | null;
  planId: PlanId;
  status: string;
  interval: "month" | "year" | null;
  currentPeriodEnd: string | null;
  nextGrantAt: string | null;
  meters: Record<Meter, { available: number; held: number; debt: number }>;
};

export type ProviderBalanceInput = {
  configured: boolean;
  state: AdminFundingProvider["balanceState"];
  balance: number | null;
  checkedAt: string;
  message: string;
};

const centsUp = (value: number) =>
  value <= 0 ? 0 : Math.ceil(Math.max(0, value) * 100 - 1e-9) / 100;
const emptyRemaining = () => ({ credits: 0, video: 0, proMessages: 0, flashMessages: 0 });

function provider(args: {
  id: AdminFundingProvider["id"];
  label: string;
  reserveUsd: number;
  reserveCredits: number | null;
  balance: ProviderBalanceInput;
  unit: "usd" | "kie_credit";
  topUpUrl: string;
  purchaseFeePercent?: number;
  minimumPurchaseFeeUsd?: number;
}): AdminFundingProvider {
  const rawBalance = args.balance.balance;
  const known = rawBalance !== null;
  const balanceUsd = known
    ? args.unit === "usd"
      ? rawBalance
      : rawBalance * KIE_CREDIT_USD
    : null;
  const balanceCredits = known && args.unit === "kie_credit" ? rawBalance : null;
  const shortfallUsd = balanceUsd === null ? null : centsUp(args.reserveUsd - balanceUsd);
  const shortfallCredits =
    args.reserveCredits === null || balanceCredits === null
      ? null
      : Math.max(0, Math.ceil(args.reserveCredits - balanceCredits));
  const purchaseFeeUsd =
    shortfallUsd === null
      ? null
      : shortfallUsd === 0
        ? 0
        : centsUp(
            Math.max(
              args.minimumPurchaseFeeUsd ?? 0,
              shortfallUsd * ((args.purchaseFeePercent ?? 0) / 100),
            ),
          );
  return {
    id: args.id,
    label: args.label,
    configured: args.balance.configured,
    balanceState: args.balance.state,
    balanceUsd,
    balanceCredits,
    reserveUsd: centsUp(args.reserveUsd),
    reserveCredits: args.reserveCredits,
    shortfallUsd,
    shortfallCredits,
    purchaseFeeUsd,
    cashRequiredUsd:
      shortfallUsd === null || purchaseFeeUsd === null
        ? null
        : centsUp(shortfallUsd + purchaseFeeUsd),
    coveragePercent:
      balanceUsd === null
        ? null
        : args.reserveUsd === 0
          ? 100
          : Math.max(0, Math.round((balanceUsd / args.reserveUsd) * 100)),
    topUpUrl: args.topUpUrl,
    checkedAt: args.balance.checkedAt,
    message: args.balance.message,
  };
}

export function calculateFunding(args: {
  accounts: FundingAccountInput[];
  openRouter: ProviderBalanceInput;
  kie: ProviderBalanceInput;
  dependencies: AdminFundingOverview["dependencies"];
  generatedAt?: string;
}): AdminFundingOverview {
  const planRows = new Map<PlanId, AdminFundingOverview["plans"][number]>();
  const accounts: AdminFundingAccount[] = args.accounts.map((account) => {
    const plan = PLANS[account.planId];
    const reserveEligible = account.status !== "paused";
    const openRouterUsd = reserveEligible ? plan.safety.monthlyUsd : 0;
    const kieUsd = reserveEligible ? KIE_RESERVE_USD[account.planId] : 0;
    const reserve = {
      openRouterUsd,
      kieUsd,
      totalUsd: openRouterUsd + kieUsd,
    };
    const result: AdminFundingAccount = {
      accountId: account.accountId,
      ownerUserId: account.ownerUserId,
      ownerEmail: account.ownerEmail,
      planId: account.planId,
      planLabel: plan.label,
      status: account.status,
      interval: account.interval,
      currentPeriodEnd: account.currentPeriodEnd,
      nextGrantAt: account.nextGrantAt,
      reserveEligible,
      reserve,
      meters: {
        credits: account.meters.credits,
        video: account.meters.video,
        proMessages: account.meters.pro_messages,
        flashMessages: account.meters.flash_messages,
      },
    };
    const current = planRows.get(account.planId) ?? {
      planId: account.planId,
      planLabel: plan.label,
      accounts: 0,
      openRouterReserveUsd: 0,
      kieReserveUsd: 0,
      totalReserveUsd: 0,
      remaining: emptyRemaining(),
    };
    current.accounts += 1;
    current.openRouterReserveUsd += openRouterUsd;
    current.kieReserveUsd += kieUsd;
    current.totalReserveUsd += reserve.totalUsd;
    current.remaining.credits += account.meters.credits.available;
    current.remaining.video += account.meters.video.available;
    current.remaining.proMessages += account.meters.pro_messages.available;
    current.remaining.flashMessages += account.meters.flash_messages.available;
    planRows.set(account.planId, current);
    return result;
  });

  accounts.sort(
    (a, b) =>
      b.reserve.totalUsd - a.reserve.totalUsd ||
      (a.ownerEmail ?? a.accountId).localeCompare(b.ownerEmail ?? b.accountId),
  );
  const openRouterReserve = accounts.reduce((sum, row) => sum + row.reserve.openRouterUsd, 0);
  const kieReserve = accounts.reduce((sum, row) => sum + row.reserve.kieUsd, 0);
  const providers = [
    provider({
      id: "openrouter",
      label: "OpenRouter",
      reserveUsd: openRouterReserve,
      reserveCredits: null,
      balance: args.openRouter,
      unit: "usd",
      topUpUrl: "https://openrouter.ai/settings/credits",
      purchaseFeePercent: OPENROUTER_STANDARD_FEE_PERCENT,
      minimumPurchaseFeeUsd: OPENROUTER_MINIMUM_FEE_USD,
    }),
    provider({
      id: "kie",
      label: "KIE",
      reserveUsd: kieReserve,
      reserveCredits: Math.ceil(kieReserve / KIE_CREDIT_USD),
      balance: args.kie,
      unit: "kie_credit",
      topUpUrl: "https://kie.ai/billing",
    }),
  ];
  const unverifiedProviders = providers.filter((item) => item.balanceUsd === null).length;
  const verifiedTopUpUsd = centsUp(
    providers.reduce((sum, item) => sum + (item.shortfallUsd ?? 0), 0),
  );
  const estimatedCashRequiredUsd = centsUp(
    providers.reduce((sum, item) => sum + (item.cashRequiredUsd ?? 0), 0),
  );
  return {
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    status: providers.some((item) => (item.shortfallUsd ?? 0) > 0)
      ? "action_needed"
      : unverifiedProviders > 0
        ? "unverified"
        : "healthy",
    calculation: {
      policy: "Full monthly plan safety caps plus the KIE launch operating reserve",
      kieCreditUsd: KIE_CREDIT_USD,
      totalReserveUsd: centsUp(openRouterReserve + kieReserve),
      verifiedTopUpUsd,
      estimatedCashRequiredUsd,
      unverifiedProviders,
    },
    providers,
    dependencies: args.dependencies,
    plans: [...planRows.values()].sort(
      (a, b) => Object.keys(PLANS).indexOf(a.planId) - Object.keys(PLANS).indexOf(b.planId),
    ),
    accounts,
  };
}
