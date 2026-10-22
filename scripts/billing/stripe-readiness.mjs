// Verify Stripe, catalog prices, webhook subscriptions and Supabase health
// without printing credentials. Use --probe only after production deploys.
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { ADDONS, CREDIT_PACKS, PAUSE, PLANS, VIDEO_PACKS } from "../../src/lib/billing/catalog.ts";

// This is a production operations command. Deliberately ignore .env.local,
// which normally points APP_URL at localhost for application development.
if (existsSync(".env")) process.loadEnvFile(".env");

const probe = process.argv.includes("--probe");
const confirmProduction = process.argv.includes("--confirm-production");
const secret = process.env.STRIPE_SECRET_KEY?.trim();
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
const appUrl = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL)?.trim().replace(/\/$/, "");
const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!secret || !webhookSecret || !appUrl || !supabaseUrl || !serviceKey) {
  throw new Error(
    "STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, APP_URL, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.",
  );
}

const environment = secret.startsWith("sk_live_") ? "production" : "sandbox";
if (probe && environment === "production" && !confirmProduction) {
  throw new Error("A live webhook probe requires --confirm-production.");
}

const stripe = new Stripe(secret);
const db = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const endpointUrl = `${appUrl}/api/public/hooks/stripe`;
const requiredEvents = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "charge.refunded",
  "charge.dispute.created",
];
const expectedPrices = [
  ...Object.values(PLANS)
    .filter((plan) => plan.id !== "free")
    .flatMap((plan) => [
      { key: plan.id, interval: "month", cents: plan.priceMonthlyUsd * 100 },
      { key: plan.id, interval: "year", cents: plan.priceAnnualUsd * 100 },
    ]),
  ...CREDIT_PACKS.map((pack) => ({
    key: pack.key,
    interval: "one_time",
    cents: pack.usd * 100,
  })),
  ...VIDEO_PACKS.map((pack) => ({
    key: pack.key,
    interval: "one_time",
    cents: pack.usd * 100,
  })),
  ...Object.values(ADDONS)
    .filter((addon) => addon.availability === "launch")
    .flatMap((addon) => [
      { key: addon.key, interval: "month", cents: addon.usdPerMonth * 100 },
      { key: addon.key, interval: "year", cents: addon.usdPerMonth * 1200 },
    ]),
  { key: "pause", interval: "month", cents: PAUSE.usdPerMonth * 100 },
];

const results = [];
function check(label, ok, detail = "") {
  results.push({ label, ok });
  console.log(`${ok ? "OK" : "FAIL"}  ${label}${detail ? ` (${detail})` : ""}`);
}

const account = await stripe.accounts.retrieve();
check("Stripe API authentication", true, environment);
check("Stripe account can accept charges", Boolean(account.charges_enabled));
check("Stripe account can receive payouts", Boolean(account.payouts_enabled));

const { data: mappings, error: mappingError } = await db
  .from("billing_price_map")
  .select("catalog_key,interval,provider_price_id,amount_cents,active")
  .eq("environment", environment)
  .eq("active", true);
if (mappingError) throw mappingError;

const byCatalogEntry = new Map(
  (mappings ?? []).map((row) => [`${row.catalog_key}/${row.interval}`, row]),
);
let verifiedPrices = 0;
for (const expected of expectedPrices) {
  const row = byCatalogEntry.get(`${expected.key}/${expected.interval}`);
  if (!row || Number(row.amount_cents) !== expected.cents) continue;
  try {
    const price = await stripe.prices.retrieve(row.provider_price_id);
    const intervalMatches =
      expected.interval === "one_time"
        ? !price.recurring
        : price.recurring?.interval === expected.interval;
    if (
      price.active &&
      price.livemode === (environment === "production") &&
      price.currency === "usd" &&
      price.unit_amount === expected.cents &&
      intervalMatches
    ) {
      verifiedPrices++;
    }
  } catch {
    // The summary reports the mismatch without exposing provider ids.
  }
}
check(
  "Catalog prices",
  verifiedPrices === expectedPrices.length,
  `${verifiedPrices}/${expectedPrices.length}`,
);

const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
const endpoint = endpoints.data.find(
  (candidate) => candidate.url === endpointUrl && candidate.status === "enabled",
);
check("Webhook endpoint enabled", Boolean(endpoint), endpointUrl);
const hasRequiredEvents = Boolean(
  endpoint &&
  (endpoint.enabled_events.includes("*") ||
    requiredEvents.every((event) => endpoint.enabled_events.includes(event))),
);
check("Required webhook events", hasRequiredEvents, `${requiredEvents.length} required`);

async function readHealth() {
  const { data, error } = await db
    .from("billing_provider_health")
    .select("webhook_verified_at,credential_fingerprint")
    .eq("environment", environment)
    .maybeSingle();
  if (error) throw error;
  return data;
}

const fingerprint = createHash("sha256").update(`${secret}:${webhookSecret}`).digest("hex");

if (probe) {
  if (!endpoint) throw new Error("The enabled Mellox webhook endpoint was not found.");
  const originalEvents = [...endpoint.enabled_events];
  let customer = null;
  try {
    if (!originalEvents.includes("*") && !originalEvents.includes("customer.created")) {
      await stripe.webhookEndpoints.update(endpoint.id, {
        enabled_events: [...originalEvents, "customer.created"].sort(),
      });
    }
    customer = await stripe.customers.create(
      {
        description: "Mellox webhook readiness probe",
        metadata: { mellox_setup_probe: "true" },
      },
      { idempotencyKey: `mellox-webhook-probe:${randomUUID()}` },
    );
    for (let attempt = 0; attempt < 45; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const health = await readHealth();
      if (health?.webhook_verified_at && health.credential_fingerprint === fingerprint) break;
    }
  } finally {
    if (customer) {
      try {
        await stripe.customers.del(customer.id);
      } catch {}
    }
    if (!originalEvents.includes("*") && !originalEvents.includes("customer.created")) {
      await stripe.webhookEndpoints.update(endpoint.id, { enabled_events: originalEvents });
    }
  }
}

const health = await readHealth();
check(
  "Signed webhook delivery",
  Boolean(health?.webhook_verified_at && health.credential_fingerprint === fingerprint),
  probe ? "probe completed" : "use --probe after deployment if this fails",
);

if (results.some((result) => !result.ok)) process.exitCode = 1;
