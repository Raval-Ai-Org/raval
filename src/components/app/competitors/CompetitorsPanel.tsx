"use client";
// CompetitorsPanel.tsx — the Competitors surface.
//
// Three pages for the three questions: who they are (Competitors), what
// changed (Updates), and who else might matter (Discover). Everything is one
// entity underneath, so a competitor added by hand, found by search or carried
// over from Brand DNA lands in the same place.
import * as React from "react";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Bell, Compass, Plus, Search, Spinner, Users } from "@/components/icons";
import { ghostBtn, primaryBtn } from "@/components/app/geo/geo-ui";
import {
  SurfaceLayout,
  SurfacePage,
  type SurfaceNavItem,
} from "@/components/app/surface/SurfaceLayout";
import {
  useAddCompetitor,
  useCompetitorOverview,
  useDiscoverCompetitors,
  useMarkUpdatesRead,
  useRefreshCompetitor,
  useRemoveCompetitor,
  useSetCompetitorStatus,
} from "./hooks";
import { CompetitorCard } from "./CompetitorCard";
import { bootstrapCompetitors } from "@/lib/competitors.functions";
import { CompetitorDetail } from "./CompetitorDetail";
import { DiscoverTab } from "./DiscoverTab";
import { UpdatesFeed } from "./UpdatesFeed";

type TabId = "competitors" | "updates" | "discover";

export function CompetitorsPanel({ workspaceId }: { workspaceId: string | null }) {
  if (!workspaceId) {
    return (
      <EmptyState title="Select a workspace" description="Competitors are tracked per brand." />
    );
  }
  // Remount on switch, so no state from one brand ever survives into another.
  return <Panel key={workspaceId} workspaceId={workspaceId} />;
}

function Panel({ workspaceId }: { workspaceId: string }) {
  const [tab, setTab] = React.useState<TabId>("competitors");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = React.useState(false);
  const bootstrapStarted = React.useRef(false);

  const overview = useCompetitorOverview(workspaceId);
  const discover = useDiscoverCompetitors(workspaceId);
  const add = useAddCompetitor(workspaceId);
  const setStatus = useSetCompetitorStatus(workspaceId);
  const refresh = useRefreshCompetitor(workspaceId);
  const markRead = useMarkUpdatesRead(workspaceId);
  const remove = useRemoveCompetitor(workspaceId);

  const data = overview.data;
  const selected = data?.competitors.find((competitor) => competitor.id === openId) ?? null;

  // Existing workspaces may have completed a Brand DNA scan before this flow
  // existed. Give them the same researched starting set on their first visit.
  React.useEffect(() => {
    if (
      !data ||
      bootstrapStarted.current ||
      !data.researchAvailable ||
      data.competitors.length ||
      data.suggestions.length ||
      data.lastDiscoveryAt
    )
      return;
    const key = `competitors:bootstrap:${workspaceId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // Private browsing can block storage; the in-memory guard remains.
    }
    bootstrapStarted.current = true;
    setBootstrapping(true);
    void bootstrapCompetitors({ data: { workspaceId } })
      .then(() => overview.refetch())
      .catch(() => {
        try {
          sessionStorage.removeItem(key);
        } catch {
          // Storage unavailable.
        }
      })
      .finally(() => setBootstrapping(false));
    // The query's data is the trigger; bootstrapStarted prevents repeat calls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, workspaceId]);

  // Opening the feed is the user reading it; nothing stays "new" behind them.
  React.useEffect(() => {
    if (tab === "updates" && (data?.unreadUpdates ?? 0) > 0 && !markRead.isPending) {
      markRead.mutate(null);
    }
    // markRead is stable enough for this: re-running on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, data?.unreadUpdates]);

  if (overview.isLoading) {
    return (
      <div className="flex h-full" aria-busy>
        <div className="hidden w-[216px] shrink-0 space-y-2 border-r border-border/60 p-4 md:block">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-full" />
          ))}
        </div>
        <div className="grid flex-1 content-start gap-3 p-7 sm:grid-cols-2">
          <Skeleton className="h-48 w-full rounded-[22px]" />
          <Skeleton className="h-48 w-full rounded-[22px]" />
        </div>
      </div>
    );
  }

  if (overview.isError) {
    return (
      <ErrorState
        title="We couldn't load your competitors"
        detail={overview.error instanceof Error ? overview.error.message : null}
        onRetry={() => void overview.refetch()}
      />
    );
  }

  if (!data) return null;

  const findButton = (full?: boolean) => (
    <button
      type="button"
      onClick={() => {
        setOpenId(null);
        setTab("discover");
        if (data.researchAvailable) discover.mutate();
      }}
      disabled={discover.isPending || bootstrapping || !data.researchAvailable}
      className={cn(primaryBtn, "h-10 px-4 text-[13px]", full && "w-full")}
    >
      {discover.isPending ? (
        <Spinner className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Search className="h-3.5 w-3.5" />
      )}
      {discover.isPending ? "Looking" : "Find competitors"}
    </button>
  );

  const nav: SurfaceNavItem<TabId>[] = [
    { id: "competitors", label: "Competitors", icon: Users, count: data.competitors.length },
    {
      id: "updates",
      label: "Updates",
      icon: Bell,
      count: data.unreadUpdates,
      highlight: true,
    },
    {
      id: "discover",
      label: "Discover",
      icon: Compass,
      count: data.suggestions.length,
      highlight: true,
    },
  ];

  let page: React.ReactNode;
  if (selected) {
    page = (
      <SurfacePage>
        <CompetitorDetail
          competitor={selected}
          updates={data.updates.filter((update) => update.competitorId === selected.id)}
          onBack={() => setOpenId(null)}
          onRefresh={(full) => refresh.mutate({ competitorId: selected.id, full })}
          onRemove={() => {
            remove.mutate(selected.id);
            setOpenId(null);
          }}
          refreshing={refresh.isPending}
        />
      </SurfacePage>
    );
  } else if (tab === "competitors") {
    page = (
      <SurfacePage
        title="Competitors"
        actions={
          data.competitors.length > 0 && (
            <button
              type="button"
              onClick={() => setTab("discover")}
              className={cn(ghostBtn, "h-9 px-3.5 text-[12.5px]")}
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          )
        }
      >
        {data.competitors.length ? (
          <>
            <div className="mb-5 grid gap-2 sm:grid-cols-3" aria-label="Research progress">
              <div className="rounded-2xl border border-border/50 bg-primary/[0.06] px-4 py-3">
                <div className="text-[22px] font-semibold tracking-tight text-foreground">
                  {data.competitors.length}
                </div>
                <div className="text-[11.5px] text-muted-foreground">Competitors found</div>
              </div>
              <div className="rounded-2xl border border-border/50 bg-card/60 px-4 py-3">
                <div className="text-[22px] font-semibold tracking-tight text-foreground">
                  {data.competitors.filter((entry) => entry.profileStatus === "ready").length}
                </div>
                <div className="text-[11.5px] text-muted-foreground">Profiles researched</div>
              </div>
              <div className="rounded-2xl border border-border/50 bg-card/60 px-4 py-3">
                <div className="text-[22px] font-semibold tracking-tight text-foreground">
                  {
                    data.competitors.filter(
                      (entry) =>
                        entry.profileStatus === "running" || entry.profileStatus === "pending",
                    ).length
                  }
                </div>
                <div className="text-[11.5px] text-muted-foreground">Researching now</div>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {data.competitors.map((competitor) => (
                <CompetitorCard
                  key={competitor.id}
                  competitor={competitor}
                  onOpen={() => setOpenId(competitor.id)}
                  onRefresh={() => refresh.mutate({ competitorId: competitor.id })}
                  refreshing={
                    refresh.isPending && refresh.variables?.competitorId === competitor.id
                  }
                />
              ))}
            </div>
          </>
        ) : (
          <EmptyState
            icon={Users}
            title={bootstrapping ? "Researching your competitors" : "No competitors yet"}
            description={
              bootstrapping
                ? "We're searching from your Brand DNA and reading public sources."
                : "We can find them from your Brand DNA, or you can add one."
            }
            action={
              bootstrapping ? (
                <Spinner className="h-5 w-5 animate-spin text-primary" />
              ) : (
                findButton()
              )
            }
          />
        )}
      </SurfacePage>
    );
  } else if (tab === "updates") {
    page = (
      <SurfacePage title="Updates">
        <UpdatesFeed
          updates={data.updates}
          unread={data.unreadUpdates}
          onMarkRead={() => markRead.mutate(null)}
          hasCompetitors={data.competitors.length > 0}
        />
      </SurfacePage>
    );
  } else {
    page = (
      <SurfacePage title="Discover">
        <DiscoverTab
          suggestions={data.suggestions}
          researchAvailable={data.researchAvailable}
          discovering={discover.isPending}
          onDiscover={() => discover.mutate()}
          onTrack={(id) => setStatus.mutate({ competitorId: id, status: "tracked" })}
          onIgnore={(id) => setStatus.mutate({ competitorId: id, status: "ignored" })}
          onAdd={(url) => add.mutate({ url })}
          adding={add.isPending}
          busyId={setStatus.isPending ? (setStatus.variables?.competitorId ?? null) : null}
        />
      </SurfacePage>
    );
  }

  return (
    <section aria-label="Competitors" className="h-full">
      <SurfaceLayout
        label="Competitors"
        items={nav}
        value={selected ? "competitors" : tab}
        onChange={(id) => {
          setOpenId(null);
          setTab(id);
        }}
        railTop={data.researchAvailable ? findButton(true) : undefined}
      >
        <div key={`${tab}-${openId ?? ""}`} className="animate-in fade-in duration-300">
          {page}
        </div>
      </SurfaceLayout>
    </section>
  );
}
