// Dry-run by default. --apply writes Stripe products/prices and the local
// billing_price_map. Requires Node 24 for importing the browser-safe catalog.
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { PLANS, CREDIT_PACKS, VIDEO_PACKS, ADDONS, PAUSE } from "../../src/lib/billing/catalog.ts";

const apply = process.argv.includes("--apply");
const environment = process.argv.includes("--production") ? "production" : "sandbox";
const entries = [
  ...Object.values(PLANS)
    .filter((plan) => plan.id !== "free")
    .flatMap((plan) => [
      {
        key: plan.id,
        interval: "month",
        cents: plan.priceMonthlyUsd * 100,
        name: `${plan.label} monthly`,
      },
      {
        key: plan.id,
        interval: "year",
        cents: plan.priceAnnualUsd * 100,
        name: `${plan.label} annual`,
      },
    ]),
  ...CREDIT_PACKS.map((pack) => ({
    key: pack.key,
    interval: "one_time",
    cents: pack.usd * 100,
    name: `${pack.credits + pack.bonusCredits} Mellox Credits`,
  })),
  ...VIDEO_PACKS.map((pack) => ({
    key: pack.key,
    interval: "one_time",
    cents: pack.usd * 100,
    name: `${pack.videoUnits / 100} Video Credits`,
  })),
  ...Object.values(ADDONS)
    .filter((addon) => addon.availability === "launch")
    .flatMap((addon) => [
      {
        key: addon.key,
        interval: "month",
        cents: addon.usdPerMonth * 100,
        name: `${addon.label} monthly`,
      },
      {
        key: addon.key,
        interval: "year",
        cents: addon.usdPerMonth * 1200,
        name: `${addon.label} annual`,
      },
    ]),
  { key: "pause", interval: "month", cents: PAUSE.usdPerMonth * 100, name: "Mellox pause plan" },
];

if (!apply) {
  for (const item of entries)
    console.log(`${item.key}\t${item.interval}\tUSD ${(item.cents / 100).toFixed(2)}`);
  console.log(`Dry run: ${entries.length} prices; pass --apply to write ${environment}.`);
  process.exit(0);
}

const key = process.env.STRIPE_SECRET_KEY?.trim();
const url = process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!key || !url || !serviceKey)
  throw new Error("Stripe and Supabase service credentials are required.");
if (environment === "production" && !key.startsWith("sk_live_"))
  throw new Error("Production requires a live Stripe key.");
if (environment === "sandbox" && !key.startsWith("sk_test_"))
  throw new Error("Sandbox requires a test Stripe key.");
if (environment === "production" && !process.argv.includes("--confirm-production")) {
  throw new Error("Production requires --confirm-production.");
}

const stripe = new Stripe(key);
const db = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
for (const item of entries) {
  const { data: existing, error: readError } = await db
    .from("billing_price_map")
    .select("provider_price_id,amount_cents,provider_product_id")
    .eq("catalog_key", item.key)
    .eq("interval", item.interval)
    .eq("environment", environment)
    .maybeSingle();
  if (readError) throw readError;
  if (
    existing &&
    existing.amount_cents === item.cents &&
    existing.provider_price_id.startsWith("price_")
  ) {
    const verified = await stripe.prices.retrieve(existing.provider_price_id);
    if (
      !verified.active ||
      verified.currency !== "usd" ||
      verified.unit_amount !== item.cents ||
      (item.interval === "one_time"
        ? Boolean(verified.recurring)
        : verified.recurring?.interval !== item.interval)
    ) {
      throw new Error(`Stripe price differs from the catalog: ${item.key}/${item.interval}`);
    }
    console.log(`${item.key}/${item.interval}: unchanged`);
    continue;
  }
  const product = existing?.provider_product_id?.startsWith("prod_")
    ? await stripe.products.retrieve(existing.provider_product_id)
    : await stripe.products.create(
        { name: item.name, metadata: { mellox_catalog_key: item.key } },
        { idempotencyKey: `mellox-product:${item.key}` },
      );
  const price = await stripe.prices.create(
    {
      product: product.id,
      currency: "usd",
      unit_amount: item.cents,
      ...(item.interval === "one_time" ? {} : { recurring: { interval: item.interval } }),
      metadata: { mellox_catalog_key: item.key, mellox_interval: item.interval },
    },
    { idempotencyKey: `mellox-price:${item.key}:${item.interval}:${item.cents}` },
  );
  const { error: writeError } = await db.from("billing_price_map").upsert(
    {
      catalog_key: item.key,
      interval: item.interval,
      environment,
      provider_price_id: price.id,
      provider_product_id: product.id,
      amount_cents: item.cents,
      active: true,
    },
    { onConflict: "catalog_key,interval,environment" },
  );
  if (writeError) throw writeError;
  console.log(`${item.key}/${item.interval}: synced`);
}
