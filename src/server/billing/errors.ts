import type { FeatureKey, Meter, PlanId } from "@/lib/billing/catalog";

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
    super("upgrade_required", "Upgrade your plan to use this feature.", args);
  }
}

export class InsufficientBalanceError extends BillingError {
  constructor(args: { meter: Meter; needed: number; available: number; options: string[] }) {
    super("insufficient_balance", "Your balance is too low for this action.", args);
  }
}

export class LimitReachedError extends BillingError {
  constructor(args: { limit: string; used: number; max: number; requiredPlan?: PlanId }) {
    super("limit_reached", "This plan limit has been reached.", args);
  }
}

export class SpendNotAllowedError extends BillingError {
  constructor() {
    super("spend_not_allowed", "This workspace role cannot spend the owner's balance.");
  }
}

export class BrandFrozenError extends BillingError {
  constructor() {
    super("brand_frozen", "This brand is paused. Choose an active brand or change your plan.");
  }
}
