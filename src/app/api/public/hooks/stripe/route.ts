// POST /api/public/hooks/stripe — Stripe's payment webhook.
//
// Deliberately NOT a defineCronRoute and NOT behind the app's own auth: Stripe
// authenticates itself by signing the request body, and the signature is
// checked against the raw bytes before anything is read. An unsigned or
// mis-signed request is refused before it can touch a credit balance.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return Response.json({ ok: false, error: "Missing signature" }, { status: 400 });
  }

  // The raw body, byte for byte — parsing it first would break the signature.
  const rawBody = await request.text();

  try {
    const { handleWebhook } = await import("@/server/billing/stripe.server");
    const outcome = await handleWebhook(rawBody, signature);
    // Stripe retries on a non-2xx, so an event Mellox deliberately ignores
    // still answers 200 with a reason rather than inviting a retry storm.
    return Response.json({ ok: true, handled: outcome.handled, reason: outcome.reason });
  } catch (error) {
    const { knownErrorResponse } = await import("@/server/route");
    const known = knownErrorResponse(error);
    if (known) return known;
    console.error("[stripe] webhook failed", error);
    return Response.json({ ok: false, error: "Webhook failed" }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({ ok: true, hint: "POST with a stripe-signature header" });
}
