"use client";
// Backlink Growth.
//
// The opening screen answers, in order: what this is, where you stand, and what
// to do next. One primary action, everything else behind a tab, so someone who
// has never bought a link is not handed a control panel.
import { useMemo, useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { ArrowUpRight, ChevronRight, Link2, Plus, Sparkles } from "@/components/icons";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/components/app/geo/geo-ui";
import {
  btnGhost,
  btnPrimary,
  CountUp,
  Meta,
  Money,
  ORDER_LABELS,
  ORDER_MEANING,
  OverviewSkeleton,
  PLACEMENT_LABELS,
  Rise,
  Section,
  StatusPill,
  VERIFICATION_TEXT,
} from "./links-ui";
import { CampaignFlow } from "./CampaignFlow";
import { CreditsPanel } from "./CreditsPanel";
import { OrderDetail } from "./OrderDetail";
import { useDiscardDraft, useOverviewPolling } from "./hooks";

type Tab = "overview" | "orders" | "links" | "balance";

const MOVING = [
  "queued",
  "awaiting_lock",
  "preflight",
  "ordering",
  "ordered",
  "paying",
  "paid",
  "publishing",
  "blocked_balance",
];

export function LinksPanel({ workspaceId }: { workspaceId: string | null }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [flow, setFlow] = useState(false);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useOverviewPolling(workspaceId);
  const discard = useDiscardDraft(workspaceId);

  const orders = useMemo(() => data?.orders ?? [], [data]);
  const placements = useMemo(() => data?.placements ?? [], [data]);
  const active = useMemo(() => orders.filter((o) => MOVING.includes(o.status)), [orders]);
  const published = useMemo(
    () => placements.filter((p) => ["published", "live", "lost"].includes(p.status)),
    [placements],
  );

  if (!workspaceId) {
    return (
      <EmptyState
        icon={Link2}
        title="Select a workspace"
        description="Backlink Growth belongs to one brand at a time."
      />
    );
  }

  if (isError) {
    return (
      <ErrorState
        detail={error instanceof Error ? error.message : null}
        onRetry={() => void refetch()}
      />
    );
  }

  if (isLoading || !data) return <OverviewSkeleton />;

  if (openOrderId) {
    return (
      <OrderDetail
        workspaceId={workspaceId}
        orderId={openOrderId}
        onBack={() => setOpenOrderId(null)}
      />
    );
  }

  if (flow) {
    return (
      <CampaignFlow
        workspaceId={workspaceId}
        siteHost={data.siteHost}
        balanceUsd={data.balance.availableUsd}
        onDone={(orderId) => {
          setFlow(false);
          setOpenOrderId(orderId);
        }}
        onCancel={() => setFlow(false)}
        onTopUp={() => {
          setFlow(false);
          setTab("balance");
        }}
      />
    );
  }

  // ── First run ─────────────────────────────────────────────────────────────
  if (orders.length === 0 && placements.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col items-center py-12 text-center sm:py-20">
        <Rise>
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-surface">
            <Link2 className="h-6 w-6 text-primary" aria-hidden />
          </span>
        </Rise>

        <Rise index={1}>
          <h1 className="mt-6 text-[30px] font-semibold leading-tight tracking-tight text-foreground">
            Get other sites linking to you
          </h1>
          <p className="mt-3 text-[15.5px] leading-relaxed text-muted-foreground">
            A backlink is another website pointing at yours. Search engines treat them as votes, so
            a handful of good ones makes your pages much easier to find.
          </p>
          <p className="mt-3 text-[15.5px] leading-relaxed text-muted-foreground">
            Mellox finds sites worth appearing on, writes the article, buys the placement, then
            opens the published page to confirm your link is really there.
          </p>
        </Rise>

        <Rise index={2}>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setFlow(true)}
              disabled={!data.canEdit}
              className={btnPrimary}
            >
              <Sparkles className="h-4 w-4" aria-hidden />
              Find sites
            </button>
            <button type="button" onClick={() => setTab("balance")} className={btnGhost}>
              <Money usd={data.balance.availableUsd} cents /> balance
            </button>
          </div>

          <Meta className="mt-5 block">
            {data.catalogSize.toLocaleString()} sites available
            {!data.canEdit && " · buying needs editor access"}
          </Meta>
        </Rise>
      </div>
    );
  }

  // ── Returning ─────────────────────────────────────────────────────────────
  return (
    <Tabs value={tab} onValueChange={(next) => setTab(next as Tab)} className="w-full">
      <div className="sticky -top-4 z-20 -mx-1 overflow-x-auto bg-background/90 px-1 pb-3 pt-2 backdrop-blur-md [scrollbar-width:none] sm:-top-5 [&::-webkit-scrollbar]:hidden">
        <TabsList className="h-10 rounded-full">
          <TabsTrigger value="overview" className="rounded-full px-4">
            Overview
          </TabsTrigger>
          <TabsTrigger value="orders" className="rounded-full px-4">
            Orders{active.length > 0 ? ` · ${active.length}` : ""}
          </TabsTrigger>
          <TabsTrigger value="links" className="rounded-full px-4">
            Links{published.length > 0 ? ` · ${published.length}` : ""}
          </TabsTrigger>
          <TabsTrigger value="balance" className="rounded-full px-4">
            Balance
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="overview" className="mt-2 focus-visible:outline-none">
        <div className="mx-auto w-full max-w-3xl space-y-8 pb-8">
          <Rise>
            <div className="rounded-2xl border border-border bg-card p-6 shadow-1 sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div>
                  <p className="text-[13px] uppercase tracking-wide text-muted-foreground">
                    Live backlinks
                  </p>
                  <div className="mt-1 flex items-baseline gap-3">
                    <CountUp
                      value={data.stats.live}
                      className="text-[44px] font-semibold leading-none tracking-tight text-foreground"
                    />
                    {data.stats.live > 0 && (
                      <span className="text-[13px] font-medium text-success">verified</span>
                    )}
                  </div>
                  <p className="mt-2 max-w-sm text-[13.5px] leading-relaxed text-muted-foreground">
                    {data.stats.live === 0
                      ? "Nothing verified yet. A placement only counts once we've seen your link on the page."
                      : "Each one was confirmed by Mellox opening the published page."}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setTab("balance")}
                  className="rounded-xl border border-border px-4 py-3 text-left transition-colors hover:bg-secondary"
                >
                  <Meta>Balance</Meta>
                  <Money
                    usd={data.balance.availableUsd}
                    cents
                    className="mt-0.5 block text-[20px] font-semibold tracking-tight text-foreground"
                  />
                  {data.balance.heldUsd > 0 && (
                    <Meta className="mt-0.5 block">
                      <Money usd={data.balance.heldUsd} cents /> reserved
                    </Meta>
                  )}
                </button>
              </div>

              {(data.stats.pending > 0 || data.stats.unconfirmed > 0) && (
                <div className="mt-6 flex flex-wrap gap-x-8 gap-y-2 border-t border-border pt-4">
                  {data.stats.pending > 0 && (
                    <div>
                      <Meta>In progress</Meta>
                      <p className="text-[15px] tabular-nums text-foreground">
                        {data.stats.pending}
                      </p>
                    </div>
                  )}
                  {data.stats.unconfirmed > 0 && (
                    <div>
                      <Meta>Never appeared · refunded</Meta>
                      <p className="text-[15px] tabular-nums text-foreground">
                        {data.stats.unconfirmed}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Rise>

          <Rise index={1}>
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card p-6 shadow-1">
              <div className="min-w-0">
                <h2 className="text-[16px] font-semibold tracking-tight text-foreground">
                  Buy more placements
                </h2>
                <p className="mt-1 max-w-md text-[13.5px] leading-relaxed text-muted-foreground">
                  Pick a page, choose the sites, approve the article.{" "}
                  {data.catalogSize.toLocaleString()} sites available.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFlow(true)}
                disabled={!data.canEdit}
                className={btnPrimary}
              >
                <Plus className="h-4 w-4" aria-hidden />
                New order
              </button>
            </div>
          </Rise>

          {data.cartOrderId && (
            <Rise index={2}>
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-primary/40 bg-primary-surface/40 p-5">
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-foreground">Unfinished selection</p>
                  <Meta className="block">
                    You picked some sites but didn&rsquo;t confirm. Nothing was charged.
                  </Meta>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => discard.mutate(data.cartOrderId as string)}
                    className={btnGhost}
                  >
                    Clear
                  </button>
                  <button type="button" onClick={() => setFlow(true)} className={btnPrimary}>
                    Continue
                  </button>
                </div>
              </div>
            </Rise>
          )}

          {active.length > 0 && (
            <Section title="Happening now">
              <ul className="space-y-3">
                {active.slice(0, 3).map((order, index) => (
                  <Rise key={order.id} index={index}>
                    <OrderRow order={order} onOpen={() => setOpenOrderId(order.id)} />
                  </Rise>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </TabsContent>

      <TabsContent value="orders" className="mt-2 focus-visible:outline-none">
        <div className="mx-auto w-full max-w-3xl pb-8">
          <Section title="Orders">
            {orders.length === 0 ? (
              <EmptyState
                size="sm"
                icon={Link2}
                title="No orders yet"
                description="Your first order will show its progress here."
              />
            ) : (
              <ul className="space-y-3">
                {orders.map((order, index) => (
                  <Rise key={order.id} index={index}>
                    <OrderRow order={order} onOpen={() => setOpenOrderId(order.id)} />
                  </Rise>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </TabsContent>

      <TabsContent value="links" className="mt-2 focus-visible:outline-none">
        <div className="mx-auto w-full max-w-3xl pb-8">
          <Section
            title="Your links"
            description="Every placement bought, and what we last saw on the page."
          >
            {published.length === 0 ? (
              <EmptyState
                size="sm"
                icon={Link2}
                title="No published links yet"
                description="Placements appear here once the publisher puts the article live."
              />
            ) : (
              <ul className="space-y-3">
                {published.map((placement, index) => (
                  <Rise key={placement.id} index={index}>
                    <li className="rounded-2xl border border-border bg-card p-5 shadow-1">
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
                          <Meta className="mt-1.5 block">
                            {VERIFICATION_TEXT[placement.verification] ?? placement.verification}
                            {placement.firstLiveAt &&
                              ` · first seen ${relativeTime(placement.firstLiveAt)}`}
                          </Meta>
                        </div>
                        <button
                          type="button"
                          onClick={() => setOpenOrderId(placement.orderId)}
                          className={cn(btnGhost, "shrink-0")}
                        >
                          Order
                          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </div>
                    </li>
                  </Rise>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </TabsContent>

      <TabsContent value="balance" className="mt-2 focus-visible:outline-none">
        <CreditsPanel
          workspaceId={workspaceId}
          availableUsd={data.balance.availableUsd}
          heldUsd={data.balance.heldUsd}
          spentUsd={data.balance.spentUsd}
          packs={data.packs}
          canBuy={data.canEdit && data.billingEnabled}
          canEdit={data.canEdit}
        />
      </TabsContent>
    </Tabs>
  );
}

function OrderRow({
  order,
  onOpen,
}: {
  order: {
    id: string;
    status: string;
    lineCount: number;
    usd: number;
    keyword: string;
    targetUrl: string;
    createdAt: string;
  };
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full items-start justify-between gap-4 rounded-2xl border border-border bg-card p-5 text-left shadow-1 transition-all hover:border-border-strong hover:shadow-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-medium text-foreground">
              {order.lineCount} placement{order.lineCount === 1 ? "" : "s"}
            </span>
            <StatusPill status={order.status} label={ORDER_LABELS[order.status] ?? order.status} />
          </div>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
            {ORDER_MEANING[order.status] ?? ""}
          </p>
          <Meta className="mt-1.5 block truncate">
            {order.keyword} → {order.targetUrl.replace(/^https?:\/\//, "")}
          </Meta>
        </div>
        <div className="shrink-0 text-right">
          <Money usd={order.usd} cents className="text-[15px] text-foreground" />
          <Meta className="block">{relativeTime(order.createdAt)}</Meta>
          <ChevronRight
            className="ml-auto mt-1 h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </div>
      </button>
    </li>
  );
}
