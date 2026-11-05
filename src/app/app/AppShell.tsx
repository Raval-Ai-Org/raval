"use client";

import { OpeningPill } from "@/components/ui/page-loader";
import { normalizeAnalyticsTab } from "@/components/app/AnalyticsTabs";
import { addAppEventListener, emitAppEvent, removeAppEventListener } from "@/lib/app-events";
import { useBodyPointerGuard } from "@/lib/shell/window";
import { ensureGeoRunCapture } from "@/lib/geo/pending-run";
import { Link, useRouterState, useNavigate } from "@/lib/navigation";

// Remember a chat/suggestion scan request until the lazy AI Visibility dialog mounts.
ensureGeoRunCapture();
import { useServerFn } from "@/lib/use-server-fn";
import { useQuery } from "@tanstack/react-query";
import { getProofEngineStatus } from "@/lib/experiments.functions";
import { useAutopilotStatus } from "@/components/app/autopilot/hooks";
import { AutopilotBeacon } from "@/components/app/autopilot/composer/AutopilotDeck";
import { autopilotPath } from "@/components/app/autopilot/composer/useComposerAutopilot";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useWorkspace, useWorkspaceActions } from "@/components/workspace/WorkspaceProvider";
import {
  brainPath,
  campaignsPath,
  chatPath,
  communitiesPath,
  conversationIdFromPath,
  inspoPath,
  workspacePath,
} from "@/lib/workspace/paths";
import { BrainIcon } from "@/components/app/brain/BrainMark";
import { useBrainOverview, useBrainSeen } from "@/components/app/brain/use-brain";
import type { BrainSection } from "@/lib/brain/brain";
import {
  ArrowLeft,
  ChevronDown,
  Home,
  LayoutGrid,
  Menu,
  MessageCircle,
  PanelRightOpen,
  Plus,
  Rocket,
  Share2,
  Users,
} from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChatPanel } from "@/components/app/ChatPanel";
import { CommandBar } from "@/components/app/CommandBar";
import { TopBarActions } from "@/components/app/TopBarActions";
import { StudioRail } from "@/components/app/StudioRail";
import { RecentChats } from "@/components/app/RecentChats";
import { AccountMenu, AccountMenuCompact } from "@/components/app/AccountMenu";

// Heavy modules — loaded on demand to shrink the initial workspace bundle.
const AnalyticsModal = lazy(() =>
  import("@/components/app/AnalyticsModal").then((m) => ({ default: m.AnalyticsModal })),
);
const StudioComposer = lazy(() =>
  import("@/components/studio/StudioComposer").then((m) => ({ default: m.StudioComposer })),
);
const ContentItemDialog = lazy(() =>
  import("@/components/studio/ContentItemDialog").then((m) => ({ default: m.ContentItemDialog })),
);
const LibraryDialog = lazy(() =>
  import("@/components/app/LibraryDialog").then((m) => ({ default: m.LibraryDialog })),
);
const ContentCalendar = lazy(() =>
  import("@/components/app/ContentCalendar").then((m) => ({ default: m.ContentCalendar })),
);
const WorkspaceDialogs = lazy(() =>
  import("@/components/app/WorkspaceDialogs").then((m) => ({ default: m.WorkspaceDialogs })),
);
const PublishDialog = lazy(() =>
  import("@/components/app/PublishDialog").then((m) => ({ default: m.PublishDialog })),
);
const ShareDialog = lazy(() =>
  import("@/components/app/ShareDialog").then((m) => ({ default: m.ShareDialog })),
);
const ClientPortalDialog = lazy(() =>
  import("@/components/app/ClientPortalDialog").then((m) => ({ default: m.ClientPortalDialog })),
);
const AiVisibilityDialog = lazy(() =>
  import("@/components/app/AiVisibilityDialog").then((m) => ({ default: m.AiVisibilityDialog })),
);
const UgcStudioDialog = lazy(() =>
  import("@/components/app/ugc/UgcStudioDialog").then((m) => ({ default: m.UgcStudioDialog })),
);
const CreateLauncher = lazy(() =>
  import("@/components/studio/CreateLauncher").then((m) => ({ default: m.CreateLauncher })),
);
const BrainPulse = lazy(() =>
  import("@/components/app/brain/BrainPulse").then((m) => ({ default: m.BrainPulse })),
);
const AppTour = lazy(() =>
  import("@/components/app/tour/AppTour").then((m) => ({ default: m.AppTour })),
);

import { useStudioEntry } from "@/hooks/use-studio";
import { StudioActivityWatcher, StudioButton } from "@/components/studio/StudioButton";
import { GeneratingPanel } from "@/components/studio/GeneratingPanel";
import { setStudioRailOpen } from "@/lib/studio/rail-state";
import { useStudioStore } from "@/lib/studio/session-store";
import { useIsCompact } from "@/hooks/use-mobile";
import { Logo } from "@/components/brand/Logo";
import { WorkspaceMenu } from "@/components/app/WorkspaceMenu";
import { useBrandDna } from "@/hooks/use-brand-dna";
import { useRealtimeContent } from "@/hooks/use-realtime-content";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { useSwipe } from "@/hooks/use-swipe";
import { BillingPanel } from "@/components/app/BillingPanel";
import { openFeatureUpgrade } from "@/components/app/FeatureGate";
import type { PlanId } from "@/lib/billing/catalog";
import { AppCanvas, AppFrame } from "@/components/app/shell/AppFrame";
import { PlanChip } from "@/components/app/billing/WalletPill";
import { BrandMeter } from "@/components/app/shell/BrandMeter";
import { MoxGauge } from "@/components/app/shell/MoxGauge";
import { SidebarNav } from "@/components/app/shell/SidebarNav";
import { StartHereModal } from "@/components/app/home/StartHere";
import { EntryBloom } from "@/components/brand/mox/VisorTransition";
import { activeNavId, type NavItem } from "@/lib/shell/nav";
import { useEntitlements } from "@/lib/billing/use-entitlements";
import { useAppTourSeen } from "@/hooks/use-app-tour";
import { AnnouncementsOutlet } from "@/components/app/announcements/AnnouncementsOutlet";
import {
  TOUR_FIRST_POST_PROMPT,
  tourStops,
  type TourFinishAction,
  type TourStop,
} from "@/lib/tour/steps";

function AppShell() {
  // The workspace comes from the route and is verified by WorkspaceProvider
  // before this shell mounts — there is no loading-from-localStorage phase in
  // which another workspace's name, logo or chats could show.
  const workspace = useWorkspace();
  const { patch: patchWorkspace } = useWorkspaceActions();
  const workspaceId = workspace.id;
  // Plan features for the lock labels on paid sidebar items.
  const billing = useEntitlements();
  const proofEngineStatus = useServerFn(getProofEngineStatus);
  const { data: proofEngine } = useQuery({
    queryKey: ["proof-engine-status", workspaceId],
    queryFn: () => proofEngineStatus({ data: { workspaceId } }),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const { data: autopilot } = useAutopilotStatus(workspaceId);
  const workspaceName = workspace.displayName;
  const homeHref = workspacePath(workspaceId);

  const { dna: brandDna } = useBrandDna(workspaceId);
  const brandLogo = brandDna.logoUrl || brandDna.faviconUrl;
  // What's new across the brains, for the sidebar entry's count.
  const brainOverview = useBrainOverview(workspaceId);
  const { total: brainNews } = useBrainSeen(workspaceId, brainOverview.data);
  // Subscribe to realtime updates for content_items + approvals so Studio and
  // analytics refresh instantly when chat/agents create or modify rows.
  useRealtimeContent(workspaceId);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const activeConversationId = conversationIdFromPath(path);
  // `?view=chat` is the Chat entry: the thread instead of Home's cards.
  const chatView = useRouterState({
    select: (s) => s.location.search.view === "chat",
  });
  const routeNavId = activeNavId(path, homeHref, chatView || Boolean(activeConversationId));
  // A full window (Library, Calendar, Analytics, Create...) highlights its own
  // row while it is open; otherwise the page's row.
  const [windowNav, setWindowNav] = useState<string | null>(null);
  useEffect(() => {
    const on = (event: CustomEvent<{ id: string; open: boolean }>) => {
      const { id, open } = event.detail;
      setWindowNav((current) => (open ? id : current === id ? null : current));
    };
    addAppEventListener("shell:window", on);
    return () => removeAppEventListener("shell:window", on);
  }, []);
  const activeId = windowNav ?? routeNavId;
  // Never let a closed window leave the whole app unclickable.
  useBodyPointerGuard();
  const isCompact = useIsCompact();
  const [navOpen, setNavOpen] = useState(false);
  // Compact widths use an overlay drawer; desktop keeps an inline sidebar.
  const [vw, setVw] = useState<number>(1024);
  useEffect(() => {
    const on = () => setVw(window.innerWidth);
    on();
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("orientationchange", on);
    };
  }, []);
  const sidebarWidth = isCompact ? Math.min(320, Math.round(vw * 0.9)) : 196;

  // Swipe gestures on mobile: right-swipe from left edge opens nav; left-swipe closes it.
  useSwipe({
    enabled: isCompact,
    edgeStartLeftPx: navOpen ? undefined : 24,
    onSwipeRight: () => {
      if (!navOpen) setNavOpen(true);
    },
    onSwipeLeft: () => {
      if (navOpen) setNavOpen(false);
    },
  });

  // On a computer the sidebar starts open and stays open until the person
  // minimizes it; that choice is remembered. Read after mount (avoids SSR
  // hydration mismatch). On a phone it is a drawer and starts closed.
  const navHydrated = useRef(false);
  useEffect(() => {
    try {
      const v = localStorage.getItem("app:navOpen");
      if (v !== "0" && window.innerWidth >= 1024) setNavOpen(true);
    } catch {
      if (window.innerWidth >= 1024) setNavOpen(true);
    }
  }, []);
  useEffect(() => {
    // Skip the first pass, before the stored choice has been applied.
    if (!navHydrated.current) {
      navHydrated.current = true;
      return;
    }
    try {
      if (!isCompact) localStorage.setItem("app:navOpen", navOpen ? "1" : "0");
    } catch {}
  }, [navOpen, isCompact]);
  // Going somewhere from the sidebar closes it only where it is a drawer.
  const closeNavOnPhone = useCallback(() => {
    if (isCompact) setNavOpen(false);
  }, [isCompact]);
  useEffect(() => {
    if (isCompact) setNavOpen(false);
  }, [isCompact]);
  useEffect(() => {
    if (!isCompact || !navOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isCompact, navOpen]);
  const [, setChatOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  useStudioEntry(workspaceId);
  // Load the composer bundle only once someone opens Studio.
  const studioInUse = useStudioStore((st) =>
    st.sessions.some((x) => x.workspaceId === workspaceId),
  );
  // Open Analytics modal via custom event, ⌘./Ctrl+. keybind, or sessionStorage flag set by /app/analytics redirect.
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Current tab ids, plus legacy ones (organic/social/audience) mapped to their new home.
    const isValidTab = (t: unknown): t is string =>
      typeof t === "string" && normalizeAnalyticsTab(t) !== null;

    const openWith = (tab?: string) => {
      // Silently drop unknown tab values so a malformed deep-link doesn't
      // pollute the URL with garbage. The modal still opens on the default tab.
      const clean = isValidTab(tab) ? (normalizeAnalyticsTab(tab) ?? undefined) : undefined;
      if (clean) {
        const url = new URL(window.location.href);
        url.searchParams.set("tab", clean);
        window.history.replaceState({}, "", url.pathname + "?" + url.searchParams.toString());
      }
      setAnalyticsOpen(true);
    };

    try {
      const pending = sessionStorage.getItem("analytics:open");
      if (pending) {
        sessionStorage.removeItem("analytics:open");
        if (isValidTab(pending)) openWith(pending);
      } else {
        // Hydrate from URL on mount so `/app?tab=<t>` reopens the Analytics
        // modal on the requested tab across refresh / direct load. Unknown
        // values are ignored — no modal, no navigation.
        const t = new URL(window.location.href).searchParams.get("tab");
        if (isValidTab(t)) openWith(t);
      }
    } catch {}

    const onOpen = (e: Event) => {
      const tab = (e as CustomEvent).detail?.tab;
      openWith(typeof tab === "string" ? tab : undefined);
    };

    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault();
        setAnalyticsOpen((o) => !o);
      }
      // ⌘\ used to call toggleChat(), which set a `chatCollapsed` flag that
      // nothing read — the shortcut swallowed the keystroke and did nothing.
      // It now toggles the sidebar, which is the panel a user pressing a
      // collapse shortcut in this layout would expect to move.
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setNavOpen((open) => !open);
      }
    };
    addAppEventListener("open:analytics", onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      removeAppEventListener("open:analytics", onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // Autopilot is switched on in the chat message box and has no sidebar entry.
  // Its full screen is a route; buttons elsewhere open it with this event.
  useEffect(() => {
    const onOpenAutopilot = () => navigate({ to: workspacePath(workspaceId, "autopilot") });
    // Chat's buttons and the "/" menu reach these two routes the same way.
    const onOpenBacklinks = () => navigate({ to: workspacePath(workspaceId, "backlinks") });
    const onOpenExperiments = () => navigate({ to: workspacePath(workspaceId, "experiments") });
    const onOpenInspo = (event: CustomEvent<{ section?: string } | null>) => {
      navigate({ to: inspoPath(workspaceId, event.detail?.section) });
      closeNavOnPhone();
    };
    const onOpenCampaigns = (event: CustomEvent<{ campaignId?: string; type?: string } | null>) => {
      navigate({
        to: campaignsPath(workspaceId, {
          c: event.detail?.campaignId,
          v: event.detail?.type ? "new" : null,
          type: event.detail?.type,
        }),
      });
      closeNavOnPhone();
    };
    addAppEventListener("open:inspo", onOpenInspo);
    addAppEventListener("open:campaigns", onOpenCampaigns);
    addAppEventListener("open:autopilot", onOpenAutopilot);
    addAppEventListener("open:backlinks", onOpenBacklinks);
    addAppEventListener("open:experiments", onOpenExperiments);
    return () => {
      removeAppEventListener("open:autopilot", onOpenAutopilot);
      removeAppEventListener("open:backlinks", onOpenBacklinks);
      removeAppEventListener("open:experiments", onOpenExperiments);
      removeAppEventListener("open:inspo", onOpenInspo);
      removeAppEventListener("open:campaigns", onOpenCampaigns);
    };
  }, [navigate, workspaceId, closeNavOnPhone]);

  // Brain (ADR-0032) holds the four brains and the strategy. Older buttons and
  // chat actions still name the place they used to open; each lands on its
  // section here.
  const openBrain = useCallback(
    (section?: BrainSection | null, tab?: string | null) => {
      navigate({ to: brainPath(workspaceId, section, tab) });
      closeNavOnPhone();
    },
    [navigate, workspaceId, closeNavOnPhone],
  );
  useEffect(() => {
    const onBrain = (event: CustomEvent<{ section?: BrainSection; tab?: string } | null>) =>
      openBrain(event.detail?.section, event.detail?.tab);
    const onBrandDna = (event: CustomEvent<{ tab?: string } | null>) => {
      const tab = event.detail?.tab;
      if (tab === "competitors") openBrain("competitors");
      else if (tab === "look" || tab === "assets") navigate({ to: inspoPath(workspaceId, tab) });
      else if (tab === "customers") openBrain("audience", "customers");
      else openBrain("brand", tab);
    };
    const onAudience = () => openBrain("audience");
    const onCompetitors = () => openBrain("competitors");
    addAppEventListener("open:brain", onBrain);
    addAppEventListener("open:brand-dna", onBrandDna);
    addAppEventListener("open:audience", onAudience);
    addAppEventListener("open:competitors", onCompetitors);
    return () => {
      removeAppEventListener("open:brain", onBrain);
      removeAppEventListener("open:brand-dna", onBrandDna);
      removeAppEventListener("open:audience", onAudience);
      removeAppEventListener("open:competitors", onCompetitors);
    };
  }, [openBrain, navigate, workspaceId]);

  useEffect(() => {
    setChatOpen(false);
  }, [path]);

  // The app tour: a new person gets one look around, once per account. It
  // waits for a quiet chat screen and never opens over another window. Anyone
  // can take it again from the account menu (`open:tour`).
  const {
    ready: tourReady,
    seen: tourWasSeen,
    firstName: tourName,
    markSeen: markTourSeen,
  } = useAppTourSeen();
  const [tourOpen, setTourOpen] = useState(false);
  const navOpenRef = useRef(navOpen);
  navOpenRef.current = navOpen;
  const navBeforeTour = useRef(false);
  const tourList = useMemo(
    () => tourStops({ autopilot: Boolean(autopilot?.enabled) }),
    [autopilot?.enabled],
  );
  const startTour = useCallback(() => {
    navBeforeTour.current = navOpenRef.current;
    setTourOpen(true);
  }, []);
  const onChatScreen = path.replace(/\/$/, "") === homeHref || Boolean(activeConversationId);
  useEffect(() => {
    if (!tourReady || tourWasSeen || tourOpen || !onChatScreen) return;
    const timer = window.setInterval(() => {
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      if (!document.querySelector('[data-tour="chat"]')) return;
      markTourSeen();
      startTour();
    }, 900);
    return () => window.clearInterval(timer);
  }, [tourReady, tourWasSeen, tourOpen, onChatScreen, markTourSeen, startTour]);
  useEffect(() => {
    // After the account menu has closed and handed its focus back.
    const onTour = () => window.setTimeout(startTour, 160);
    addAppEventListener("open:tour", onTour);
    return () => removeAppEventListener("open:tour", onTour);
  }, [startTour]);
  const onTourStop = useCallback(
    (stop: TourStop | null) => {
      if (stop?.sidebar) setNavOpen(true);
      // On a phone the sidebar is a drawer that would cover the rest.
      else if (isCompact) setNavOpen(false);
    },
    [isCompact],
  );
  const closeTour = useCallback(
    (action?: TourFinishAction) => {
      setTourOpen(false);
      setNavOpen(isCompact ? false : navBeforeTour.current);
      if (!action) return;
      // Once the tour has gone and given focus back.
      window.setTimeout(() => {
        if (action === "post") {
          emitAppEvent("chat:prefill", { text: TOUR_FIRST_POST_PROMPT, focus: true });
        } else if (action === "brain") openBrain();
        else emitAppEvent("open:settings", { section: "accounts" });
      }, 80);
    },
    [isCompact, openBrain],
  );

  // Mellox 2.0 (ADR-0044): the sidebar is data (src/lib/shell/nav.ts); this
  // only says where each row goes.
  const lockFor = (item: NavItem): PlanId | null =>
    item.feature && billing.data && !billing.data.features[item.feature].allowed
      ? billing.data.features[item.feature].requiredPlan
      : null;
  const pickNav = (item: NavItem, lock: PlanId | null) => {
    closeNavOnPhone();
    if (lock && item.feature) return openFeatureUpgrade(item.feature);
    const t = item.target;
    // Whatever window is open steps aside, and the highlight moves at once.
    if (item.id !== activeId) {
      emitAppEvent("shell:leave");
      setWindowNav(null);
    }
    if (t.kind === "brain") return openBrain();
    // A window opened from a page of its own (Brain, Inspo…) opens over Home,
    // so its Back lands somewhere sensible and nothing is stacked.
    if (
      (t.kind === "analytics" || t.kind === "event") &&
      routeNavId &&
      routeNavId !== "home" &&
      routeNavId !== "chat"
    )
      navigate({ to: homeHref });
    if (t.kind === "analytics") return setAnalyticsOpen(true);
    if (t.kind === "event") return emitAppEvent(t.event);
    const to =
      t.place === "home"
        ? homeHref
        : t.place === "chat"
          ? chatPath(workspaceId)
          : t.place === "inspo"
            ? inspoPath(workspaceId)
            : t.place === "campaigns"
              ? campaignsPath(workspaceId)
              : t.place === "communities"
                ? communitiesPath(workspaceId)
                : workspacePath(workspaceId, "experiments");
    navigate({ to });
    if (t.place === "chat") emitAppEvent("chat:focus");
  };

  const MobileNav = (
    <div className="flex h-full flex-col px-2.5 pb-3">
      {/* Brand row, on its own solid strip so the list never scrolls under
          it; height matches the top bar (h-14). */}
      <div className="relative z-10 flex h-14 shrink-0 items-center justify-between bg-[var(--ds-frame-bg)] px-1">
        <Link
          to={homeHref}
          onClick={closeNavOnPhone}
          aria-label="Mellox AI — workspace home"
          title="Workspace home"
          className="group flex h-9 items-center gap-1.5 rounded-full pl-1 pr-2.5 transition-colors hover:bg-[var(--ds-well-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Logo height={26} markOnly />
          <span
            className="text-[13px] leading-none text-foreground"
            style={{ fontFamily: "var(--font-brand)" }}
          >
            Mellox AI
          </span>
        </Link>
        <button
          type="button"
          onClick={() => setNavOpen(false)}
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-[var(--ds-well-bg)] hover:text-foreground"
        >
          <PanelRightOpen className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {/* Only the list scrolls; Mox and the account stay in view. */}
      <div className="-mx-2.5 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-2.5 pb-3 pt-2 scrollbar-thin">
        <SidebarNav
          activeId={activeId}
          lockFor={lockFor}
          hintFor={(item) => (item.id === "brain" && brainNews ? `${brainNews}` : undefined)}
          showFlag={(flag) => flag === "experiments" && Boolean(proofEngine?.enabled)}
          onPick={pickNav}
        />

        {/* On a phone the drawer is the only way to past chats. */}
        {isCompact && (
          <>
            <div className="h-px bg-border/50" />
            <RecentChats
              workspaceId={workspaceId}
              activeConversationId={activeConversationId}
              onNavigate={closeNavOnPhone}
            />
            <div className="flex flex-wrap items-center gap-2 px-1">
              <Suspense fallback={null}>
                <BrainPulse workspaceId={workspaceId} onOpenBrain={openBrain} />
              </Suspense>
            </div>
          </>
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-1.5 border-t border-[var(--ds-card-border)] pt-2.5">
        <MoxGauge />
        <div data-tour="account">
          <AccountMenu
            onOpenSettings={() => emitAppEvent("open:settings")}
            onClose={closeNavOnPhone}
          />
        </div>
      </div>
    </div>
  );

  return (
    <AppFrame plain>
      <h1 className="sr-only">Mellox AI Workspace</h1>

      {/* Collapsed: the icon rail, in the open sidebar's order. */}
      {!navOpen && (
        <aside
          data-app-sidebar
          aria-label="Sidebar rail"
          className="hidden h-full w-[60px] flex-none flex-col items-center py-3 lg:flex"
        >
          <TooltipProvider delayDuration={200}>
            <div className="group relative mb-4 h-9 w-9">
              <Link
                to={homeHref}
                aria-label="Mellox AI — workspace home"
                title="Workspace home"
                className="flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200 group-hover:scale-90 group-hover:opacity-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Logo height={26} markOnly />
              </Link>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setNavOpen(true)}
                    aria-label="Open sidebar"
                    className="absolute inset-0 grid place-items-center rounded-full bg-[var(--ds-card-bg)] text-foreground opacity-0 shadow-[var(--ds-card-shadow)] transition-all duration-200 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <PanelRightOpen className="h-[18px] w-[18px]" strokeWidth={1.9} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  Open sidebar
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="flex flex-1 flex-col items-center">
              <SidebarNav
                collapsed
                activeId={activeId}
                lockFor={lockFor}
                showFlag={(flag) => flag === "experiments" && Boolean(proofEngine?.enabled)}
                onPick={pickNav}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setNavOpen(true)}
                    aria-label="More"
                    className="mt-1 grid h-10 w-10 place-items-center rounded-full text-foreground/60 transition hover:bg-[var(--ds-well-bg)] hover:text-foreground"
                  >
                    <LayoutGrid className="h-[18px] w-[18px]" strokeWidth={1.9} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  More
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="flex flex-col items-center gap-2 pt-3">
              <MoxGauge compact />
              <AccountMenuCompact onOpenSettings={() => emitAppEvent("open:settings")} />
            </div>
          </TooltipProvider>
        </aside>
      )}

      <AnimatePresence initial={false} mode="sync">
        {navOpen && (
          <>
            {isCompact && (
              <motion.div
                key="app-nav-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => setNavOpen(false)}
                className="ds-scrim fixed inset-0 z-30"
                aria-hidden
              />
            )}
            <motion.aside
              data-app-sidebar
              id="app-inline-nav"
              key="app-inline-nav"
              initial={isCompact ? { x: -sidebarWidth } : { width: 0, opacity: 0 }}
              animate={isCompact ? { x: 0 } : { width: sidebarWidth, opacity: 1 }}
              exit={isCompact ? { x: -sidebarWidth } : { width: 0, opacity: 0 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              style={isCompact ? { width: sidebarWidth } : undefined}
              className={cn(
                "h-full overflow-hidden [will-change:width,transform]",
                isCompact
                  ? "fixed inset-y-0 left-0 z-40 rounded-r-[28px] bg-[var(--ds-frame-bg)] shadow-[var(--ds-pop-shadow)]"
                  : "flex-none",
              )}
            >
              <div style={{ width: sidebarWidth }} className="h-full">
                {MobileNav}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Right column: top bar + the workspace. On a desktop the canvas starts at
          the very top (Holo): the top bar sits on it, not on a white strip. */}
      <div
        data-workspace-column
        className="flex min-w-0 flex-1 flex-col lg:ds-canvas lg:overflow-hidden lg:rounded-tl-[var(--ds-canvas-radius)]"
      >
        <AnnouncementsOutlet />

        <header
          role="banner"
          className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-2 px-3 sm:px-4"
        >
          {/* LEFT — menu (phone) · workspace */}
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              aria-label="Open sidebar"
              aria-controls="app-inline-nav"
              aria-expanded={navOpen}
              className="grid size-11 shrink-0 place-items-center rounded-full text-foreground hover:bg-[var(--ds-well-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:hidden"
            >
              <Menu className="size-5" aria-hidden />
            </button>

            <WorkspaceMenu
              workspaceName={workspaceName}
              workspaceId={workspaceId}
              trigger={
                <motion.button
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  title="Workspace menu"
                  className="group flex min-w-0 items-center gap-2 rounded-full border border-transparent py-1.5 pl-1.5 pr-3 text-[13px] font-semibold tracking-tight text-foreground transition-all hover:border-[var(--ds-card-border)] hover:bg-[var(--ds-card-bg)] hover:shadow-[var(--ds-card-shadow)] data-[state=open]:bg-[var(--ds-card-bg)]"
                >
                  {brandLogo ? (
                    <img
                      src={brandLogo}
                      alt=""
                      className="h-6 w-6 shrink-0 rounded-full bg-background object-contain ring-1 ring-border/60"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--mox-lime)] text-[11px] font-bold uppercase text-[var(--mox-ink)]">
                      {(workspaceName?.[0] ?? "W").toUpperCase()}
                    </span>
                  )}
                  <span className="max-w-[min(34vw,180px)] truncate sm:max-w-[200px]">
                    {workspaceName}
                  </span>
                  <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/80 transition group-hover:text-foreground group-data-[state=open]:rotate-180" />
                </motion.button>
              }
            />
          </div>

          {/* CENTRE — what Mox knows about the brand (Holo's progress line). */}
          <BrandMeter workspaceId={workspaceId} />

          {/* RIGHT — status and actions */}
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="flex min-w-0 shrink items-center gap-1 sm:gap-1.5"
          >
            {/* Mounted, not displayed: the Schedule dialog lives in here and
              its open:schedule listener has to stay attached. `hidden` keeps
              React mounted and the listeners live, and takes the triggers out
              of the tab order. */}
            <div hidden>
              <TopBarActions workspaceId={workspaceId} />
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {/* While Autopilot runs (or is paused) it shows here on every screen. */}
              {autopilot?.enabled &&
                (autopilot.status === "running" || autopilot.status === "paused") && (
                  <AutopilotBeacon
                    state={autopilot.status === "running" ? "on" : "paused"}
                    waiting={autopilot.waiting}
                    onClick={() =>
                      navigate({
                        to: autopilotPath(workspaceId, autopilot.waiting ? "approvals" : "home"),
                      })
                    }
                  />
                )}
              {/* Holo's corner: the plan only. The balance is Mox's gauge. */}
              <PlanChip className="hidden lg:inline-flex" />
              <StudioButton />

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label="Share"
                    title="Share"
                    data-tour="share"
                    className="group relative inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full bg-foreground px-3 text-[12.5px] font-semibold tracking-tight text-background shadow-sm transition hover:-translate-y-px hover:bg-foreground/90 active:scale-[0.97] sm:h-8 sm:min-w-8 sm:px-3.5"
                  >
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full"
                    />
                    <Share2 className="relative h-3.5 w-3.5" strokeWidth={2.4} aria-hidden />
                    <span className="relative hidden sm:inline">Share</span>
                    <ChevronDown
                      className="relative h-3 w-3 opacity-80 transition group-data-[state=open]:rotate-180"
                      aria-hidden
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={8} className="w-52 p-1.5">
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      emitAppEvent("open:share");
                    }}
                    className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2"
                  >
                    <Share2 className="h-4 w-4 text-primary" />
                    <span className="text-[13px] font-medium">Invite teammates</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      emitAppEvent("open:client-portal");
                    }}
                    className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2"
                  >
                    <Users className="h-4 w-4 text-primary" />
                    <span className="text-[13px] font-medium">Client portal</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      emitAppEvent("open:publish");
                    }}
                    className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2"
                  >
                    <Rocket className="h-4 w-4 text-foreground/80" />
                    <span className="text-[13px] font-medium">Publish</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Mounted (hidden) so events open the underlying dialogs */}
              <Suspense fallback={null}>
                <PublishDialog workspaceId={workspaceId}>
                  <span data-publish-trigger className="hidden" aria-hidden />
                </PublishDialog>
                <ShareDialog key={workspaceId ?? "no-workspace"} workspaceId={workspaceId}>
                  <span data-share-trigger className="hidden" aria-hidden />
                </ShareDialog>
                <ClientPortalDialog workspaceId={workspaceId} />
                <AiVisibilityDialog workspaceId={workspaceId} />
                <UgcStudioDialog workspaceId={workspaceId} />
                <CreateLauncher />
              </Suspense>
              <BillingPanel />
            </div>
          </motion.div>
        </header>

        {/* The workspace: Holo's canvas, to the right of the sidebar */}
        <AppCanvas className="lg:rounded-none lg:bg-transparent lg:bg-none lg:shadow-none">
          <main data-workspace-main="true" className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <WorkspaceSurface
              workspaceId={workspaceId}
              activeConversationId={activeConversationId}
              chatView={chatView}
            />
          </main>
        </AppCanvas>
        <nav
          aria-label="Mobile workspace navigation"
          className="flex shrink-0 items-center justify-around border-t border-border/50 bg-[var(--ds-frame-bg)] px-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] md:hidden"
        >
          <Link
            to={homeHref}
            aria-label="Home"
            aria-current={activeId === "home" ? "page" : undefined}
            className={cn(
              "flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              activeId === "home" ? "text-foreground" : "text-foreground/60",
            )}
          >
            <Home className="size-5" aria-hidden />
            <span className="text-[10px] font-semibold">Home</span>
          </Link>
          <Link
            to={chatPath(workspaceId)}
            aria-label="Chat"
            aria-current={activeId === "chat" ? "page" : undefined}
            className={cn(
              "flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              activeId === "chat" ? "text-foreground" : "text-foreground/60",
            )}
          >
            <MessageCircle className="size-5" aria-hidden />
            <span className="text-[10px] font-semibold">Chat</span>
          </Link>
          <button
            type="button"
            onClick={() => emitAppEvent("open:create-launcher")}
            className="flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Create content"
          >
            <span className="ds-grad-pill grid h-8 w-11 place-items-center rounded-full">
              <Plus className="size-5" aria-hidden />
            </span>
          </button>
          <button
            type="button"
            onClick={() => openBrain()}
            className="flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Open Brain"
          >
            <BrainIcon className="size-5" />
            <span className="text-[10px] font-semibold">Brain</span>
          </button>
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            className="flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Open menu"
          >
            <Menu className="size-5" aria-hidden />
            <span className="text-[10px] font-semibold">Menu</span>
          </button>
        </nav>
      </div>

      <CommandBar />
      <StudioActivityWatcher />
      <Suspense fallback={<OpeningPill />}>
        {analyticsOpen && (
          <AnalyticsModal
            open={analyticsOpen}
            onOpenChange={(v) => {
              setAnalyticsOpen(v);
              // On close, strip ?tab so refresh does not reopen the modal.
              if (!v && typeof window !== "undefined") {
                const url = new URL(window.location.href);
                if (url.searchParams.has("tab")) {
                  url.searchParams.delete("tab");
                  const q = url.searchParams.toString();
                  window.history.replaceState({}, "", url.pathname + (q ? "?" + q : ""));
                }
              }
            }}
            workspaceName={workspaceName}
          />
        )}

        {studioInUse && <StudioComposer />}
        <ContentItemDialog />
        <LibraryDialog />
        <WorkspaceDialogs
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          onRenamed={(name) => patchWorkspace({ name })}
        />
        <ContentCalendar workspaceId={workspaceId} />
      </Suspense>
      <StartHereModal workspaceId={workspaceId} />
      <EntryBloom />
      {tourOpen && (
        <Suspense fallback={null}>
          <AppTour stops={tourList} name={tourName} onStop={onTourStop} onClose={closeTour} />
        </Suspense>
      )}
    </AppFrame>
  );
}

function WorkspaceSurface({
  workspaceId,
  activeConversationId,
  chatView,
}: {
  workspaceId: string;
  activeConversationId: string | null;
  chatView: boolean;
}) {
  const isCompact = useIsCompact();
  const [studioOpen, setStudioOpen] = useState(false);
  // Mellox 2.0: Home is the cards, so Studio starts closed and opens only for
  // someone who left it open last time. On a phone it is a drawer.
  const studioHydrated = useRef(false);
  useEffect(() => {
    try {
      if (window.innerWidth >= 1024 && window.localStorage.getItem("mellox:studioOpen") === "1")
        setStudioOpen(true);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    // Skip the first pass, before the stored choice has been applied.
    if (!studioHydrated.current) {
      studioHydrated.current = true;
      return;
    }
    try {
      if (!isCompact) window.localStorage.setItem("mellox:studioOpen", studioOpen ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [studioOpen, isCompact]);
  useEffect(() => {
    if (isCompact) setStudioOpen(false);
  }, [isCompact]);
  // The Studio button shows progress only while the panel is closed.
  useEffect(() => {
    setStudioRailOpen(studioOpen);
  }, [studioOpen]);
  useEffect(() => {
    if (!isCompact || !studioOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setStudioOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isCompact, studioOpen]);
  useEffect(() => {
    const open = () => setStudioOpen(true);
    const toggle = () => setStudioOpen((v) => !v);
    addAppEventListener("open:studio", open);
    addAppEventListener("toggle:studio", toggle);
    return () => {
      removeAppEventListener("open:studio", open);
      removeAppEventListener("toggle:studio", toggle);
    };
  }, []);

  // Responsive studio width — scales with viewport on phones/tablets.
  const [vw, setVw] = useState<number>(1024);
  useEffect(() => {
    const on = () => setVw(window.innerWidth);
    on();
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("orientationchange", on);
    };
  }, []);
  const studioWidth = isCompact ? Math.min(380, Math.round(vw * 0.92)) : 320;

  // Swipe gestures on mobile: left-swipe from right edge opens studio; right-swipe closes it.
  useSwipe({
    enabled: isCompact,
    edgeStartRightPx: studioOpen ? undefined : 24,
    onSwipeLeft: () => {
      if (!studioOpen) setStudioOpen(true);
    },
    onSwipeRight: () => {
      if (studioOpen) setStudioOpen(false);
    },
  });

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-row">
      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Keyed by workspace: nothing (messages, pending replies, context)
            survives into another workspace. */}
        <ChatPanel
          key={workspaceId}
          workspaceId={workspaceId}
          conversationId={activeConversationId}
          variant="centered"
          chatView={chatView}
        />
        {/* Holo's "Generating…" card, while the Studio panel is shut. */}
        {!studioOpen && (
          // Generate closes Studio, so this list must show on a phone too.
          <GeneratingPanel
            className={
              isCompact ? "fixed inset-x-3 bottom-24 z-40 w-auto" : "absolute right-4 top-4 z-20"
            }
          />
        )}
      </section>

      {/* Chat (Holo): past conversations on the right. On a phone they stay
          in the menu drawer. */}
      {!isCompact && !studioOpen && (chatView || activeConversationId) && (
        <aside
          aria-label="Chats"
          className="ds-enter hidden w-[248px] flex-none flex-col overflow-y-auto border-l border-border/40 px-2.5 py-3 xl:flex"
        >
          <RecentChats workspaceId={workspaceId} activeConversationId={activeConversationId} />
        </aside>
      )}

      {/* Studio — inline on desktop, overlay drawer on mobile. */}
      <AnimatePresence initial={false} mode="sync">
        {studioOpen && (
          <>
            {isCompact && (
              <motion.div
                key="studio-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => setStudioOpen(false)}
                className="fixed inset-0 z-30 bg-background/60 backdrop-blur-sm"
                aria-hidden
              />
            )}
            <motion.aside
              key="studio-inline"
              initial={isCompact ? { x: studioWidth } : { width: 0, opacity: 0 }}
              animate={isCompact ? { x: 0 } : { width: studioWidth, opacity: 1 }}
              exit={isCompact ? { x: studioWidth } : { width: 0, opacity: 0 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              style={isCompact ? { width: studioWidth } : undefined}
              className={cn(
                "h-full overflow-hidden border-l border-border/60 bg-sidebar [will-change:width,transform]",
                isCompact ? "fixed inset-y-0 right-0 z-40 shadow-2xl" : "flex-none",
              )}
            >
              <div style={{ width: studioWidth }} className="flex h-full min-h-0 flex-col">
                {isCompact && (
                  <div className="flex h-14 shrink-0 items-center justify-between border-b border-border/60 px-4">
                    <span className="text-sm font-semibold">Studio</span>
                    <button
                      type="button"
                      onClick={() => setStudioOpen(false)}
                      aria-label="Close Studio"
                      className="grid size-11 place-items-center rounded-xl hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <ArrowLeft className="size-5" aria-hidden />
                    </button>
                  </div>
                )}
                <div className="min-h-0 flex-1">
                  <StudioRail embedded />
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export default AppShell;
