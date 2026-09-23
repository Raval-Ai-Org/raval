"use client";
// Backlink Growth.
//
// One rail, four pages: Overview (where you stand, what's moving), Orders,
// Links (every placement and whether we saw it live) and Balance. The rail
// always shows the balance and the one primary action, so someone who has
// never bought a link sees what to do without reading a paragraph.
import { useMemo, useState } from "react";

import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import {
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  Clock,
  LayoutDashboard,
  Link2,
  List,
  PenLine,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/components/app/geo/geo-ui";
import {
  GroupLabel,
  Stat,
  SurfaceLayout,
  SurfacePage,
  Tile,
  type SurfaceNavItem,
} from "@/components/app/surface/SurfaceLayout";
import { SiteIcon } from "@/components/app/surface/SiteIcon";
import {
  btnGhost,
  btnPrimary,
  JOURNEY,
  journeyReached,
  Meta,
  Money,
  ORDER_LABELS,
  ORDER_MEANING,
  OverviewSkeleton,
  PLACEMENT_LABELS,
  Rise,
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

const STEPS = [
  { icon: Search, label: "Pick sites" },
  { icon: PenLine, label: "We write and buy" },
  { icon: ShieldCheck, label: "We check it's live" },
];

/** Short enough for a card; the full sentence (VERIFICATION_TEXT) is the tooltip. */
const VERIFICATION_SHORT: Record<string, string> = {
  pending: "Not checked yet",
  live: "Link found",
  nofollow: "Found · passes no credit",
  missing: "Link not found",
  unreachable: "Couldn't open the page",
  blocked: "Can't be checked",
};

type OrderLike = {
  id: string;
  status: string;
  lineCount: number;
  usd: number;
  keyword: string;
  targetUrl: string;
  createdAt: string;
};

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

  if (isLoading || !data) {
    return (
      <div className="p-6">
        <OverviewSkeleton />
      </div>
    );
  }

  const go = (next: Tab) => {
    setFlow(false);
    setOpenOrderId(null);
    setTab(next);
  };

  const nav: SurfaceNavItem<Tab>[] = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "orders", label: "Orders", icon: List, count: active.length, highlight: true },
    { id: "links", label: "Links", icon: Link2, count: published.length },
    { id: "balance", label: "Balance", icon: Wallet },
  ];

  const railTop = (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => go("balance")}
        className="w-full rounded-[18px] bg-foreground/[0.04] p-3.5 text-left transition-colors hover:bg-foreground/[0.07]"
      >
        <span className="block text-[12px] font-medium text-muted-foreground">Balance</span>
        <Money
          usd={data.balance.availableUsd}
          cents
          className="mt-0.5 block text-[22px] font-semibold tracking-tight text-foreground"
        />
        {data.balance.heldUsd > 0 && (
          <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
            <Money usd={data.balance.heldUsd} cents /> reserved
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpenOrderId(null);
          setFlow(true);
        }}
        disabled={!data.canEdit}
        className={cn(btnPrimary, "h-10 w-full py-0 text-[13.5px]")}
      >
        <Plus className="h-4 w-4" aria-hidden />
        New order
      </button>
    </div>
  );

  const placementsFor = (orderId: string) => placements.filter((p) => p.orderId === orderId);

  let page: React.ReactNode;
  if (openOrderId) {
    page = (
      <SurfacePage>
        <OrderDetail
          workspaceId={workspaceId}
          orderId={openOrderId}
          onBack={() => setOpenOrderId(null)}
        />
      </SurfacePage>
    );
  } else if (flow) {
    page = (
      <SurfacePage>
        <CampaignFlow
          workspaceId={workspaceId}
          siteHost={data.siteHost}
          balanceUsd={data.balance.availableUsd}
          onDone={(orderId) => {
            setFlow(false);
            setOpenOrderId(orderId);
          }}
          onCancel={() => setFlow(false)}
          onTopUp={() => go("balance")}
        />
      </SurfacePage>
    );
  } else if (tab === "overview") {
    const firstRun = orders.length === 0 && placements.length === 0;
    page = firstRun ? (
      <SurfacePage width="narrow">
        <div className="flex flex-col items-center py-8 text-center sm:py-14">
          <Rise>
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-[22px] bg-primary/12">
              <Link2 className="h-7 w-7 text-primary" aria-hidden />
            </span>
          </Rise>
          <Rise index={1}>
            <h3 className="mt-6 text-[28px] font-semibold leading-tight tracking-tight text-foreground">
              Get other sites linking to you
            </h3>
            <p className="mt-2 text-[14.5px] text-muted-foreground">
              More good links, easier to find on Google and in AI answers.
            </p>
          </Rise>
          <Rise index={2} className="w-full">
            <ol className="mx-auto mt-8 grid max-w-lg grid-cols-3 gap-2">
              {STEPS.map(({ icon: Icon, label }, i) => (
                <li
                  key={label}
                  className="flex flex-col items-center gap-2 rounded-[20px] bg-foreground/[0.04] px-2 py-4"
                >
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-background text-primary ring-1 ring-border/60 dark:bg-white/[0.06]">
                    <Icon className="h-[18px] w-[18px]" strokeWidth={2.1} />
                  </span>
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    Step {i + 1}
                  </span>
                  <span className="text-[13px] font-medium leading-tight text-foreground">
                    {label}
                  </span>
                </li>
              ))}
            </ol>
          </Rise>
          <Rise index={3}>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setFlow(true)}
                disabled={!data.canEdit}
                className={cn(btnPrimary, "h-11 px-6")}
              >
                <Sparkles className="h-4 w-4" aria-hidden />
                Find sites
              </button>
            </div>
            <Meta className="mt-4 block">
              {data.catalogSize.toLocaleString()} sites to choose from
              {!data.canEdit && " · buying needs editor access"}
            </Meta>
          </Rise>
        </div>
      </SurfacePage>
    ) : (
      <SurfacePage title="Overview">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Live links"
            value={data.stats.live}
            icon={ShieldCheck}
            tone={data.stats.live > 0 ? "success" : "default"}
            hint="Checked on the page"
            onClick={() => go("links")}
          />
          <Stat
            label="In progress"
            value={data.stats.pending}
            icon={Clock}
            tone={data.stats.pending > 0 ? "primary" : "default"}
            onClick={() => go("orders")}
          />
          <Stat
            label="Balance"
            value={<Money usd={data.balance.availableUsd} cents />}
            icon={Wallet}
            hint={
              data.balance.heldUsd > 0 ? (
                <>
                  <Money usd={data.balance.heldUsd} cents /> reserved
                </>
              ) : undefined
            }
            onClick={() => go("balance")}
          />
          <Stat
            label="Refunded"
            value={data.stats.unconfirmed}
            icon={RotateCcw}
            hint="Never appeared"
          />
        </div>

        {data.cartOrderId && (
          <Tile className="mt-4 flex flex-wrap items-center justify-between gap-3 border-primary/30 bg-primary/[0.06] dark:border-primary/25 dark:bg-primary/[0.06]">
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-foreground">Unfinished order</p>
              <Meta>Nothing was charged.</Meta>
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
          </Tile>
        )}

        {active.length > 0 && (
          <>
            <GroupLabel>Happening now</GroupLabel>
            <ul className="space-y-2">
              {active.slice(0, 3).map((order, index) => (
                <Rise key={order.id} index={index}>
                  <OrderRow
                    order={order}
                    placements={placementsFor(order.id)}
                    onOpen={() => setOpenOrderId(order.id)}
                  />
                </Rise>
              ))}
            </ul>
          </>
        )}

        {published.length > 0 && (
          <>
            <GroupLabel
              action={
                <button
                  type="button"
                  onClick={() => go("links")}
                  className="inline-flex items-center gap-1 text-[12.5px] font-medium text-primary hover:underline"
                >
                  All links <ArrowRight className="h-3.5 w-3.5" />
                </button>
              }
            >
              Latest links
            </GroupLabel>
            <div className="grid gap-2 sm:grid-cols-2">
              {published.slice(0, 4).map((placement) => (
                <LinkCard
                  key={placement.id}
                  placement={placement}
                  onOrder={() => setOpenOrderId(placement.orderId)}
                  compact
                />
              ))}
            </div>
          </>
        )}
      </SurfacePage>
    );
  } else if (tab === "orders") {
    page = (
      <SurfacePage title="Orders">
        {orders.length === 0 ? (
          <EmptyState
            size="sm"
            icon={Link2}
            title="No orders yet"
            description="Your first order shows its progress here."
          />
        ) : (
          <ul className="space-y-2">
            {orders.map((order, index) => (
              <Rise key={order.id} index={index}>
                <OrderRow
                  order={order}
                  placements={placementsFor(order.id)}
                  onOpen={() => setOpenOrderId(order.id)}
                />
              </Rise>
            ))}
          </ul>
        )}
      </SurfacePage>
    );
  } else if (tab === "links") {
    page = (
      <SurfacePage title="Links">
        {published.length === 0 ? (
          <EmptyState
            size="sm"
            icon={Link2}
            title="No published links yet"
            description="Links appear here once the article is live."
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {published.map((placement, index) => (
              <Rise key={placement.id} index={index}>
                <LinkCard placement={placement} onOrder={() => setOpenOrderId(placement.orderId)} />
              </Rise>
            ))}
          </div>
        )}
      </SurfacePage>
    );
  } else {
    page = (
      <SurfacePage title="Balance">
        <CreditsPanel
          workspaceId={workspaceId}
          availableUsd={data.balance.availableUsd}
          heldUsd={data.balance.heldUsd}
          spentUsd={data.balance.spentUsd}
          packs={data.packs}
          canBuy={data.canEdit && data.billingEnabled}
          canEdit={data.canEdit}
        />
      </SurfacePage>
    );
  }

  return (
    <SurfaceLayout
      label="Backlink Growth"
      items={nav}
      value={flow || openOrderId ? (openOrderId ? "orders" : null) : tab}
      onChange={go}
      railTop={railTop}
    >
      {/* Phones have no rail, so the primary action sits above the page. */}
      {!flow && !openOrderId && (
        <div className="px-4 pt-3 md:hidden">
          <button
            type="button"
            onClick={() => setFlow(true)}
            disabled={!data.canEdit}
            className={cn(btnPrimary, "h-10 w-full py-0")}
          >
            <Plus className="h-4 w-4" aria-hidden />
            New order
          </button>
        </div>
      )}
      <div key={`${tab}-${flow}-${openOrderId ?? ""}`} className="animate-in fade-in duration-300">
        {page}
      </div>
    </SurfaceLayout>
  );
}

function LinkCard({
  placement,
  onOrder,
  compact,
}: {
  placement: {
    id: string;
    orderId: string;
    domain: string;
    status: string;
    publishedUrl: string | null;
    verification: string;
    firstLiveAt: string | null;
  };
  onOrder: () => void;
  compact?: boolean;
}) {
  return (
    <Tile className={cn("flex min-w-0 flex-col gap-3", compact && "p-3.5 sm:p-4")}>
      <div className="flex min-w-0 items-center gap-3">
        <SiteIcon domain={placement.domain} size={compact ? 32 : 36} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium text-foreground">{placement.domain}</div>
          {placement.publishedUrl ? (
            <a
              href={placement.publishedUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="flex min-w-0 items-center gap-1 text-[12px] text-muted-foreground hover:text-primary"
            >
              <span className="truncate">
                {placement.publishedUrl.replace(/^https?:\/\/[^/]+/, "") || "/"}
              </span>
              <ArrowUpRight className="h-3 w-3 shrink-0" aria-hidden />
            </a>
          ) : (
            <Meta>Not published yet</Meta>
          )}
        </div>
        <StatusPill
          status={placement.status}
          label={PLACEMENT_LABELS[placement.status] ?? placement.status}
          kind="placement"
        />
      </div>
      {!compact && (
        <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-3">
          <span
            className="min-w-0 truncate text-[12.5px] text-muted-foreground"
            title={VERIFICATION_TEXT[placement.verification] ?? undefined}
          >
            {VERIFICATION_SHORT[placement.verification] ?? placement.verification}
            {placement.firstLiveAt && ` · ${relativeTime(placement.firstLiveAt)}`}
          </span>
          <button
            type="button"
            onClick={onOrder}
            className="inline-flex shrink-0 items-center gap-0.5 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
          >
            Order
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}
    </Tile>
  );
}

function OrderRow({
  order,
  placements,
  onOpen,
}: {
  order: OrderLike;
  placements: { status: string }[];
  onOpen: () => void;
}) {
  const reached = JOURNEY.findIndex(
    (stage) => stage.key === journeyReached(order.status, placements),
  );
  const failed = ["failed", "cancelled"].includes(order.status);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-[20px] border border-border/50 bg-surface-3 p-4 text-left transition-colors hover:border-primary/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:border-white/[0.06] dark:bg-white/[0.035] sm:p-5"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14.5px] font-medium text-foreground">
              {order.lineCount} link{order.lineCount === 1 ? "" : "s"}
            </span>
            <StatusPill status={order.status} label={ORDER_LABELS[order.status] ?? order.status} />
          </div>
          <p className="mt-1 truncate text-[12.5px] text-muted-foreground">
            {order.targetUrl.replace(/^https?:\/\//, "")} · {order.keyword}
          </p>
          {!failed && (
            <div
              className="mt-3 flex max-w-sm items-center gap-1"
              aria-label={`Step ${reached + 1} of ${JOURNEY.length}: ${JOURNEY[reached]?.label ?? ""}`}
              title={ORDER_MEANING[order.status] ?? undefined}
            >
              {JOURNEY.map((stage, i) => (
                <span
                  key={stage.key}
                  className={cn(
                    "h-1.5 flex-1 rounded-full",
                    i <= reached ? "bg-primary" : "bg-foreground/[0.08]",
                  )}
                />
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 text-right">
          <div>
            <Money usd={order.usd} cents className="block text-[14.5px] text-foreground" />
            <Meta className="block">{relativeTime(order.createdAt)}</Meta>
          </div>
          <ChevronRight
            className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </div>
      </button>
    </li>
  );
}
