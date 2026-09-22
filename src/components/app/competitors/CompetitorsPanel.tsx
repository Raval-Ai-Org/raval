"use client";
// CompetitorsPanel.tsx — the Competitors surface.
//
// Three tabs for the three questions: who they are (Competitors), what changed
// (Updates), and who else might matter (Discover). Everything is one entity
// underneath, so a competitor added by hand, found by search or carried over
// from Brand DNA lands in the same place.
import * as React from "react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bell, Compass, Search, Spinner, Users } from "@/components/icons";
import { primaryBtn } from "@/components/app/geo/geo-ui";
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
import { CompetitorDetail } from "./CompetitorDetail";
import { DiscoverTab } from "./DiscoverTab";
import { UpdatesFeed } from "./UpdatesFeed";

type TabId = "competitors" | "updates" | "discover";

const TAB_ICON: Record<TabId, React.ComponentType<{ className?: string }>> = {
  competitors: Users,
  updates: Bell,
  discover: Compass,
};

const TAB_LABEL: Record<TabId, string> = {
  competitors: "Competitors",
  updates: "Updates",
  discover: "Discover",
};

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

  const overview = useCompetitorOverview(workspaceId);
  const discover = useDiscoverCompetitors(workspaceId);
  const add = useAddCompetitor(workspaceId);
  const setStatus = useSetCompetitorStatus(workspaceId);
  const refresh = useRefreshCompetitor(workspaceId);
  const markRead = useMarkUpdatesRead(workspaceId);
  const remove = useRemoveCompetitor(workspaceId);

  const data = overview.data;
  const selected = data?.competitors.find((competitor) => competitor.id === openId) ?? null;

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
      <div className="space-y-3 px-1 pb-2" aria-busy>
        <Skeleton className="h-11 w-72 rounded-full" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-44 w-full rounded-2xl" />
          <Skeleton className="h-44 w-full rounded-2xl" />
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

  if (selected) {
    return (
      <section aria-label="Competitor details" className="px-1 pb-2">
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
      </section>
    );
  }

  const counts: Record<TabId, number | undefined> = {
    competitors: data.competitors.length || undefined,
    updates: data.unreadUpdates || undefined,
    discover: data.suggestions.length || undefined,
  };

  return (
    <section aria-label="Competitors" className="space-y-4 px-1 pb-2">
      <Tabs value={tab} onValueChange={(value) => setTab(value as TabId)}>
        <div className="sticky -top-4 z-20 -mx-1 overflow-x-auto bg-background/85 px-1 py-2 backdrop-blur-md [scrollbar-width:none] sm:-top-5 [&::-webkit-scrollbar]:hidden">
          <TabsList className="h-11 gap-0.5 rounded-full border border-border/60 bg-muted/60 p-1 shadow-sm">
            {(["competitors", "updates", "discover"] as const).map((id) => {
              const Icon = TAB_ICON[id];
              return (
                <TabsTrigger
                  key={id}
                  value={id}
                  className="gap-1.5 rounded-full px-3.5 text-[12.5px] transition-all duration-200 data-[state=active]:bg-background data-[state=active]:shadow-md data-[state=active]:ring-1 data-[state=active]:ring-border/60"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {TAB_LABEL[id]}
                  {typeof counts[id] === "number" && (
                    <span className="tabular-nums text-muted-foreground">{counts[id]}</span>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        <TabsContent
          value="competitors"
          className="mt-3 animate-in fade-in slide-in-from-bottom-1 duration-300"
        >
          {data.competitors.length ? (
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
          ) : (
            <EmptyState
              icon={Users}
              title="No competitors yet"
              description="We can look for them using what we already know about your business, or you can add one yourself."
              action={
                <button
                  type="button"
                  onClick={() => {
                    setTab("discover");
                    if (data.researchAvailable) discover.mutate();
                  }}
                  disabled={discover.isPending}
                  className={cn(primaryBtn, "h-9 px-4 text-[13px]")}
                >
                  {discover.isPending ? (
                    <Spinner className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Search className="h-3.5 w-3.5" />
                  )}
                  Find my competitors
                </button>
              }
            />
          )}
        </TabsContent>

        <TabsContent
          value="updates"
          className="mt-3 animate-in fade-in slide-in-from-bottom-1 duration-300"
        >
          <UpdatesFeed
            updates={data.updates}
            unread={data.unreadUpdates}
            onMarkRead={() => markRead.mutate(null)}
            hasCompetitors={data.competitors.length > 0}
          />
        </TabsContent>

        <TabsContent
          value="discover"
          className="mt-3 animate-in fade-in slide-in-from-bottom-1 duration-300"
        >
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
        </TabsContent>
      </Tabs>
    </section>
  );
}
