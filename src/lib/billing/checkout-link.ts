// The one checkout page (/checkout): Plan → Payment → Launch, full screen and
// outside the app canvas, so it is never clipped by the app frame. Every
// Upgrade / Plans / Buy press builds its link here; the page reads it back with
// `readCheckoutLink`. Pure and browser-safe.

import {
  CREDIT_PACKS,
  PUBLIC_PLANS,
  type BillingInterval,
  type PaidPlanId,
} from "@/lib/billing/catalog";
import type { BillingBlock } from "@/lib/billing/present";
import { normalizePromoCode } from "@/lib/billing/promo";

export type CheckoutStep = "plan" | "pay" | "launch";
export type CheckoutItem =
  | { kind: "plan"; key: PaidPlanId; interval: BillingInterval }
  | { kind: "credit_pack"; key: string };

export type CheckoutLink = {
  step: CheckoutStep;
  /** Plans or credit packs on the first step. */
  view: "plans" | "credits";
  item: CheckoutItem | null;
  interval: BillingInterval;
  /** The plan to highlight on the first step. */
  recommended: PaidPlanId | null;
  /** Why the person came (a lock, a limit, an empty balance). */
  block: BillingBlock | null;
  /** Relative path to go back to. */
  from: string;
  /** The workspace the person came from, for "Ask the owner". */
  workspaceId: string | null;
  /** No plan yet: there is no way back into the app without one. */
  required: boolean;
  sessionId: string | null;
  /** A trial code the person entered (checked by the server before use). */
  promo: string | null;
};

const PAID_KEYS: readonly string[] = [...PUBLIC_PLANS, "scale"];
const SAFE_PATH = /^\/(?!\/)[A-Za-z0-9\-._~/]*$/;
const UUIDISH = /^[A-Za-z0-9-]{8,64}$/;
const SESSION = /^cs_(?:test_|live_)?[A-Za-z0-9_]+$/;

/** Only a same-site relative path, never `//host` or a full URL. */
export function safeReturnPath(raw: string | null | undefined, fallback = "/projects"): string {
  const value = (raw ?? "").trim();
  if (!value || value.length > 300 || !SAFE_PATH.test(value)) return fallback;
  if (value.startsWith("/checkout")) return fallback;
  return value;
}

function asInterval(raw: string | null): BillingInterval | null {
  return raw === "month" || raw === "year" ? raw : null;
}

function asPaid(raw: string | null): PaidPlanId | null {
  return raw && PAID_KEYS.includes(raw) ? (raw as PaidPlanId) : null;
}

function num(raw: string | null): number | undefined {
  if (raw === null || raw === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export function checkoutHref(args: {
  step?: CheckoutStep;
  view?: "plans" | "credits";
  item?: CheckoutItem | null;
  interval?: BillingInterval;
  recommended?: PaidPlanId | null;
  block?: BillingBlock | null;
  from?: string;
  workspaceId?: string | null;
  required?: boolean;
  promo?: string | null;
}): string {
  const q = new URLSearchParams();
  const item = args.item ?? null;
  q.set("step", args.step ?? (item ? "pay" : "plan"));
  if (args.view === "credits") q.set("view", "credits");
  if (item) {
    q.set("kind", item.kind);
    q.set("key", item.key);
    if (item.kind === "plan") q.set("interval", item.interval);
  } else if (args.interval) q.set("interval", args.interval);
  if (args.recommended) q.set("rec", args.recommended);
  const block = args.block;
  if (block?.code) {
    q.set("code", block.code);
    for (const field of ["feature", "requiredPlan", "meter", "limit"] as const)
      if (block[field]) q.set(field, String(block[field]));
    for (const field of ["needed", "available", "used", "max"] as const)
      if (typeof block[field] === "number") q.set(field, String(block[field]));
  }
  q.set("from", safeReturnPath(args.from));
  if (args.workspaceId) q.set("ws", args.workspaceId);
  if (args.required) q.set("required", "1");
  const promo = normalizePromoCode(args.promo);
  if (promo) q.set("promo", promo);
  return `/checkout?${q.toString()}`;
}

export function readCheckoutLink(params: URLSearchParams): CheckoutLink {
  const kind = params.get("kind");
  const key = params.get("key");
  const interval = asInterval(params.get("interval")) ?? "year";
  let item: CheckoutItem | null = null;
  if (kind === "plan" && asPaid(key)) item = { kind: "plan", key: asPaid(key)!, interval };
  else if (kind === "credit_pack" && key && CREDIT_PACKS.some((pack) => pack.key === key))
    item = { kind: "credit_pack", key };

  const sessionRaw = params.get("checkout_session_id");
  const sessionId = sessionRaw && SESSION.test(sessionRaw) ? sessionRaw : null;
  const stepRaw = params.get("step");
  let step: CheckoutStep =
    stepRaw === "launch" && sessionId ? "launch" : stepRaw === "pay" && item ? "pay" : "plan";
  if (stepRaw === "launch" && !sessionId) step = item ? "pay" : "plan";

  const code = params.get("code");
  const block: BillingBlock | null = code
    ? {
        code,
        feature: params.get("feature") ?? undefined,
        requiredPlan: params.get("requiredPlan") ?? undefined,
        meter: params.get("meter") ?? undefined,
        limit: params.get("limit") ?? undefined,
        needed: num(params.get("needed")),
        available: num(params.get("available")),
        used: num(params.get("used")),
        max: num(params.get("max")),
      }
    : null;

  const ws = params.get("ws");
  return {
    step,
    view: params.get("view") === "credits" || item?.kind === "credit_pack" ? "credits" : "plans",
    item,
    interval,
    recommended: asPaid(params.get("rec")),
    block,
    from: safeReturnPath(params.get("from")),
    workspaceId: ws && UUIDISH.test(ws) ? ws : null,
    required: params.get("required") === "1",
    sessionId,
    promo: normalizePromoCode(params.get("promo")),
  };
}
