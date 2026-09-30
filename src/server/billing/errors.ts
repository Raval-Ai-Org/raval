import type { FeatureKey, Meter, PlanId } from "@/lib/billing/catalog";
import { BILLING_MESSAGES } from "@/lib/billing/present";

export type BillingErrorCode =
  | "upgrade_required"
  | "insufficient_balance"
  | "limit_reached"
  | "spend_not_allowed"
  | "brand_frozen";

export class BillingError extends Error {
  readonly status = 402;

  constructor(
    readonly code: BillingErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "BillingError";
  }

  toJSON() {
    return { code: this.code, message: this.message, ...this.details };
  }
}

export class UpgradeRequiredError extends BillingError {
  constructor(args: {
    feature?: FeatureKey;
    limit?: string;
    requiredPlan: PlanId;
    currentPlan: PlanId;
  }) {
    super("upgrade_required", BILLING_MESSAGES.upgrade_required, args);
  }
}

export class InsufficientBalanceError extends BillingError {
  constructor(args: { meter: Meter; needed: number; available: number; options: string[] }) {
    super("insufficient_balance", BILLING_MESSAGES.insufficient_balance, args);
  }
}

export class LimitReachedError extends BillingError {
  constructor(args: { limit: string; used: number; max: number; requiredPlan?: PlanId }) {
    super("limit_reached", BILLING_MESSAGES.limit_reached, args);
  }
}

export class SpendNotAllowedError extends BillingError {
  constructor() {
    super("spend_not_allowed", BILLING_MESSAGES.spend_not_allowed);
  }
}

export class BrandFrozenError extends BillingError {
  constructor() {
    super("brand_frozen", BILLING_MESSAGES.brand_frozen);
  }
}
