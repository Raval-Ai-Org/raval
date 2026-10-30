"use client";

// Campaigns (ADR-0039): planned runs of posts and Stories around a launch, an
// event, a season or a sale. Presentational: CampaignsPanel feeds it real data
// and /campaigns-lab feeds it samples. Nothing here starts work by itself;
// every paid step is a person's click with the price on the button.
import { useMemo } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { ArrowRight, Calendar, Lightbulb, Megaphone, Plus } from "@/components/icons";
import { dsGhostBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { EmptyState } from "@/components/ui/empty-state";
import { playbookById } from "@/lib/campaigns/playbooks";
import { currentPhase, daysUntil } from "@/lib/campaigns/progress";
import type { CampaignSuggestion, CampaignView } from "@/lib/campaigns/contracts";
import { duration, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { CampaignDesigner } from "./CampaignDesigner";
import { CampaignDetail } from "./CampaignDetail";
import { PhaseRail, StatusPill, countdown, kindIcon } from "./kit";
import { Gallery } from "./Gallery";
import { Timeline } from "./Timeline";
import type { CampaignsHandlers, CampaignsMode, CampaignsTab, CampaignsView } from "./types";

const TAB_LABELS: Record<CampaignsTab, string> = {
  overview: "Overview",
  running: "Running",
  drafts: "Drafts",
  done: "Finished",
};

const inTab: Record<Exclude<CampaignsTab, "overview">, (c: CampaignView) => boolean> = {
  running: (c) => c.status === "running" || c.status === "paused",
  drafts: (c) => c.status === "draft" || c.status === "ready",
  done: (c) => c.status === "done" || c.status === "ended",
};

export function CampaignsScreen({
  view,
  mode,
  tab,
  handlers,
}: {
  view: CampaignsView;
  mode: CampaignsMode;
  tab: CampaignsTab;
  handlers: CampaignsHandlers;
}) {
  return (
    <MotionConfig reducedMotion="user">
      <div className="@container/campaigns relative flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
        <AnimatePresence mode="wait" initial={false}>
          {mode.kind === "new" ? (
            <motion.div
              key={`new-${mode.editId ?? mode.type ?? ""}`}
              className="flex min-h-0 flex-1 flex-col"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: duration.medium, ease: ease.emphasized }}
            >
              <CampaignDesigner view={view} mode={mode} handlers={handlers} />
            </motion.div>
          ) : mode.kind === "campaign" ? (
            <motion.div
              key={`c-${mode.id}`}
              className="studio-enter-blur min-h-0 flex-1 overflow-y-auto"
              exit={{ opacity: 0 }}
              transition={{ duration: duration.fast }}
            >
              <CampaignDetail view={view} id={mode.id} handlers={handlers} />
            </motion.div>
          ) : (
            <motion.div
              key="home"
              className="min-h-0 flex-1 overflow-y-auto"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: duration.base }}
            >
              <Home view={view} tab={tab} handlers={handlers} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}

/* ───────────────────────── home ───────────────────────── */

function Home({
  view,
  tab,
  handlers,
}: {
  view: CampaignsView;
  tab: CampaignsTab;
  handlers: CampaignsHandlers;
}) {
  const { campaigns, suggestions, everyday, autopilot } = view.home;
  const counts = useMemo(
    () => ({
      overview: null,
      running: campaigns.filter(inTab.running).length,
      drafts: campaigns.filter(inTab.drafts).length,
      done: campaigns.filter(inTab.done).length,
    }),
    [campaigns],
  );
  const running = campaigns.filter(inTab.running);
  const waiting = running.reduce((n, c) => n + c.progress.waiting, 0);

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 pb-16 @3xl/campaigns:px-8">
      {/* Hero */}
      <div className="relative pb-5 pt-6 @3xl/campaigns:pt-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-1/2 h-56 w-[70%] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl"
        />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 max-w-xl">
            <h1 className="ds-page-title text-[26px] font-semibold leading-tight tracking-tight @3xl/campaigns:text-[32px]">
              Campaigns
            </h1>
            <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
              {running.length
                ? `${running.length} running${waiting ? ` · ${waiting} waiting for you` : ""}`
                : "Launches, events, seasons and sales."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              data-testid="open-calendar"
              onClick={handlers.openCalendar}
              className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")}
            >
              <Calendar className="size-4" />
              Calendar
            </button>
            {view.canEdit && (
              <button
                type="button"
                data-testid="new-campaign"
                onClick={() => handlers.go({ kind: "new" })}
                className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px]")}
              >
                <Plus className="size-4" />
                New campaign
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div
          role="tablist"
          aria-label="Campaigns"
          className="relative mt-5 inline-flex max-w-full overflow-x-auto rounded-full bg-[var(--ds-well-bg)] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {(Object.keys(TAB_LABELS) as CampaignsTab[]).map((t) => {
            const on = tab === t;
            const n = counts[t];
            return (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => handlers.tab(t)}
                className={cn(
                  "relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {on && (
                  <motion.span
                    layoutId="campaigns-tab"
                    className="absolute inset-0 rounded-full bg-[var(--ds-tile-bg)] shadow-1 ring-1 ring-border/70"
                    transition={{ duration: duration.medium, ease: ease.emphasized }}
                  />
                )}
                <span className="relative">{TAB_LABELS[t]}</span>
                {n ? (
                  <span className="relative tabular-nums text-muted-foreground">{n}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {tab === "overview" ? (
        <div className="space-y-10">
          {running.length > 0 && (
            <Block title="Running now">
              <CardGrid campaigns={running} view={view} handlers={handlers} />
            </Block>
          )}

          <Block title="Next 8 weeks">
            <Timeline
              campaigns={campaigns}
              everyday={everyday}
              today={view.today}
              autopilotRunning={autopilot.running}
              onOpen={(id) => handlers.go({ kind: "campaign", id })}
            />
          </Block>

          {suggestions.length > 0 && view.canEdit && (
            <Block
              title="Ideas for you"
              hint="From your calendar, products and goal. Free to plan out."
            >
              <Suggestions items={suggestions} handlers={handlers} />
            </Block>
          )}

          {view.canEdit && (
            <Block title="Start a campaign">
              <Gallery onPick={(type) => handlers.go({ kind: "new", type })} />
            </Block>
          )}
        </div>
      ) : (
        <TabList tab={tab} view={view} handlers={handlers} />
      )}
    </div>
  );
}

function Block({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {hint && <p className="text-[12px] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function TabList({
  tab,
  view,
  handlers,
}: {
  tab: Exclude<CampaignsTab, "overview">;
  view: CampaignsView;
  handlers: CampaignsHandlers;
}) {
  const list = view.home.campaigns.filter(inTab[tab]);
  if (!list.length) {
    const copy = {
      running: {
        title: "Nothing running",
        body: "Start a campaign and it shows here while it runs.",
      },
      drafts: { title: "No drafts", body: "A campaign you plan but haven't started waits here." },
      done: {
        title: "Nothing finished yet",
        body: "Campaigns that have run their course show here.",
      },
    }[tab];
    return (
      <div className="ds-tile">
        <EmptyState
          icon={Megaphone}
          title={copy.title}
          description={copy.body}
          action={
            view.canEdit ? (
              <button
                type="button"
                onClick={() => handlers.go({ kind: "new" })}
                className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px]")}
              >
                <Plus className="size-4" />
                New campaign
              </button>
            ) : undefined
          }
        />
      </div>
    );
  }
  return <CardGrid campaigns={list} view={view} handlers={handlers} />;
}

/* ───────────────────────── campaign cards ───────────────────────── */

function CardGrid({
  campaigns,
  view,
  handlers,
}: {
  campaigns: CampaignView[];
  view: CampaignsView;
  handlers: CampaignsHandlers;
}) {
  return (
    <div className="grid gap-3 @2xl/campaigns:grid-cols-2 @5xl/campaigns:grid-cols-3">
      {campaigns.map((c, i) => (
        <motion.div
          key={c.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: duration.slow,
            ease: ease.emphasized,
            delay: Math.min(i, 8) * 0.04,
          }}
        >
          <CampaignCard
            campaign={c}
            today={view.today}
            onOpen={() => handlers.go({ kind: "campaign", id: c.id })}
          />
        </motion.div>
      ))}
    </div>
  );
}

function CampaignCard({
  campaign: c,
  today,
  onOpen,
}: {
  campaign: CampaignView;
  today: string;
  onOpen(): void;
}) {
  const playbook = playbookById(c.type);
  const Icon = kindIcon(playbook?.icon);
  const phase = currentPhase(c.plan.phases, today);
  const next = c.pieces.find(
    (p) => p.date >= today && p.state !== "out" && p.state !== "cancelled",
  );
  const thumbs = c.pieces.filter((p) => p.thumb).slice(-3);
  const key = c.keyDate ? daysUntil(c.keyDate, today) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="campaign-card"
      className="ds-tile ds-tile-hover group relative flex w-full flex-col gap-4 overflow-hidden p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 size-36 rounded-full bg-primary/10 blur-2xl transition-opacity duration-500 group-hover:opacity-100 @md:opacity-70"
      />
      <div className="relative flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/12 text-primary ring-1 ring-primary/20">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold tracking-tight">{c.name}</p>
          <p className="truncate text-[12px] text-muted-foreground">
            {playbook?.label ?? "Campaign"}
            {phase && (c.status === "running" || c.status === "paused") ? ` · ${phase.label}` : ""}
          </p>
        </div>
        <StatusPill status={c.status} />
      </div>

      <PhaseRail phases={c.plan.phases} today={today} compact />

      <div className="relative flex items-end justify-between gap-3">
        <div className="min-w-0 space-y-0.5 text-[12px]">
          <p className="font-medium tabular-nums text-foreground/85">
            {c.progress.out} of {c.progress.pieces} out
            {c.progress.waiting ? (
              <span className="text-primary"> · {c.progress.waiting} waiting for you</span>
            ) : null}
          </p>
          <p className="truncate text-muted-foreground">
            {key !== null && key >= 0
              ? `${playbook?.needs.keyDate ? "Big day" : "Peak"} ${countdown(key).toLowerCase()}`
              : next
                ? `Next: ${next.title || "a post"}`
                : "All planned posts are done"}
          </p>
        </div>
        {thumbs.length > 0 ? (
          <div className="flex -space-x-3">
            {thumbs.map((p) => (
              <img
                key={p.id}
                src={p.thumb!}
                alt=""
                className="size-10 rounded-xl object-cover ring-2 ring-[var(--ds-tile-bg)]"
              />
            ))}
          </div>
        ) : (
          <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
        )}
      </div>
    </button>
  );
}

/* ───────────────────────── suggestions and gallery ───────────────────────── */

const SOURCE_LABELS: Record<CampaignSuggestion["source"], string> = {
  moment: "Coming up",
  product: "Your products",
  goal: "Your goal",
  opportunity: "Spotted for you",
  strategy: "Your strategy",
  evergreen: "Always works",
};

function Suggestions({
  items,
  handlers,
}: {
  items: CampaignSuggestion[];
  handlers: CampaignsHandlers;
}) {
  return (
    <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] @3xl/campaigns:mx-0 @3xl/campaigns:grid @3xl/campaigns:grid-cols-3 @3xl/campaigns:overflow-visible @3xl/campaigns:px-0 [&::-webkit-scrollbar]:hidden">
      {items.map((s, i) => {
        const Icon = kindIcon(playbookById(s.type)?.icon);
        return (
          <motion.div
            key={s.id}
            className="w-[260px] shrink-0 snap-start @3xl/campaigns:w-auto"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: duration.slow, ease: ease.emphasized, delay: i * 0.05 }}
          >
            <div className="ds-tile flex h-full flex-col gap-3 p-4">
              <div className="flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-xl bg-primary/12 text-primary">
                  <Icon className="size-4" />
                </span>
                <span className="text-[11px] font-medium text-muted-foreground">
                  {SOURCE_LABELS[s.source]}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold leading-snug">{s.title}</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{s.why}</p>
              </div>
              <button
                type="button"
                data-testid="plan-suggestion"
                onClick={() => handlers.go({ kind: "new", type: s.type, prefill: s.brief })}
                className={cn(dsGhostBtn, "h-8 self-start px-3 text-[12.5px]")}
              >
                <Lightbulb className="size-3.5" />
                Plan this
              </button>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
