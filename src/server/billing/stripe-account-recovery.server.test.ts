import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.hoisted(() => vi.fn());
const retrieveSession = vi.hoisted(() => vi.fn());
const listLineItems = vi.hoisted(() => vi.fn());
const accountForUser = vi.hoisted(() => vi.fn());
const invalidateBillingAccount = vi.hoisted(() => vi.fn());

vi.mock("stripe", () => ({
  default: class StripeMock {
    checkout = { sessions: { retrieve: retrieveSession, listLineItems } };
  },
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from },
}));
vi.mock("./accounts.server", () => ({ accountForUser, invalidateBillingAccount }));
vi.mock("./grants.server", () => ({
  nextMonthlyWindow: vi.fn(),
  grantPlanWindow: vi.fn(),
  grantPlanUpgrade: vi.fn(),
  grantAddonWindow: vi.fn(),
  grantAddonUpgrade: vi.fn(),
}));
vi.mock("./meters.server", () => ({ grantMeter: vi.fn(), clawbackMeter: vi.fn() }));

import { getAccountCheckoutStatus, replayFailedBillingEvents } from "./stripe-account.server";

type DbResult = { data: unknown; error: unknown };

function dbChain(result: DbResult) {
  const chain: Record<string, ReturnType<typeof vi.fn>> & {
    then?: Promise<DbResult>["then"];
  } = {};
  for (const method of [
    "select",
    "eq",
    "is",
    "update",
    "insert",
    "in",
    "lt",
    "lte",
    "order",
    "limit",
  ]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn(async () => result);
  chain.maybeSingle = vi.fn(async () => result);
  chain.then = (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected);
  return chain;
}

const intent = {
  id: "11111111-1111-4111-8111-111111111111",
  account_id: "22222222-2222-4222-8222-222222222222",
  created_by: "33333333-3333-4333-8333-333333333333",
  kind: "credit_pack",
  catalog_key: "credits_25",
  interval: null,
  quantity: 1,
  provider_price_id: "price_credits_25",
  provider_session_id: "cs_test_recovery",
  expires_at: "2030-01-01T00:00:00.000Z",
  consumed_at: null,
};

const paidSession = {
  id: "cs_test_recovery",
  status: "complete",
  payment_status: "paid",
  mode: "payment",
  metadata: { mellox_checkout_intent: intent.id },
  client_reference_id: intent.id,
  customer: "cus_owner",
  payment_intent: "pi_paid",
  currency: "usd",
  amount_total: 2500,
  created: 1_700_000_000,
  expires_at: 1_800_000_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  from.mockReset();
  retrieveSession.mockReset();
  listLineItems.mockReset();
  accountForUser.mockReset();
  process.env.STRIPE_SECRET_KEY = "sk_test_recovery";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_recovery";
  accountForUser.mockResolvedValue({ id: intent.account_id });
});

describe("Stripe Checkout activation recovery", () => {
  it("finishes a paid pack whose payment record exists but checkout marker was missed", async () => {
    const ownerLookup = dbChain({ data: intent, error: null });
    const intentLookup = dbChain({ data: intent, error: null });
    const accountLookup = dbChain({ data: { provider_customer_id: "cus_owner" }, error: null });
    const paymentLookup = dbChain({
      data: {
        provider_payment_id: "pi_paid",
        account_id: intent.account_id,
        checkout_intent_id: intent.id,
        kind: intent.kind,
      },
      error: null,
    });
    const consume = dbChain({ data: null, error: null });
    const refreshed = dbChain({
      data: { consumed_at: "2026-10-23T00:00:00.000Z" },
      error: null,
    });
    from
      .mockReturnValueOnce(ownerLookup)
      .mockReturnValueOnce(intentLookup)
      .mockReturnValueOnce(accountLookup)
      .mockReturnValueOnce(paymentLookup)
      .mockReturnValueOnce(consume)
      .mockReturnValueOnce(refreshed);
    retrieveSession.mockResolvedValue(paidSession);
    listLineItems.mockResolvedValue({
      data: [{ price: { id: intent.provider_price_id }, quantity: 1 }],
    });

    await expect(
      getAccountCheckoutStatus(intent.created_by, intent.provider_session_id),
    ).resolves.toEqual({ state: "active", kind: "credit_pack", catalogKey: "credits_25" });
    expect(consume.update).toHaveBeenCalledWith({ consumed_at: expect.any(String) });
  });

  it("reports a consumed unpaid Checkout as failed instead of active", async () => {
    const failedIntent = { ...intent, consumed_at: "2026-10-23T00:00:00.000Z" };
    from.mockReturnValueOnce(dbChain({ data: failedIntent, error: null }));
    retrieveSession.mockResolvedValue({ ...paidSession, payment_status: "unpaid" });

    await expect(
      getAccountCheckoutStatus(intent.created_by, intent.provider_session_id),
    ).resolves.toEqual({ state: "failed", kind: "credit_pack", catalogKey: "credits_25" });
  });

  it("archives a signed sandbox event after billing switches to live Stripe", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_recovery";
    const pending = dbChain({
      data: [{ id: "evt_sandbox", payload: { id: "evt_sandbox", livemode: false } }],
      error: null,
    });
    const archive = dbChain({ data: null, error: null });
    from.mockReturnValueOnce(pending).mockReturnValueOnce(archive);

    await expect(replayFailedBillingEvents()).resolves.toEqual({
      replayed: 0,
      failed: 0,
      archived: 1,
    });
    expect(archive.update).toHaveBeenCalledWith({
      processed_at: expect.any(String),
      error: "Archived after Stripe billing environment changed.",
    });
  });
});
