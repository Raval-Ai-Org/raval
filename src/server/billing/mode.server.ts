import "server-only";

export type BillingMode = "off" | "shadow" | "on";

/** Production must not silently become free when a deployment omits the flag. */
export function globalBillingMode(
  env: Record<string, string | undefined> = process.env,
): BillingMode {
  const configured = env.BILLING_ENFORCEMENT;
  if (configured === "off" || configured === "shadow" || configured === "on") return configured;
  return env.NODE_ENV === "production" ? "on" : "off";
}
