"use client";
// One order, as it actually stands.
//
// Every stage on the strip is reached because the backend said so. There is no
// timed animation standing in for progress, and nothing reads "Live" until
// Mellox has opened the published page and found the link itself.
import { ArrowLeft, ArrowUpRight, AlertCircle, RefreshCw, Spinner } from "@/components/icons";
import { ErrorState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/components/app/geo/geo-ui";
import {
  btnGhost,
  btnQuiet,
  Journey,
  journeyReached,
  ListSkeleton,
  Meta,
  Money,
  ORDER_LABELS,
  ORDER_MEANING,
  PLACEMENT_LABELS,
  Rise,
  Section,
  StatusPill,
  VERIFICATION_TEXT,
} from "./links-ui";
import { useOrder, useRecheck } from "./hooks";

const EVENT_LABELS: Record<string, string> = {
  cart_changed: "Sites selected",
  checkout: "Order confirmed",
  credits_held: "Balance reserved",
  credits_released: "Balance returned",
  queued: "Queued",
  lock_acquired: "Started with the publisher",
  lock_lost: "Handed to another worker",
  preflight_ok: "Checks passed",
  preflight_failed: "Checks failed",
  order_submitted: "Order sent to the publisher",
  order_confirmed: "Publisher accepted the order",
  order_unknown: "The publisher didn't answer in time",
  basket_reconciled: "Order checked against the publisher",
  basket_foreign_item: "Held for review",
  pay_submitted: "Payment sent",
  pay_confirmed: "Payment accepted",
  pay_unknown: "Payment answer didn't arrive",
  pay_failed: "Payment declined",
  credits_captured: "Paid",
  credits_refunded: "Refunded",
  link_attributed: "Article published",
  verification: "Link checked",
  link_lost: "Link no longer visible",
  gave_up: "Placement never appeared",
  operator_action: "Reviewed by our team",
  cancelled: "Cancelled",
  failed: "Order failed",
};

const HIGHLIGHT = new Set(["link_attributed", "verification", "pay_confirmed", "checkout"]);

export function OrderDetail({
  workspaceId,
  orderId,
  onBack,
}: {
  workspaceId: string;
  orderId: string;
  onBack: () => void;
}) {
  const recheck = useRecheck(workspaceId);
  const { data, isLoading, isError, error, refetch } = useOrder(workspaceId, orderId, true);

  const order = data?.order ?? null;
  const placements = data?.placements ?? [];

  if (isError) {
    return (
      <ErrorState
        detail={error instanceof Error ? error.message : null}
        onRetry={() => void refetch()}
      />
    );
  }
  if (isLoading || !order) return <ListSkeleton rows={3} />;

  const failed = ["failed", "cancelled"].includes(order.status);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 pb-8">
      <button type="button" onClick={onBack} className={btnQuiet}>
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        All orders
      </button>

      <Rise>
        <div className="rounded-[20px] border border-border/50 bg-surface-3 dark:border-white/[0.06] dark:bg-white/[0.035] p-6 shadow-1 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
                  {order.lineCount} placement{order.lineCount === 1 ? "" : "s"}
                </h1>
                <StatusPill
                  status={order.status}
                  label={ORDER_LABELS[order.status] ?? order.status}
                />
              </div>
              <p className="mt-1.5 max-w-prose text-[14px] leading-relaxed text-muted-foreground">
                {ORDER_MEANING[order.status] ?? ""}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <Money
                usd={order.usd}
                cents
                className="text-[22px] font-semibold tracking-tight text-foreground"
              />
              <p className="text-[12px] text-muted-foreground">
                {order.paidAt ? "paid" : "reserved"}
              </p>
            </div>
          </div>

          <div className="mt-7">
            <Journey reached={journeyReached(order.status, placements)} failed={failed} />
          </div>

          {order.needsOperator && (
            <div className="mt-6 flex items-start gap-3 rounded-xl border border-warning-border bg-warning-surface p-4">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              <p className="text-[13.5px] leading-relaxed text-foreground">
                We hit a snag with the publisher on this order. Your balance is reserved and nothing
                further will be spent until we&rsquo;ve sorted it out.
              </p>
            </div>
          )}

          <dl className="mt-6 grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-[12px] uppercase tracking-wide text-muted-foreground">
                Links point to
              </dt>
              <dd className="mt-1 truncate text-[14px] text-foreground">
                {order.targetUrl.replace(/^https?:\/\//, "")}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[12px] uppercase tracking-wide text-muted-foreground">
                Link text
              </dt>
              <dd className="mt-1 truncate text-[14px] text-foreground">{order.keyword}</dd>
            </div>
          </dl>
        </div>
      </Rise>

      <Section title="Placements">
        <ul className="space-y-3">
          {placements.map((placement, index) => (
            <Rise key={placement.id} index={index}>
              <li className="rounded-[20px] border border-border/50 bg-surface-3 dark:border-white/[0.06] dark:bg-white/[0.035] p-5 shadow-1">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[15px] font-medium text-foreground">
                        {placement.domain}
                      </span>
                      <StatusPill
                        status={placement.status}
                        label={PLACEMENT_LABELS[placement.status] ?? placement.status}
                        kind="placement"
                      />
                    </div>

                    {placement.publishedUrl && (
                      <a
                        href={placement.publishedUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="mt-2 inline-flex max-w-full items-center gap-1 truncate text-[13.5px] text-primary underline-offset-4 hover:underline"
                      >
                        <span className="truncate">
                          {placement.publishedUrl.replace(/^https?:\/\//, "")}
                        </span>
                        <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      </a>
                    )}

                    <div className="mt-2 space-y-1">
                      {placement.verification !== "pending" && (
                        <Meta className="block">
                          {VERIFICATION_TEXT[placement.verification] ?? placement.verification}
                          {placement.verifiedAt &&
                            ` · checked ${relativeTime(placement.verifiedAt)}`}
                        </Meta>
                      )}

                      {placement.status === "awaiting_publication" && (
                        <Meta className="block">
                          Waiting for the publisher. We check every few minutes.
                        </Meta>
                      )}

                      {/* Attribution uncertainty is shown, never smoothed over. */}
                      {placement.attribution === "ambiguous" && (
                        <span className="block text-[12.5px] text-warning">
                          This matched more than one order. It may belong to a sibling order of
                          yours.
                        </span>
                      )}

                      {placement.refunded && (
                        <Meta className="block">
                          We couldn&rsquo;t confirm this one went live, so it was refunded.
                        </Meta>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <Money
                      usd={placement.usd}
                      cents
                      className="text-[14px] text-muted-foreground"
                    />
                    {placement.publishedUrl && (
                      <button
                        type="button"
                        onClick={() => recheck.mutate(placement.id)}
                        disabled={recheck.isPending}
                        className={cn(btnGhost, "px-3 py-1.5")}
                        title="Check the page again"
                      >
                        {recheck.isPending ? (
                          <Spinner className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                        )}
                        Check
                      </button>
                    )}
                  </div>
                </div>
              </li>
            </Rise>
          ))}
        </ul>
      </Section>

      <Section title="History" description="Recorded as it happened, not reconstructed.">
        <ol className="relative space-y-0 pl-5">
          <span className="absolute left-[3px] top-2 bottom-2 w-px bg-border" aria-hidden />
          {(data?.timeline ?? []).map((event) => (
            <li key={event.id} className="relative flex items-baseline gap-3 py-2">
              <span
                className={cn(
                  "absolute -left-5 top-3 h-[7px] w-[7px] rounded-full ring-2 ring-background",
                  HIGHLIGHT.has(event.type) ? "bg-primary" : "bg-border-strong",
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1 text-[13.5px] text-foreground">
                {EVENT_LABELS[event.type] ?? event.type}
              </span>
              <Meta className="shrink-0">{relativeTime(event.at)}</Meta>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
