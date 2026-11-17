// Money Mellox can spend right now: the OpenRouter and KIE balances (read live
// from each provider, with the reserve its paying customers could still use)
// and, for billing admins, the Stripe balance. Read only when an admin asks.
import "server-only";

import type { AdminBalances } from "@/lib/admin/types";
import { getStripeBalance } from "./finance.server";
import { getFundingOverview } from "./funding.server";

export async function getBalances(withStripe: boolean): Promise<AdminBalances> {
  const [funding, stripe] = await Promise.all([
    getFundingOverview(false),
    withStripe
      ? getStripeBalance().catch((error: unknown) => {
          console.error("[admin] stripe balance", error instanceof Error ? error.message : error);
          return null;
        })
      : Promise.resolve(null),
  ]);
  return {
    fetchedAt: new Date().toISOString(),
    providers: funding.providers.map((provider) => ({
      id: provider.id,
      label: provider.label,
      state: provider.balanceState,
      balanceUsd: provider.balanceUsd,
      balanceCredits: provider.balanceCredits,
      reserveUsd: provider.reserveUsd,
      message: provider.message,
      topUpUrl: provider.topUpUrl,
    })),
    stripe: withStripe ? (stripe ?? { configured: false }) : null,
  };
}
