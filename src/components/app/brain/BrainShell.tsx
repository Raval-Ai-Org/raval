"use client";
// BrainShell — one window for the four brains and the strategy.
//
// A row of six tabs across the top (Home, the four brains, Strategy); below it
// the section itself. Each brain keeps its own inner navigation, so there is
// never a rail inside a rail. The section comes from the URL (?s=…), which is
// what makes every part of Brain linkable from elsewhere in Mellox.
import { Suspense, lazy, useEffect, useMemo } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { ArrowLeft, Home, Lock } from "@/components/icons";
import { openFeatureUpgrade } from "@/components/app/FeatureGate";
import { SurfacePage } from "@/components/app/surface/SurfaceLayout";
import { dsFocus, dsGhostBtn } from "@/components/app/surface/buttons";
import { ErrorState } from "@/components/ui/empty-state";
import { PageLoader } from "@/components/ui/page-loader";
import { Skeleton } from "@/components/ui/skeleton";
import { useBrandDna, type BrandDna } from "@/hooks/use-brand-dna";
import { PLANS, type FeatureKey } from "@/lib/billing/catalog";
import { useEntitlements } from "@/lib/billing/use-entitlements";
import { BRAINS, BRAIN_META, type BrainId, type BrainSection } from "@/lib/brain/brain";
import { cn } from "@/lib/utils";
import { BrainHome } from "./BrainHome";
import { BrainIcon, BrainMark } from "./BrainMark";
import { useBrainOverview, useBrainSeen } from "./use-brain";

const BrandDnaSurface = lazy(() =>
  import("@/components/app/BrandDnaPanel").then((m) => ({ default: m.BrandDnaSurface })),
);
const CustomersTab = lazy(() =>
  import("@/components/app/BrandDnaPanel").then((m) => ({ default: m.CustomersTab })),
);
const AudiencePanel = lazy(() =>
  import("@/components/app/audience/AudiencePanel").then((m) => ({ default: m.AudiencePanel })),
);
const CompetitorsPanel = lazy(() =>
  import("@/components/app/competitors/CompetitorsPanel").then((m) => ({
    default: m.CompetitorsPanel,
  })),
);
const MarketBrainPanel = lazy(() =>
  import("@/components/app/MarketBrainPanel").then((m) => ({ default: m.MarketBrainPanel })),
);
const StrategyPanel = lazy(() =>
  import("./strategy/StrategyPanel").then((m) => ({ default: m.StrategyPanel })),
);
const TodayBrief = lazy(() => import("./home/TodayBrief").then((m) => ({ default: m.TodayBrief })));
const NotesBoard = lazy(() => import("./home/NotesBoard").then((m) => ({ default: m.NotesBoard })));

/** The plan feature that gates a brain, where one does. */
const BRAIN_FEATURE: Partial<Record<BrainId, FeatureKey>> = {
  audience: "audience",
  competitors: "competitors",
  market: "market_brain",
};

const HOME_TABS = ["overview", "today", "notes"] as const;
type HomeTab = (typeof HOME_TABS)[number];
const HOME_LABELS: Record<HomeTab, string> = {
  overview: "Overview",
  today: "Today",
  notes: "Notes",
};

/** A few lines of Brand DNA for the day's plan (the server reads the full DNA itself). */
function coachContext(dna: BrandDna): string {
  return [
    dna.brandName && `Brand: ${dna.brandName}`,
    dna.oneLiner && `One-liner: ${dna.oneLiner}`,
    dna.about && `About: ${dna.about}`,
    dna.industry && `Industry: ${dna.industry}`,
    dna.audience && `Audience: ${dna.audience}`,
    dna.voice && `Voice: ${dna.voice}`,
    dna.products && `Products: ${dna.products}`,
    dna.positioning && `Positioning: ${dna.positioning}`,
    dna.uniqueValueProp && `UVP: ${dna.uniqueValueProp}`,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 7000);
}

export type BrainShellProps = {
  workspaceId: string;
  section: BrainSection;
  /** A place inside the section (a Brand tile, a Home tab, "customers"). */
  tab?: string | null;
  onNavigate: (section: BrainSection, tab?: string | null) => void;
};

export function BrainShell({ workspaceId, section, tab, onNavigate }: BrainShellProps) {
  const overview = useBrainOverview(workspaceId);
  const { news, markSeen } = useBrainSeen(workspaceId, overview.data);
  const billing = useEntitlements();
  const { dna } = useBrandDna(workspaceId);

  const locked = useMemo(() => {
    const out: Partial<Record<BrainId, string>> = {};
    for (const brain of BRAINS) {
      const feature = BRAIN_FEATURE[brain];
      const grant = feature ? billing.data?.features[feature] : undefined;
      if (grant && !grant.allowed) out[brain] = PLANS[grant.requiredPlan].label;
    }
    return out;
  }, [billing.data]);

  const enabled = (brain: BrainId) => overview.data?.brains[brain].enabled !== false;
  const tabs: Array<{ id: BrainSection; label: string; color: string }> = [
    { id: "home", label: "Home", color: BRAIN_META.home.color },
    ...BRAINS.filter(enabled).map((b) => ({
      id: b as BrainSection,
      label: BRAIN_META[b].label,
      color: BRAIN_META[b].color,
    })),
    { id: "strategy", label: "Strategy", color: BRAIN_META.strategy.color },
  ];

  // Looking at the news is reading it: leaving Home marks it seen.
  useEffect(() => {
    if (section !== "home") return;
    return () => markSeen();
  }, [section, markSeen]);

  const open = (next: BrainSection, nextTab?: string | null) => {
    const feature = next !== "home" && next !== "strategy" ? BRAIN_FEATURE[next] : undefined;
    if (feature && next !== "home" && next !== "strategy" && locked[next]) {
      openFeatureUpgrade(feature);
      return;
    }
    onNavigate(next, nextTab);
  };

  const homeTab: HomeTab = (HOME_TABS as readonly string[]).includes(tab ?? "")
    ? (tab as HomeTab)
    : "overview";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── the six tabs ── */}
      <LayoutGroup id="brain-tabs">
        <div
          role="tablist"
          aria-label="Brain"
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-border/50 px-2 py-2 [scrollbar-width:none] sm:justify-center sm:px-4 [&::-webkit-scrollbar]:hidden"
        >
          {tabs.map((t, i) => {
            const active = t.id === section;
            const isBrain = t.id !== "home" && t.id !== "strategy";
            const count = t.id === "home" ? 0 : news[t.id as BrainId | "strategy"];
            const lock = isBrain ? locked[t.id as BrainId] : undefined;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => open(t.id)}
                className={cn(
                  "relative flex h-10 shrink-0 items-center gap-2 rounded-full px-3.5 text-[13px] font-medium transition-colors",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  dsFocus,
                )}
              >
                {active && (
                  <motion.span
                    layoutId="brain-tab-active"
                    aria-hidden
                    transition={{ type: "spring", stiffness: 420, damping: 36 }}
                    className="absolute inset-0 rounded-full ring-1"
                    style={{
                      background: `color-mix(in srgb, ${t.color} 14%, transparent)`,
                      // ring colour
                      ["--tw-ring-color" as string]: `color-mix(in srgb, ${t.color} 32%, transparent)`,
                    }}
                  />
                )}
                <span className="relative grid h-5 w-5 place-items-center">
                  {isBrain ? (
                    <BrainMark
                      brain={t.id as BrainId}
                      size={18}
                      delay={i * 0.05}
                      active={count > 0 && !active}
                      muted={!!lock}
                    />
                  ) : t.id === "home" ? (
                    <Home className="h-[17px] w-[17px]" strokeWidth={active ? 2.2 : 1.9} />
                  ) : (
                    <BrainIcon size={18} />
                  )}
                </span>
                <span className="relative">{t.label}</span>
                {lock ? (
                  <Lock className="relative h-3 w-3 opacity-70" />
                ) : (
                  count > 0 &&
                  !active && (
                    <span className="relative rounded-full bg-primary px-1.5 text-[10.5px] font-semibold leading-[17px] text-primary-foreground">
                      {count}
                    </span>
                  )
                )}
              </button>
            );
          })}
        </div>
      </LayoutGroup>

      {/* ── the section ── */}
      <div className="relative min-h-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={section === "audience" && tab === "customers" ? "audience-customers" : section}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0"
          >
            <Suspense fallback={<PageLoader />}>
              {section === "home" && (
                <div className="flex h-full flex-col">
                  <div className="flex shrink-0 justify-center px-4 pt-4">
                    <div
                      role="tablist"
                      aria-label="Home"
                      className="ds-well inline-flex gap-0.5 rounded-full p-1"
                    >
                      {HOME_TABS.map((id) => {
                        const active = id === homeTab;
                        return (
                          <button
                            key={id}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => onNavigate("home", id === "overview" ? null : id)}
                            className={cn(
                              "h-8 min-w-[92px] rounded-full px-4 text-[13px] font-medium transition-all duration-200",
                              active
                                ? "bg-[var(--ds-tile-bg)] text-foreground shadow-sm ring-1 ring-primary/30"
                                : "text-muted-foreground hover:text-foreground",
                              dsFocus,
                            )}
                          >
                            {HOME_LABELS[id]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
                    {homeTab === "overview" &&
                      (overview.isLoading ? (
                        <div className="mx-auto max-w-[1040px] space-y-3 px-4 pt-5 sm:px-6">
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            {BRAINS.map((b) => (
                              <Skeleton
                                key={b}
                                className="h-[150px] rounded-[var(--ds-radius-tile)]"
                              />
                            ))}
                          </div>
                          <Skeleton className="h-28 w-full rounded-[var(--ds-radius-tile)]" />
                        </div>
                      ) : overview.error || !overview.data ? (
                        <SurfacePage>
                          <ErrorState
                            title="We couldn't load your brain"
                            detail={
                              overview.error instanceof Error ? overview.error.message : undefined
                            }
                            onRetry={() => void overview.refetch()}
                          />
                        </SurfacePage>
                      ) : (
                        <BrainHome
                          overview={overview.data}
                          news={news}
                          locked={locked}
                          onOpen={open}
                        />
                      ))}
                    {homeTab === "today" && (
                      <div className="mx-auto w-full max-w-[760px] px-4 pb-10 pt-5 sm:px-6">
                        <TodayBrief workspaceId={workspaceId} brandContext={coachContext(dna)} />
                      </div>
                    )}
                    {homeTab === "notes" && (
                      <div className="mx-auto w-full max-w-[1040px] px-4 pb-10 pt-5 sm:px-6">
                        <NotesBoard workspaceId={workspaceId} />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {section === "brand" && <BrandDnaSurface workspaceId={workspaceId} tile={tab} />}

              {section === "audience" &&
                (tab === "customers" ? (
                  <div className="h-full overflow-y-auto scrollbar-thin">
                    <SurfacePage
                      title="Customer notes"
                      width="narrow"
                      actions={
                        <button
                          type="button"
                          className={cn(dsGhostBtn, "h-9 px-3.5 text-[13px]")}
                          onClick={() => onNavigate("audience")}
                        >
                          <ArrowLeft className="h-4 w-4" /> Groups
                        </button>
                      }
                    >
                      <CustomerNotes workspaceId={workspaceId} />
                    </SurfacePage>
                  </div>
                ) : (
                  <AudiencePanel workspaceId={workspaceId} />
                ))}

              {section === "competitors" && <CompetitorsPanel workspaceId={workspaceId} />}

              {section === "market" && (
                <div className="h-full overflow-y-auto scrollbar-thin">
                  <SurfacePage width="wide">
                    <MarketBrainPanel workspaceId={workspaceId} brandKeywords={dna.keywords} />
                  </SurfacePage>
                </div>
              )}

              {section === "strategy" && (
                <div className="h-full overflow-y-auto scrollbar-thin">
                  <StrategyPanel workspaceId={workspaceId} onOpenBrain={(brain) => open(brain)} />
                </div>
              )}
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/** What you know about your customers: the Brand DNA fields, edited here. */
function CustomerNotes({ workspaceId }: { workspaceId: string }) {
  const { dna, save } = useBrandDna(workspaceId);
  return <CustomersTab dna={dna} save={save} />;
}
