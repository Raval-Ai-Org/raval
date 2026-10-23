// Founder finance command center. Stripe is the source of truth for money;
// Mellox's usage ledger supplies the one internal cost we can measure today.
import "server-only";

import Stripe from "stripe";
import type { AdminFinanceMoney, AdminFinanceOverview } from "@/lib/admin/types";
import { getUsage } from "./usage.server";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ROWS = 10_000;
const CACHE_MS = 55_000;

type FinanceData = Extract<AdminFinanceOverview, { configured: true }>;
type Collection<T> = { rows: T[]; truncated: boolean; unavailable: boolean };

let client: Stripe | null = null;
let cache: { expiresAt: number; value: AdminFinanceOverview } | null = null;
let pending: Promise<AdminFinanceOverview> | null = null;

function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  if (!client) client = new Stripe(key);
  return client;
}

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function monthKey(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 7);
}

function trendStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
}

function moneyRows(
  values: Array<{ amount: number; currency: string }> | undefined,
  primary: string,
): AdminFinanceMoney[] {
  return (values ?? [])
    .map((value) => ({ currency: value.currency, amountCents: value.amount }))
    .sort((a, b) => Number(b.currency === primary) - Number(a.currency === primary));
}

async function collect<T>(
  name: string,
  create: () => AsyncIterable<T>,
  cap = MAX_ROWS,
): Promise<Collection<T>> {
  try {
    const rows: T[] = [];
    for await (const row of create()) {
      rows.push(row);
      if (rows.length >= cap) return { rows, truncated: true, unavailable: false };
    }
    return { rows, truncated: false, unavailable: false };
  } catch (error) {
    console.warn(`[admin-finance] ${name} could not be loaded`, error);
    return { rows: [], truncated: false, unavailable: true };
  }
}

function category(transaction: Stripe.BalanceTransaction): string {
  return `${transaction.reporting_category} ${transaction.type}`.toLowerCase();
}

function isSale(transaction: Stripe.BalanceTransaction): boolean {
  const value = category(transaction);
  return (
    transaction.amount > 0 &&
    (transaction.reporting_category === "charge" ||
      transaction.type === "charge" ||
      transaction.type === "payment" ||
      value.includes("payment"))
  );
}

function isRefund(transaction: Stripe.BalanceTransaction): boolean {
  const value = category(transaction);
  return (
    transaction.amount < 0 &&
    (transaction.reporting_category === "refund" ||
      transaction.type === "refund" ||
      transaction.type === "payment_refund" ||
      value.includes("refund"))
  );
}

function isDispute(transaction: Stripe.BalanceTransaction): boolean {
  const value = category(transaction);
  return transaction.amount < 0 && (value.includes("dispute") || value.includes("chargeback"));
}

function isStandaloneFee(transaction: Stripe.BalanceTransaction): boolean {
  return (
    transaction.amount < 0 &&
    (transaction.reporting_category === "fee" ||
      transaction.type === "stripe_fee" ||
      transaction.type === "stripe_fx_fee" ||
      transaction.type === "tax_fee")
  );
}

type RevenueBucket = {
  receivedCents: number;
  refundsCents: number;
  feesCents: number;
  disputesCents: number;
  netRevenueCents: number;
  sales: number;
};

function summarize(transactions: Stripe.BalanceTransaction[]): RevenueBucket {
  const total: RevenueBucket = {
    receivedCents: 0,
    refundsCents: 0,
    feesCents: 0,
    disputesCents: 0,
    netRevenueCents: 0,
    sales: 0,
  };

  for (const transaction of transactions) {
    if (isSale(transaction)) {
      total.receivedCents += transaction.amount;
      total.feesCents += Math.max(0, transaction.fee);
      total.sales += 1;
    } else if (isRefund(transaction)) {
      total.refundsCents += Math.abs(transaction.amount);
      total.feesCents += Math.max(0, transaction.fee);
    } else if (isDispute(transaction)) {
      total.disputesCents += Math.abs(transaction.amount);
      total.feesCents += Math.max(0, transaction.fee);
    } else if (isStandaloneFee(transaction)) {
      total.feesCents += Math.abs(transaction.amount);
    }
  }

  total.netRevenueCents =
    total.receivedCents - total.refundsCents - total.disputesCents - total.feesCents;
  return total;
}

function monthlySeries(transactions: Stripe.BalanceTransaction[], now: Date) {
  const rows = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + index, 1));
    return {
      month: date.toISOString().slice(0, 7),
      receivedCents: 0,
      netRevenueCents: 0,
      refundsCents: 0,
      feesCents: 0,
      sales: 0,
    };
  });
  const byMonth = new Map(rows.map((row) => [row.month, row]));
  const groups = new Map<string, Stripe.BalanceTransaction[]>();
  for (const transaction of transactions) {
    const key = monthKey(transaction.created);
    groups.set(key, [...(groups.get(key) ?? []), transaction]);
  }
  for (const [key, group] of groups) {
    const row = byMonth.get(key);
    if (!row) continue;
    Object.assign(row, summarize(group));
  }
  return rows;
}

function periodSeries(
  transactions: Stripe.BalanceTransaction[],
  now: Date,
): FinanceData["periods"] {
  const starts = [
    {
      key: "today" as const,
      label: "Today",
      date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
    },
    { key: "last7Days" as const, label: "Last 7 days", date: new Date(now.getTime() - 7 * DAY_MS) },
    {
      key: "monthToDate" as const,
      label: "Month to date",
      date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    },
    {
      key: "last30Days" as const,
      label: "Last 30 days",
      date: new Date(now.getTime() - 30 * DAY_MS),
    },
    {
      key: "yearToDate" as const,
      label: "Year to date",
      date: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)),
    },
  ];
  return starts.map(({ key, label, date }) => ({
    key,
    label,
    startsAt: date.toISOString(),
    ...summarize(
      transactions.filter((transaction) => transaction.created * 1000 >= date.getTime()),
    ),
  }));
}

function monthlyAmount(price: Stripe.Price, quantity: number): number {
  if (!price.recurring) return 0;
  const unit = price.unit_amount ?? Number(price.unit_amount_decimal ?? 0);
  const amount = unit * quantity;
  const count = Math.max(1, price.recurring.interval_count);
  switch (price.recurring.interval) {
    case "day":
      return (amount * 365) / 12 / count;
    case "week":
      return (amount * 52) / 12 / count;
    case "month":
      return amount / count;
    case "year":
      return amount / 12 / count;
    default:
      return 0;
  }
}

function productName(price: Stripe.Price, productNames: ReadonlyMap<string, string>): string {
  if (price.nickname?.trim()) return price.nickname.trim();
  if (typeof price.product !== "string" && "name" in price.product && price.product.name) {
    return price.product.name;
  }
  if (typeof price.product === "string" && productNames.has(price.product)) {
    return productNames.get(price.product) as string;
  }
  return price.metadata.catalog_key || price.metadata.plan || "Other";
}

function lineProductId(line: Stripe.InvoiceLineItem): string | null {
  const product = line.pricing?.price_details?.product;
  return typeof product === "string" ? product : null;
}

function recurringSummary(
  subscriptions: Stripe.Subscription[],
  paidInvoices30d: Stripe.Invoice[],
  currency: string,
  productNames: ReadonlyMap<string, string>,
  periodStart: Date,
): FinanceData["recurring"] {
  const plans = new Map<
    string,
    { subscriptions: number; mrrCents: number; revenue30dCents: number }
  >();
  let mrrCents = 0;
  const statusCount = (status: Stripe.Subscription.Status) =>
    subscriptions.filter((subscription) => subscription.status === status).length;

  for (const subscription of subscriptions) {
    if (!(["active", "past_due"] as string[]).includes(subscription.status)) continue;
    let subscriptionMrr = 0;
    let name = "Other";
    for (const [index, item] of subscription.items.data.entries()) {
      if (item.price.currency !== currency) continue;
      if (index === 0) name = productName(item.price, productNames);
      subscriptionMrr += monthlyAmount(item.price, item.quantity ?? 1);
    }
    mrrCents += subscriptionMrr;
    const plan = plans.get(name) ?? { subscriptions: 0, mrrCents: 0, revenue30dCents: 0 };
    plan.subscriptions += 1;
    plan.mrrCents += subscriptionMrr;
    plans.set(name, plan);
  }

  for (const invoice of paidInvoices30d) {
    if (invoice.currency !== currency) continue;
    const line = invoice.lines.data.find((item) => item.amount > 0) ?? invoice.lines.data[0];
    const productId = line ? lineProductId(line) : null;
    const name = productId ? productNames.get(productId) : null;
    if (!name) continue;
    const plan = plans.get(name) ?? { subscriptions: 0, mrrCents: 0, revenue30dCents: 0 };
    plan.revenue30dCents += invoice.amount_paid;
    plans.set(name, plan);
  }

  const active = statusCount("active");
  const canceled30d = subscriptions.filter(
    (subscription) =>
      subscription.status === "canceled" &&
      subscription.canceled_at !== null &&
      subscription.canceled_at * 1000 >= periodStart.getTime(),
  ).length;
  return {
    mrrCents: Math.round(mrrCents),
    arrCents: Math.round(mrrCents * 12),
    active,
    trialing: statusCount("trialing"),
    pastDue: statusCount("past_due"),
    canceling: subscriptions.filter((subscription) => subscription.cancel_at_period_end).length,
    incomplete: statusCount("incomplete") + statusCount("incomplete_expired"),
    unpaid: statusCount("unpaid"),
    paused: statusCount("paused"),
    new30d: subscriptions.filter(
      (subscription) => subscription.created * 1000 >= periodStart.getTime(),
    ).length,
    canceled30d,
    churnPercent: active + canceled30d > 0 ? (canceled30d / (active + canceled30d)) * 100 : null,
    plans: [...plans.entries()]
      .map(([name, value]) => ({
        name,
        subscriptions: value.subscriptions,
        mrrCents: Math.round(value.mrrCents),
        revenue30dCents: value.revenue30dCents,
      }))
      .sort((a, b) => b.mrrCents - a.mrrCents || b.revenue30dCents - a.revenue30dCents),
  };
}

function invoiceItem(invoice: Stripe.Invoice): string {
  const line = invoice.lines.data.find((item) => item.amount > 0) ?? invoice.lines.data[0];
  return line?.description?.trim() || invoice.description?.trim() || "Stripe payment";
}

function invoiceCustomer(invoice: Stripe.Invoice): string {
  return invoice.customer_name || invoice.customer_email || "Stripe customer";
}

function customerId(invoice: Stripe.Invoice): string {
  if (typeof invoice.customer === "string") return invoice.customer;
  return invoice.customer?.id ?? invoice.customer_email ?? invoice.id;
}

function paymentsSummary(charges: Stripe.Charge[], currency: string): FinanceData["payments"] {
  const succeeded = charges.filter((charge) => charge.status === "succeeded");
  const failed = charges.filter((charge) => charge.status === "failed");
  const primary = succeeded.filter((charge) => charge.currency === currency);
  const methods = new Map<string, number>();
  const currencies = new Map<string, { payments: number; receivedCents: number }>();
  for (const charge of succeeded) {
    const method = charge.payment_method_details?.type?.replaceAll("_", " ") || "Other";
    methods.set(method, (methods.get(method) ?? 0) + 1);
    const total = currencies.get(charge.currency) ?? { payments: 0, receivedCents: 0 };
    total.payments += 1;
    total.receivedCents += charge.amount;
    currencies.set(charge.currency, total);
  }
  return {
    succeeded30d: succeeded.length,
    failed30d: failed.length,
    successRatePercent:
      succeeded.length + failed.length > 0
        ? (succeeded.length / (succeeded.length + failed.length)) * 100
        : null,
    averageOrderCents: primary.length
      ? Math.round(primary.reduce((sum, charge) => sum + charge.amount, 0) / primary.length)
      : 0,
    largestOrderCents: Math.max(0, ...primary.map((charge) => charge.amount)),
    methods: [...methods.entries()]
      .map(([method, paymentCount]) => ({
        method,
        payments: paymentCount,
        sharePercent: succeeded.length ? (paymentCount / succeeded.length) * 100 : 0,
      }))
      .sort((a, b) => b.payments - a.payments),
    currencies: [...currencies.entries()]
      .map(([chargeCurrency, value]) => ({ currency: chargeCurrency, ...value }))
      .sort((a, b) => b.payments - a.payments),
    recentFailures: failed.slice(0, 8).map((charge) => ({
      id: charge.id,
      customer: charge.billing_details.name || charge.billing_details.email || "Stripe customer",
      amountCents: charge.amount,
      currency: charge.currency,
      failedAt: iso(charge.created),
      reason:
        charge.failure_message || charge.failure_code?.replaceAll("_", " ") || "Payment failed",
    })),
  };
}

function invoicesSummary(
  invoices: Stripe.Invoice[],
  currency: string,
  periodStart: Date,
  now: Date,
): FinanceData["invoices"] {
  const recent = invoices.filter((invoice) => invoice.created * 1000 >= periodStart.getTime());
  const collectible = recent.filter((invoice) => !["draft", "void"].includes(invoice.status ?? ""));
  const open = invoices.filter(
    (invoice) => invoice.status === "open" && invoice.amount_remaining > 0,
  );
  const nextAttempts = open
    .map((invoice) => invoice.next_payment_attempt)
    .filter((value): value is number => value !== null && value * 1000 > now.getTime());
  return {
    paid30d: recent.filter((invoice) => invoice.status === "paid").length,
    open: open.length,
    overdue: open.filter(
      (invoice) =>
        (invoice.due_date !== null && invoice.due_date * 1000 < now.getTime()) ||
        (invoice.attempted && invoice.next_payment_attempt === null),
    ).length,
    uncollectible: invoices.filter((invoice) => invoice.status === "uncollectible").length,
    draft: invoices.filter((invoice) => invoice.status === "draft").length,
    void: invoices.filter((invoice) => invoice.status === "void").length,
    outstandingCents: open
      .filter((invoice) => invoice.currency === currency)
      .reduce((sum, invoice) => sum + invoice.amount_remaining, 0),
    collectionRatePercent: collectible.length
      ? (collectible.filter((invoice) => invoice.status === "paid").length / collectible.length) *
        100
      : null,
    nextCollectionAt: nextAttempts.length ? iso(Math.min(...nextAttempts)) : null,
    recentOpen: open.slice(0, 8).map((invoice) => ({
      id: invoice.id,
      customer: invoiceCustomer(invoice),
      amountCents: invoice.amount_remaining,
      currency: invoice.currency,
      status:
        invoice.due_date !== null && invoice.due_date * 1000 < now.getTime() ? "overdue" : "open",
      dueAt: invoice.due_date === null ? null : iso(invoice.due_date),
      nextAttemptAt:
        invoice.next_payment_attempt === null ? null : iso(invoice.next_payment_attempt),
    })),
  };
}

function customersSummary(
  customers: Stripe.Customer[],
  paidInvoices30d: Stripe.Invoice[],
  periodStart: Date,
): FinanceData["customers"] {
  const buyerCounts = new Map<string, number>();
  const totals = new Map<
    string,
    { name: string; payments: number; receivedCents: number; currency: string }
  >();
  for (const invoice of paidInvoices30d) {
    const id = customerId(invoice);
    buyerCounts.set(id, (buyerCounts.get(id) ?? 0) + 1);
    const total = totals.get(id) ?? {
      name: invoiceCustomer(invoice),
      payments: 0,
      receivedCents: 0,
      currency: invoice.currency,
    };
    if (total.currency === invoice.currency) total.receivedCents += invoice.amount_paid;
    total.payments += 1;
    totals.set(id, total);
  }
  return {
    total: customers.length,
    new30d: customers.filter((customer) => customer.created * 1000 >= periodStart.getTime()).length,
    repeatBuyers30d: [...buyerCounts.values()].filter((count) => count > 1).length,
    top30d: [...totals.entries()]
      .map(([id, value]) => ({ id, ...value }))
      .sort((a, b) => b.receivedCents - a.receivedCents)
      .slice(0, 8),
  };
}

async function buildFinanceOverview(stripe: Stripe): Promise<AdminFinanceOverview> {
  const now = new Date();
  const generatedAt = now.toISOString();
  const periodStart = new Date(now.getTime() - 30 * DAY_MS);
  const [account, balance] = await Promise.all([
    stripe.accounts.retrieveCurrent(),
    stripe.balance.retrieve(),
  ]);
  const currency = (
    account.default_currency ||
    balance.available[0]?.currency ||
    "usd"
  ).toLowerCase();
  const trendStartSeconds = Math.floor(trendStart(now).getTime() / 1000);
  const periodStartSeconds = Math.floor(periodStart.getTime() / 1000);

  const [
    transactionResult,
    subscriptionResult,
    invoiceResult,
    payoutResult,
    disputeResult,
    chargeResult,
    refundResult,
    customerResult,
    usage,
  ] = await Promise.all([
    collect("balance transactions", () =>
      stripe.balanceTransactions.list({
        created: { gte: trendStartSeconds },
        currency,
        limit: 100,
      }),
    ),
    collect("subscriptions", () => stripe.subscriptions.list({ status: "all", limit: 100 })),
    collect("invoices", () => stripe.invoices.list({ limit: 100 })),
    collect("payouts", () =>
      stripe.payouts.list({ created: { gte: trendStartSeconds }, limit: 100 }),
    ),
    collect("disputes", () => stripe.disputes.list({ limit: 100 }), 5_000),
    collect("charges", () =>
      stripe.charges.list({ created: { gte: periodStartSeconds }, limit: 100 }),
    ),
    collect("refunds", () =>
      stripe.refunds.list({ created: { gte: periodStartSeconds }, limit: 100 }),
    ),
    collect("customers", () => stripe.customers.list({ limit: 100 })),
    getUsage(30).catch((error: unknown) => {
      console.warn("[admin-finance] AI cost could not be loaded", error);
      return null;
    }),
  ]);

  const transactions = transactionResult.rows;
  const subscriptions = subscriptionResult.rows;
  const invoices = invoiceResult.rows;
  const payouts = payoutResult.rows;
  const disputes = disputeResult.rows;
  const charges = chargeResult.rows;
  const refunds = refundResult.rows;
  const customers = customerResult.rows.filter(
    (customer): customer is Stripe.Customer => !("deleted" in customer && customer.deleted),
  );
  const periodTransactions = transactions.filter(
    (transaction) => transaction.created * 1000 >= periodStart.getTime(),
  );
  const period = summarize(periodTransactions);
  const periods = periodSeries(transactions, now);
  const paidInvoices30d = invoices.filter(
    (invoice) =>
      invoice.status === "paid" &&
      invoice.amount_paid > 0 &&
      (invoice.status_transitions.paid_at ?? invoice.created) * 1000 >= periodStart.getTime(),
  );
  const productIds = [
    ...new Set([
      ...subscriptions.flatMap((subscription) =>
        subscription.items.data.flatMap((item) =>
          typeof item.price.product === "string" ? [item.price.product] : [],
        ),
      ),
      ...paidInvoices30d.flatMap((invoice) =>
        invoice.lines.data.flatMap((line) => {
          const id = lineProductId(line);
          return id ? [id] : [];
        }),
      ),
    ]),
  ].slice(0, 200);
  const productNames = new Map(
    (
      await Promise.all(
        productIds.map(async (id) => {
          const product = await stripe.products.retrieve(id).catch(() => null);
          return product && !("deleted" in product) ? ([id, product.name] as const) : null;
        }),
      )
    ).filter((row): row is readonly [string, string] => row !== null),
  );
  const estimatedAiCostUsd = usage?.totals.costUsd ?? null;
  const estimatedProfitCents =
    currency === "usd" && estimatedAiCostUsd !== null
      ? period.netRevenueCents - Math.round(estimatedAiCostUsd * 100)
      : null;
  const paidPayouts = payouts.filter(
    (payout) =>
      payout.currency === currency &&
      payout.status === "paid" &&
      payout.created * 1000 >= periodStart.getTime(),
  );
  const failedPayouts30d = payouts.filter(
    (payout) => payout.status === "failed" && payout.created * 1000 >= periodStart.getTime(),
  );
  const openDisputeStatuses = new Set([
    "needs_response",
    "under_review",
    "warning_needs_response",
    "warning_under_review",
  ]);
  const pipeline = payouts.filter(
    (payout) => payout.currency === currency && ["pending", "in_transit"].includes(payout.status),
  );
  const futureArrivals = pipeline
    .map((payout) => payout.arrival_date)
    .filter((arrival) => arrival * 1000 >= now.getTime());
  const collections = {
    transactions: transactionResult,
    subscriptions: subscriptionResult,
    invoices: invoiceResult,
    payouts: payoutResult,
    disputes: disputeResult,
    charges: chargeResult,
    refunds: refundResult,
    customers: customerResult,
  };

  return {
    configured: true,
    generatedAt,
    livemode: balance.livemode,
    currency,
    account: {
      businessName: account.business_profile?.name ?? null,
      country: account.country ?? null,
      defaultCurrency: currency,
      chargesEnabled: Boolean(account.charges_enabled),
      payoutsEnabled: Boolean(account.payouts_enabled),
      detailsSubmitted: Boolean(account.details_submitted),
      requirements: {
        currentlyDue: account.requirements?.currently_due ?? [],
        eventuallyDue: account.requirements?.eventually_due ?? [],
        pastDue: account.requirements?.past_due ?? [],
        pendingVerification: account.requirements?.pending_verification ?? [],
      },
    },
    balance: {
      available: moneyRows(balance.available, currency),
      pending: moneyRows(balance.pending, currency),
      instantAvailable: moneyRows(balance.instant_available, currency),
      connectReserved: moneyRows(balance.connect_reserved, currency),
      refundPrefundingAvailable: moneyRows(
        balance.refund_and_dispute_prefunding?.available,
        currency,
      ),
      refundPrefundingPending: moneyRows(balance.refund_and_dispute_prefunding?.pending, currency),
    },
    periods,
    last30Days: {
      startsAt: periodStart.toISOString(),
      ...period,
      paidOutCents: paidPayouts.reduce((sum, payout) => sum + payout.amount, 0),
      estimatedAiCostUsd,
      estimatedProfitCents,
      marginPercent:
        estimatedProfitCents !== null && period.receivedCents > 0
          ? (estimatedProfitCents / period.receivedCents) * 100
          : null,
    },
    recurring: recurringSummary(
      subscriptions,
      paidInvoices30d,
      currency,
      productNames,
      periodStart,
    ),
    customers: customersSummary(customers, paidInvoices30d, periodStart),
    payments: paymentsSummary(charges, currency),
    invoices: invoicesSummary(invoices, currency, periodStart, now),
    payoutPipeline: {
      pendingCents: pipeline
        .filter((payout) => payout.status === "pending")
        .reduce((sum, payout) => sum + payout.amount, 0),
      inTransitCents: pipeline
        .filter((payout) => payout.status === "in_transit")
        .reduce((sum, payout) => sum + payout.amount, 0),
      failedCents30d: failedPayouts30d
        .filter((payout) => payout.currency === currency)
        .reduce((sum, payout) => sum + payout.amount, 0),
      nextArrivalAt: futureArrivals.length ? iso(Math.min(...futureArrivals)) : null,
    },
    health: {
      failedInvoices30d: invoices.filter(
        (invoice) =>
          invoice.created * 1000 >= periodStart.getTime() &&
          ((invoice.status === "open" && invoice.attempted && invoice.amount_remaining > 0) ||
            invoice.status === "uncollectible"),
      ).length,
      refundedTransactions30d: refunds.length,
      openDisputes: disputes.filter((dispute) => openDisputeStatuses.has(dispute.status)).length,
      failedPayouts30d: failedPayouts30d.length,
    },
    monthly: monthlySeries(transactions, now),
    recentSales: paidInvoices30d.slice(0, 12).map((invoice) => ({
      id: invoice.id,
      customer: invoiceCustomer(invoice),
      item: invoiceItem(invoice),
      amountCents: invoice.amount_paid,
      currency: invoice.currency,
      paidAt: iso(invoice.status_transitions.paid_at ?? invoice.created),
      kind: (invoice.billing_reason ?? "invoice").replaceAll("_", " "),
    })),
    recentPayouts: payouts.slice(0, 10).map((payout) => ({
      id: payout.id,
      amountCents: payout.amount,
      currency: payout.currency,
      status: payout.status,
      createdAt: iso(payout.created),
      arrivalAt: iso(payout.arrival_date),
      method: payout.method,
    })),
    recentRefunds: refunds.slice(0, 8).map((refund) => ({
      id: refund.id,
      amountCents: refund.amount,
      currency: refund.currency,
      status: refund.status ?? "unknown",
      reason: refund.reason?.replaceAll("_", " ") ?? "Not specified",
      createdAt: iso(refund.created),
    })),
    recentDisputes: disputes.slice(0, 8).map((dispute) => ({
      id: dispute.id,
      amountCents: dispute.amount,
      currency: dispute.currency,
      status: dispute.status,
      reason: dispute.reason.replaceAll("_", " "),
      createdAt: iso(dispute.created),
      evidenceDueAt: dispute.evidence_details.due_by ? iso(dispute.evidence_details.due_by) : null,
    })),
    coverage: {
      truncated: Object.entries(collections)
        .filter(([, result]) => result.truncated)
        .map(([name]) => name),
      unavailable: Object.entries(collections)
        .filter(([, result]) => result.unavailable)
        .map(([name]) => name),
    },
  };
}

export async function getFinanceOverview(): Promise<AdminFinanceOverview> {
  const stripe = stripeClient();
  if (!stripe) return { configured: false, generatedAt: new Date().toISOString() };
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  if (pending) return pending;
  pending = buildFinanceOverview(stripe)
    .then((value) => {
      cache = { expiresAt: Date.now() + CACHE_MS, value };
      return value;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
