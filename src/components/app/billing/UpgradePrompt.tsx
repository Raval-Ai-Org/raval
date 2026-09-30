"use client";

// A friendly inline card for when an action needs more credits or a bigger
// plan. Never an error: it says what happened in plain words and offers the
// one next step (the upgrade screen opens only when the person clicks).

import { Bolt, Crown, Lock, Users } from "@/components/icons";
import { emitAppEvent } from "@/lib/app-events";
import { FEATURES, PLANS } from "@/lib/billing/catalog";
import { asFeature, asPlan, type BillingBlock } from "@/lib/billing/present";
import { useEntitlements } from "@/lib/billing/use-entitlements";
import { cn } from "@/lib/utils";
import { GhostButton, PrimaryButton } from "./billing-ui";

export function upgradeCopy(block: BillingBlock): {
  title: string;
  text: string;
  action: string | null;
  Icon: typeof Lock;
} {
  const feature = asFeature(block.feature);
  const plan = PLANS[asPlan(block.requiredPlan)];
  switch (block.code) {
    case "insufficient_balance":
      return {
        title:
          block.meter === "video"
            ? "You're out of videos"
            : block.meter === "pro_messages"
              ? "You're out of Pro messages"
              : "You're out of credits",
        text: "Top up or upgrade to keep going.",
        action: "Get credits",
        Icon: Bolt,
      };
    case "upgrade_required":
      return {
        title: `Available on the ${plan.label} plan`,
        text: feature ? `Upgrade to use ${FEATURES[feature].label}.` : "Upgrade to use it.",
        action: "Upgrade",
        Icon: Lock,
      };
    case "limit_reached":
      return {
        title: "You've reached your plan limit",
        text: "Upgrade for more room.",
        action: "Upgrade",
        Icon: Crown,
      };
    case "brand_frozen":
      return {
        title: "This brand is paused on your plan",
        text: "Upgrade or choose which brands stay active.",
        action: "See options",
        Icon: Lock,
      };
    case "spend_not_allowed":
      return {
        title: "You have view-only access",
        text: "Ask the brand owner for editor access to do this.",
        action: null,
        Icon: Users,
      };
    default:
      return { title: "Upgrade to continue", text: "", action: "Upgrade", Icon: Crown };
  }
}

export function UpgradePrompt({
  block,
  onRetry,
  className,
}: {
  block: BillingBlock;
  onRetry?: () => void;
  className?: string;
}) {
  const { data } = useEntitlements();
  const copy = upgradeCopy(block);
  const owner = data?.isOwner ?? true;
  const Icon = copy.Icon;
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-[var(--ds-radius-tile)] border border-primary/25 bg-primary/[0.07] p-4 sm:flex-row sm:items-center",
        className,
      )}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
        <Icon className="h-4 w-4" strokeWidth={2.2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold">{copy.title}</p>
        <p className="text-[13px] text-muted-foreground">
          {owner || !copy.action ? copy.text : "Ask the account owner to upgrade."}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        {onRetry && (
          <GhostButton className="h-9" onClick={onRetry}>
            Try again
          </GhostButton>
        )}
        {copy.action && (
          <PrimaryButton className="h-9" onClick={() => emitAppEvent("open:upgrade", block)}>
            {owner ? copy.action : "Ask the owner"}
          </PrimaryButton>
        )}
      </div>
    </div>
  );
}
