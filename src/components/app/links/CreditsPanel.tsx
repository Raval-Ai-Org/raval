"use client";
// Balance: what you have, what's reserved, and how to add more.
//
// Everything here is dollars. Credits are the ledger unit underneath and never
// appear in the copy. When card payments aren't configured the packs are shown
// disabled with a plain explanation rather than leading someone into a checkout
// that cannot complete.
import { useState } from "react";
import { toast } from "sonner";

import { ArrowUpRight, Spinner } from "@/components/icons";
import { authedFetch } from "@/lib/authed-fetch";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/components/app/geo/geo-ui";
import { btnPrimary, ListSkeleton, Meta, Money, Rise, Section } from "./links-ui";
import { useCreditHistory } from "./hooks";

const LEDGER_LABELS: Record<string, string> = {
  topup: "Balance added",
  hold: "Reserved for an order",
  release: "Reservation returned",
  capture: "Spent on placements",
  refund: "Refunded",
  adjustment: "Adjustment",
};

export type Pack = { id: string; usd: number; valueUsd: number; bonusUsd: number };

export function CreditsPanel({
  workspaceId,
  availableUsd,
  heldUsd,
  spentUsd,
  packs,
  canBuy,
  canEdit,
}: {
  workspaceId: string;
  availableUsd: number;
  heldUsd: number;
  spentUsd: number;
  packs: Pack[];
  /** Card payments can actually complete: the user may buy AND Stripe is set up. */
  canBuy: boolean;
  canEdit: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const history = useCreditHistory(workspaceId, true);

  async function buy(packId: string) {
    setBusy(packId);
    try {
      const response = await authedFetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          packId,
          returnPath: `/w/${workspaceId}/app/backlinks`,
        }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        url?: string;
        reason?: string;
        error?: string;
      };
      if (!response.ok || !result.ok || !result.url) {
        toast.error("We couldn't open the payment page", {
          description: result.reason ?? result.error ?? "Try again in a moment.",
        });
        return;
      }
      // Stripe's own page handles the card. Mellox never sees it.
      window.location.href = result.url;
    } catch {
      toast.error("We couldn't open the payment page", {
        description: "Check your connection and try again.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 pb-8">
      <Rise>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-1 sm:p-7">
          <p className="text-[13px] uppercase tracking-wide text-muted-foreground">
            Available balance
          </p>
          <Money
            usd={availableUsd}
            cents
            className="mt-1 block text-[40px] font-semibold leading-none tracking-tight text-foreground"
          />
          <div className="mt-5 flex flex-wrap gap-x-8 gap-y-2 border-t border-border pt-4">
            <div>
              <Meta>Reserved for orders</Meta>
              <Money usd={heldUsd} cents className="block text-[15px] text-foreground" />
            </div>
            <div>
              <Meta>Spent so far</Meta>
              <Money usd={spentUsd} cents className="block text-[15px] text-foreground" />
            </div>
          </div>
        </div>
      </Rise>

      <Section
        title="Add balance"
        description={
          canBuy ? "Paid by card through Stripe. Mellox never sees your card details." : undefined
        }
      >
        {!canBuy && (
          <p className="rounded-2xl border border-border bg-secondary/50 p-4 text-[13.5px] leading-relaxed text-muted-foreground">
            {canEdit
              ? "Card payments aren’t switched on for this workspace yet, so balance has to be added for you. Everything else works as normal."
              : "Adding balance needs admin access. Ask an owner or admin of this workspace."}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          {packs.map((pack, index) => (
            <Rise key={pack.id} index={index}>
              <div
                className={cn(
                  "flex h-full flex-col rounded-2xl border border-border bg-card p-5 shadow-1 transition-shadow",
                  canBuy && "hover:shadow-2",
                )}
              >
                <Money
                  usd={pack.valueUsd}
                  className="text-[26px] font-semibold tracking-tight text-foreground"
                />
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">of balance</p>
                {pack.bonusUsd > 0 && (
                  <p className="mt-2 text-[12.5px] font-medium text-success">
                    <Money usd={pack.bonusUsd} /> free
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => void buy(pack.id)}
                  disabled={!canBuy || busy !== null}
                  className={cn(btnPrimary, "mt-4 w-full")}
                >
                  {busy === pack.id ? (
                    <Spinner className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <>
                      Pay <Money usd={pack.usd} />
                    </>
                  )}
                </button>
              </div>
            </Rise>
          ))}
        </div>
      </Section>

      <Section title="History">
        {history.isLoading ? (
          <ListSkeleton rows={3} />
        ) : (history.data ?? []).length === 0 ? (
          <p className="rounded-2xl border border-border bg-card p-5 text-[13.5px] text-muted-foreground">
            Nothing yet.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-border bg-card shadow-1">
            {(history.data ?? []).map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-4 border-b border-border px-5 py-3.5 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-[14px] text-foreground">
                    {LEDGER_LABELS[entry.kind] ?? entry.kind}
                  </p>
                  {entry.reason && <Meta className="block truncate">{entry.reason}</Meta>}
                </div>
                <div className="shrink-0 text-right">
                  <span
                    className={cn(
                      "inline-flex items-center gap-0.5 text-[14px] tabular-nums",
                      entry.deltaUsd > 0 ? "text-success" : "text-foreground",
                    )}
                  >
                    {entry.deltaUsd > 0 && <ArrowUpRight className="h-3 w-3" aria-hidden />}
                    <Money usd={Math.abs(entry.deltaUsd)} cents />
                  </span>
                  <Meta className="block">{relativeTime(entry.at)}</Meta>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
