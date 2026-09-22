// Pricing maths for bought placements. Pure, so it can be tested exactly.
//
// The browser never computes a price that money is taken against. It may render
// these numbers, but every amount that reaches the credit ledger is recomputed
// on the server from the stored provider price.

export type PricingConfig = {
  /** Multiplier applied to the provider's price to get the customer's price. */
  margin: number;
  /** How many credits one US dollar of customer price is worth. */
  creditsPerUsd: number;
};

export const DEFAULT_PRICING: PricingConfig = { margin: 1.6, creditsPerUsd: 100 };

/** Money rounds to cents once, here, so equality comparisons are meaningful. */
export function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

/** What Mellox charges for a placement the provider sells at `providerUsd`. */
export function customerUsd(providerUsd: number, config: PricingConfig = DEFAULT_PRICING): number {
  if (!Number.isFinite(providerUsd) || providerUsd < 0) return 0;
  return roundUsd(providerUsd * config.margin);
}

/**
 * Credits for one placement. Rounded up: a fraction of a credit that Mellox
 * absorbed every time would be a slow leak, and the customer sees whole
 * credits anyway.
 */
export function creditsFor(providerUsd: number, config: PricingConfig = DEFAULT_PRICING): number {
  return Math.ceil(customerUsd(providerUsd, config) * config.creditsPerUsd);
}

/** Credits back to a displayable dollar amount. */
export function creditsToUsd(credits: number, config: PricingConfig = DEFAULT_PRICING): number {
  if (!Number.isFinite(credits) || config.creditsPerUsd <= 0) return 0;
  return roundUsd(credits / config.creditsPerUsd);
}

export type Quote = {
  /** What Mellox will pay the provider, in USD. */
  providerUsd: number;
  /** What the customer pays, in credits. */
  credits: number;
  lines: { donorId: number; providerUsd: number; credits: number }[];
};

export function quoteLines(
  lines: { donorId: number; providerUsd: number }[],
  config: PricingConfig = DEFAULT_PRICING,
): Quote {
  const priced = lines.map((line) => ({
    donorId: line.donorId,
    providerUsd: roundUsd(line.providerUsd),
    credits: creditsFor(line.providerUsd, config),
  }));
  return {
    providerUsd: roundUsd(priced.reduce((sum, line) => sum + line.providerUsd, 0)),
    credits: priced.reduce((sum, line) => sum + line.credits, 0),
    lines: priced,
  };
}

/** Whole credits, formatted the way the UI shows them. */
export function formatCredits(credits: number): string {
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.round(credits)));
}

export function formatUsd(usd: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(usd);
}
