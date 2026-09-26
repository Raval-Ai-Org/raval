import { CREDIT_ACTIONS, type CreditAction } from "@/lib/billing/catalog";

export function CostChip({ action, quantity = 1 }: { action: CreditAction; quantity?: number }) {
  const credits = Math.ceil(CREDIT_ACTIONS[action].credits * quantity);
  return (
    <span
      className="inline-flex rounded-full border border-border bg-background/70 px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground"
      title="Charged only when this action succeeds"
    >
      {credits.toLocaleString()} credits
    </span>
  );
}
