# Stripe at Mellox: what to change where

Hi Umar, checkout now runs on Mellox's own page (`/checkout`: Plan → Payment →
Launch), with Stripe's card fields inside it. Live payments are switched on:
all 21 prices match and the readiness check passes. Here is how to change
things without breaking it.

## 1. Prices and packages: change them in the code, then run one command

Mellox only sells a price that matches `src/lib/billing/catalog.ts` **to the
cent**. That file is what customers see on the pricing cards and checkout
(prices, credits, brands, seats). If a Stripe price stops matching it, Mellox
safely turns purchasing off ("Payments open soon") rather than charging a
customer something different from what they were shown.

So **don't change prices in the Stripe dashboard**. To change a plan, pack or
add-on:

1. Edit `src/lib/billing/catalog.ts` (`PLANS`, `CREDIT_PACKS`, `ADDONS`):
   price, credits, limits, highlights.
2. Deploy.
3. From the repo, with the live keys in `.env`:

   ```bash
   npm run billing:stripe-sync -- --production --apply --confirm-production
   ```

   This creates only the Stripe prices that changed and links them. Existing
   subscribers keep their old price until they change plan.
4. Check it:

   ```bash
   npm run billing:stripe-readiness
   ```

   Every line must say `OK`, including `Catalog prices (21/21)`.

## 2. Safe to change in the Stripe dashboard

- **Settings → Business → Public details**: the name customers see. It
  currently says **"Antrosys"** (checkout shows "Save payment details to
  Antrosys"). Change it to **Mellox AI**, and set the support email and URL.
- **Settings → Branding**: logo, icon and colours on receipts and invoices.
- **Settings → Customer emails**: turn on "Successful payments" so customers
  get a receipt.
- **Settings → Payment methods → Payment method domains**: add `mellox.ai`
  so Apple Pay and Google Pay buttons appear on the checkout.
- Coupons and promotion codes, refunds, disputes, reports.

## 3. Don't do these in the dashboard

- Don't archive or edit a price Mellox uses. Make a price change through
  step 1 instead.
- Don't delete or change the webhook `https://mellox.ai/api/public/hooks/stripe`
  or its events.
- Don't roll the API keys unless you update the server at the same time:
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY` (the
  `pk_live_…` key, new: the checkout page needs it in production).

## 4. After a deploy

Make one real purchase (the $15 credit pack) on mellox.ai, check that the
credits arrive and the Launch screen says "Payment confirmed", then refund it
in Stripe.
