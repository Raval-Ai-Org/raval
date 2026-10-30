"use client";

// Shown when the owner's plan has no room for another brand: under the
// website bar as soon as a new site is typed, and again if the server says
// no. Never an error: it names the plan, what is using the place, and offers
// "Upgrade now". Deleting a brand frees its place, so that is offered too.

import { Crown } from "@/components/icons";
import { emitAppEvent } from "@/lib/app-events";
import type { PlanId } from "@/lib/billing/catalog";
import { asPlan } from "@/lib/billing/present";
import { useEntitlements } from "@/lib/billing/use-entitlements";
import { brandLimitCopy, brandRoom } from "@/lib/workspace/brand-room";
import { cn } from "@/lib/utils";
import { GhostButton, PrimaryButton } from "./billing-ui";

export function BrandLimitCard({
  usedBy,
  wanted,
  onManage,
  className,
}: {
  /** Names or domains of the owner's brands. */
  usedBy: string[];
  /** The website the person tried to add. */
  wanted?: string | null;
  /** Shows the brand list, where a brand can be deleted. */
  onManage?: () => void;
  className?: string;
}) {
  const { data } = useEntitlements();
  const room = brandRoom(data);
  const max = room?.max ?? data?.limits.brands ?? 1;
  const used = room?.used ?? max;
  return (
    <BrandLimitCardView
      plan={data ? asPlan(data.entitledPlan) : "free"}
      max={max}
      usedBy={usedBy}
      wanted={wanted}
      onUpgrade={() =>
        emitAppEvent("open:upgrade", { code: "limit_reached", limit: "brands", used, max })
      }
      onManage={onManage}
      className={className}
    />
  );
}

/** Presentational: `/upgrade-lab?scene=brands` renders it with sample data. */
export function BrandLimitCardView({
  plan,
  max,
  usedBy,
  wanted,
  onUpgrade,
  onManage,
  className,
}: {
  plan: PlanId;
  max: number;
  usedBy: string[];
  wanted?: string | null;
  onUpgrade: () => void;
  onManage?: () => void;
  className?: string;
}) {
  const copy = brandLimitCopy({ plan, max, usedBy, wanted });
  return (
    <div
      role="status"
      data-testid="brand-limit-card"
      className={cn(
        "rounded-[var(--ds-radius-tile)] border border-primary/30 bg-card/95 p-4 text-left shadow-[0_18px_44px_-28px_hsl(var(--foreground)/0.5)] backdrop-blur-xl",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
          <Crown className="h-4 w-4" strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-foreground">{copy.title}</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{copy.text}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 sm:pl-12">
        <PrimaryButton className="h-9" onClick={onUpgrade}>
          Upgrade now
        </PrimaryButton>
        {onManage && (
          <GhostButton className="h-9" onClick={onManage}>
            Manage brands
          </GhostButton>
        )}
      </div>
      {copy.hint && <p className="mt-2 text-[12px] text-muted-foreground sm:pl-12">{copy.hint}</p>}
    </div>
  );
}
