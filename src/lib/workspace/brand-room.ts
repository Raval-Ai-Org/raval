// brand-room.ts — how many brands the owner's plan has room for, and what to
// say when it is full. Pure and browser-safe.
//
// The count matches the database check in create_billed_workspace_for_user:
// the owner's own brands that are not paused. Deleting a brand gives its
// place back at once, so a person on a one-brand plan can remove theirs and
// add another (or the same one again).

import { PLANS, type PlanId } from "@/lib/billing/catalog";

export type BrandRoom = {
  /** Brands that count against the plan (owned, not paused). */
  used: number;
  max: number;
  /** Places left; 0 when full. */
  left: number;
  full: boolean;
};

type EntitlementsLike = {
  enforcement: "off" | "shadow" | "on";
  limits: { brands: number };
  usage: { brands: number; activeBrands?: number };
};

/** null when plan limits aren't enforced, so nothing is ever blocked early. */
export function brandRoom(e: EntitlementsLike | null | undefined): BrandRoom | null {
  if (!e || e.enforcement !== "on") return null;
  const used = Math.max(0, e.usage.activeBrands ?? e.usage.brands);
  const max = Math.max(0, e.limits.brands);
  const left = Math.max(0, max - used);
  return { used, max, left, full: left === 0 };
}

/**
 * A brand that is deleted and added again gets its free Brand DNA scan back,
 * a few times a month: enough to start over, not a way to rescan for free.
 */
export const FREE_SCAN_RESTORES_PER_30_DAYS = 3;

export function mayRestoreFreeScan(deletionsInLast30Days: number): boolean {
  return deletionsInLast30Days < FREE_SCAN_RESTORES_PER_30_DAYS;
}

export type BrandLimitCopy = { title: string; text: string; hint: string | null };

/** What the "plan is full" card says, in plain words. */
export function brandLimitCopy(args: {
  plan: PlanId;
  max: number;
  /** Names or domains of the brands using the places, newest first. */
  usedBy: string[];
  /** The website the person tried to add, if any. */
  wanted?: string | null;
}): BrandLimitCopy {
  const label = PLANS[args.plan]?.label ?? "Your";
  const places = args.max === 1 ? "1 brand" : `${args.max} brands`;
  const title = `Your ${label} plan includes ${places}`;
  const shown = args.usedBy.slice(0, 2);
  const more = args.usedBy.length - shown.length;
  const using =
    shown.length === 0
      ? ""
      : args.max === 1 && shown.length === 1
        ? `It's in use for ${shown[0]}. `
        : `In use: ${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}. `;
  const text = args.wanted
    ? `${using}Upgrade to add ${args.wanted} as another brand.`
    : `${using}Upgrade to add another brand.`;
  return {
    title,
    text,
    hint: "Or delete a brand to free its place — the new one gets a full scan.",
  };
}
