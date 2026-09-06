"use client";

import { Link, useRouterState, useNavigate } from "@/lib/navigation";
import { useServerFn } from "@/lib/use-server-fn";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { acceptWorkspaceInvite } from "@/lib/workspaces.functions";
import { Button } from "@/components/ui/button";
import {
  BarChart3,
  Calendar as CalendarIcon,
  Settings,
  Rocket,
  ChevronDown,
  Sun,
  Moon,
  Menu,
  X,
  MessageSquare,
  Share2,
  PanelRightClose,
  PanelRightOpen,
  type LucideIcon,
} from "@/components/brand/icons";
import {
  MoreHorizontal,
  Brain,
  Bot,
  ArrowLeft,
  Users,
  Sparkles,
  Radio,
} from "@/components/ui/gemini-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChatPanel } from "@/components/app/ChatPanel";
import { CommandBar } from "@/components/app/CommandBar";
import { TopBarActions } from "@/components/app/TopBarActions";
import { StudioRail } from "@/components/app/StudioRail";
import { RecentChats } from "@/components/app/RecentChats";
import { StudioBottomDock } from "@/components/app/StudioBottomDock";
import { WorkspaceSwitcher } from "@/components/app/WorkspaceSwitcher";
import { Wand2 } from "@/components/ui/gemini-icons";
import { AccountMenu, AccountMenuCompact } from "@/components/app/AccountMenu";
import melloxLogo from "@/assets/mellox-logo.svg.asset.json";

// Heavy modules — loaded on demand to shrink the initial workspace bundle.
const AnalyticsModal = lazy(() =>
  import("@/components/app/AnalyticsModal").then((m) => ({ default: m.AnalyticsModal })),
);
const StudioCanvasModal = lazy(() =>
  import("@/components/app/StudioCanvasModal").then((m) => ({ default: m.StudioCanvasModal })),
);
const ContentCalendar = lazy(() =>
  import("@/components/app/ContentCalendar").then((m) => ({ default: m.ContentCalendar })),
);
const WorkspaceDialogs = lazy(() =>
  import("@/components/app/WorkspaceDialogs").then((m) => ({ default: m.WorkspaceDialogs })),
);
const GeoAeoPanel = lazy(() =>
  import("@/components/app/GeoAeoPanel").then((m) => ({ default: m.GeoAeoPanel })),
);
const PublishDialog = lazy(() =>
  import("@/components/app/PublishDialog").then((m) => ({ default: m.PublishDialog })),
);
const ShareDialog = lazy(() =>
  import("@/components/app/ShareDialog").then((m) => ({ default: m.ShareDialog })),
);
const ClientPortalButton = lazy(() =>
  import("@/components/app/ClientPortalDialog").then((m) => ({ default: m.ClientPortalButton })),
);
const AiVisibilityDialog = lazy(() =>
  import("@/components/app/AiVisibilityDialog").then((m) => ({ default: m.AiVisibilityDialog })),
);
const CompetitorWatchButton = lazy(() =>
  import("@/components/app/CompetitorWatchButton").then((m) => ({
    default: m.CompetitorWatchButton,
  })),
);
const MarketingCoachPanel = lazy(() =>
  import("@/components/app/MarketingCoachPanel").then((m) => ({ default: m.MarketingCoachPanel })),
);

import { useStudioCanvas } from "@/hooks/use-studio";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useTheme } from "@/hooks/use-theme";
import { useIsMobile, useIsCompact } from "@/hooks/use-mobile";
import { Logo } from "@/components/brand/Logo";
import { WorkspaceMenu } from "@/components/app/WorkspaceMenu";
import { useBrandDna } from "@/hooks/use-brand-dna";
import { useRealtimeContent } from "@/hooks/use-realtime-content";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { useSwipe } from "@/hooks/use-swipe";

// Preserve deep-link query params (?tab, ?canvas, ?artifact, ?invite_token, ?next)
// through the router. Without validateSearch, TanStack Router drops unknown
// params on match, which would break the Analytics/Studio URL persistence.
type AppSearch = {
  tab?: string;
  canvas?: string;
  artifact?: string;
  invite_token?: string;
  next?: string;
};

function ChevronRightSep() {
  return (
    <svg
      className="h-3 w-3 shrink-0 text-border"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

type ModuleDef = {
  to: "/app";
  label: string;
  icon: LucideIcon;
  slug: string;
  exact?: boolean;
};

const modules: ModuleDef[] = [
  { to: "/app", label: "Chat", icon: MessageSquare, slug: "home", exact: true },
];

const GROWTH_PATHS: string[] = [];

function AppShell() {
  const navigate = useNavigate();
  const acceptWorkspaceInviteFn = useServerFn(acceptWorkspaceInvite);
  // Start null on SSR to avoid hydration mismatch; hydrate from localStorage
  // immediately on mount so ChatPanel renders without waiting on the network.
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState<string>("Workspace");
  const [workspaceWebsite, setWorkspaceWebsite] = useState<string | null>(null);
  useEffect(() => {
    try {
      const id = localStorage.getItem("workspace:selected");
      const name = localStorage.getItem("workspace:name");
      const site = localStorage.getItem("workspace:website");
      if (id) setWorkspaceId(id);
      if (name) setWorkspaceName(name);
      if (site) setWorkspaceWebsite(site);
    } catch {}
  }, []);

  const { theme, toggle } = useTheme();
  const { dna: brandDna } = useBrandDna(workspaceId);
  const brandLogo = brandDna.logoUrl || brandDna.faviconUrl;
  const brandContextForCoach = useMemo(() => {
    const parts: string[] = [];
    if (brandDna.brandName) parts.push(`Brand: ${brandDna.brandName}`);
    if (brandDna.oneLiner) parts.push(`One-liner: ${brandDna.oneLiner}`);
    if (brandDna.about) parts.push(`About: ${brandDna.about}`);
    if (brandDna.industry) parts.push(`Industry: ${brandDna.industry}`);
    if (brandDna.audience) parts.push(`Audience: ${brandDna.audience}`);
    if (brandDna.voice) parts.push(`Voice: ${brandDna.voice}`);
    if (brandDna.products) parts.push(`Products: ${brandDna.products}`);
    if (brandDna.positioning) parts.push(`Positioning: ${brandDna.positioning}`);
    if (brandDna.uniqueValueProp) parts.push(`UVP: ${brandDna.uniqueValueProp}`);
    if (brandDna.competitors?.length) {
      parts.push(
        `Known competitors: ${brandDna.competitors
          .map((c) => c.name)
          .filter(Boolean)
          .slice(0, 6)
          .join(", ")}`,
      );
    }
    if (brandDna.keywords?.length)
      parts.push(`Keywords: ${brandDna.keywords.slice(0, 10).join(", ")}`);
    return parts.join("\n").slice(0, 6000);
  }, [brandDna]);
  // Subscribe to realtime updates for content_items + approvals so Studio and
  // analytics refresh instantly when chat/agents create or modify rows.
  useRealtimeContent(workspaceId);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const isMobile = useIsMobile();
  const isCompact = useIsCompact();
  const [navOpen, setNavOpen] = useState(false);
  const navTriggerRef = useRef<HTMLButtonElement | null>(null);
  // Sidebar is always inline — reserves its own space at every screen size.
  const isInlineNav = true;
  // Narrower on phones so chat still breathes; wider on desktop.
  // Viewport-aware sidebar width: caps at 86vw on phones so chat still peeks
  // through the backdrop; grows to 240 on desktop.
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
  const sidebarWidth = isMobile ? Math.min(280, Math.round(vw * 0.86)) : 240;

  // Swipe gestures on mobile: right-swipe from left edge opens nav; left-swipe closes it.
  useSwipe({
    enabled: isMobile,
    edgeStartLeftPx: navOpen ? undefined : 24,
    onSwipeRight: () => {
      if (!navOpen) setNavOpen(true);
    },
    onSwipeLeft: () => {
      if (navOpen) setNavOpen(false);
    },
  });

  // Hydrate persisted sidebar state after mount (avoids SSR hydration mismatch).
  useEffect(() => {
    try {
      const v = localStorage.getItem("app:navOpen");
      if (v === "1") setNavOpen(true);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("app:navOpen", navOpen ? "1" : "0");
    } catch {}
  }, [navOpen]);
  const [, setChatOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const { canvas: studioCanvas, close: closeStudio } = useStudioCanvas();
  const [chatWidth, setChatWidth] = useState<number>(360);
  const [chatCollapsed, setChatCollapsed] = useState<boolean>(false);
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem("chat:width"));
      if (saved && saved >= 300 && saved <= 720) setChatWidth(saved);
      const c = localStorage.getItem("chat:collapsed");
      if (c === "1") setChatCollapsed(true);
    } catch {}
  }, []);
  const toggleChat = () => {
    setChatCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem("chat:collapsed", next ? "1" : "0");
      } catch {}
      return next;
    });
  };
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const next = Math.min(720, Math.max(300, e.clientX));
      setChatWidth(next);
    };
    const onUp = () => {
      setDragging(false);
      localStorage.setItem("chat:width", String(chatWidth));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging, chatWidth]);

  // Open Analytics modal via custom event, ⌘./Ctrl+. keybind, or sessionStorage flag set by /app/analytics redirect.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const VALID_TABS = new Set([
      "overview",
      "organic",
      "social",
      "content",
      "audience",
      "automations",
    ]);
    const isValidTab = (t: unknown): t is string => typeof t === "string" && VALID_TABS.has(t);

    const openWith = (tab?: string) => {
      // Silently drop unknown tab values so a malformed deep-link doesn't
      // pollute the URL with garbage. The modal still opens on the default tab.
      const clean = isValidTab(tab) ? tab : undefined;
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
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        toggleChat();
      }
    };
    window.addEventListener("open:analytics", onOpen as EventListener);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("open:analytics", onOpen as EventListener);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const currentAppPath = () => {
      if (typeof window === "undefined") return "/app";
      const { pathname, search } = window.location;
      return pathname.startsWith("/app") ? `${pathname}${search || ""}` : "/app";
    };
    const load = async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        // Preserve invite token across login redirect
        if (typeof window !== "undefined") {
          const t = new URL(window.location.href).searchParams.get("invite_token");
          if (t) localStorage.setItem("pending:invite_token", t);
        }
        // Preserve the target so the user lands back here after signing in.
        navigate({ to: "/login", search: { next: currentAppPath() } as any });
        return;
      }

      // Handle ?invite_token=... — accept invite and select that workspace
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        const pending = localStorage.getItem("pending:invite_token");
        const token = url.searchParams.get("invite_token") || pending;
        if (pending) localStorage.removeItem("pending:invite_token");

        if (token) {
          try {
            const wsId = await acceptWorkspaceInviteFn({ data: { token } });
            if (wsId) localStorage.setItem("workspace:selected", wsId as string);
          } catch (e: any) {
            // Surface but don't block — user might already be a member
            console.warn("invite accept failed", e?.message);
          } finally {
            url.searchParams.delete("invite_token");
            window.history.replaceState({}, "", url.pathname + (url.search ? url.search : ""));
          }
        }
      }

      const selectedId =
        typeof window !== "undefined" ? localStorage.getItem("workspace:selected") : null;
      const query = supabase
        .from("workspaces")
        .select("id, name, website_url, industry, onboarded_at");
      const { data } = selectedId
        ? await query.eq("id", selectedId).maybeSingle()
        : await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (cancelled) return;
      if (data?.id) {
        localStorage.setItem("workspace:selected", data.id);
        setWorkspaceId(data.id);
        const domain = data.website_url
          ? data.website_url
              .replace(/^https?:\/\//i, "")
              .replace(/\/$/, "")
              .split("/")[0]
          : null;
        const name = domain || data.name || data.industry || "Workspace";
        setWorkspaceName(name);
        setWorkspaceWebsite(data.website_url ?? null);
        try {
          localStorage.setItem("workspace:name", name);
          if (data.website_url) localStorage.setItem("workspace:website", data.website_url);
          else localStorage.removeItem("workspace:website");
        } catch {}
      } else {
        // No workspace (or stale selection) — keep the app usable without setup.
        localStorage.removeItem("workspace:selected");
        setWorkspaceId(null);
        setWorkspaceName("Workspace");
        setWorkspaceWebsite(null);
      }
    };
    load();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) navigate({ to: "/login", search: { next: currentAppPath() } as any });
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [acceptWorkspaceInviteFn, navigate]);

  useEffect(() => {
    setChatOpen(false);
  }, [path]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URL(window.location.href).searchParams.get("calendar") !== "1") return;
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("open:content-calendar"));
      const url = new URL(window.location.href);
      url.searchParams.delete("calendar");
      window.history.replaceState({}, "", url.pathname + (url.search ? url.search : ""));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Active state for the top tabs
  const isActive = (m: ModuleDef) => {
    if (m.slug === "growth") return GROWTH_PATHS.some((p) => path.startsWith(p));
    if (m.exact) return path === m.to;
    return path === m.to || path.startsWith(m.to + "/");
  };

  const TopTabs = (
    <nav className="relative flex items-center gap-0.5 rounded-full border border-border/70 bg-background/60 p-1 shadow-[0_1px_2px_rgba(0,0,0,0.04),inset_0_1px_0_hsl(0_0%_100%/0.6)] backdrop-blur">
      {modules.map((m) => {
        const active = isActive(m);
        const Icon = m.icon;
        return (
          <Link
            key={m.to}
            to={m.to}
            className={cn(
              "relative z-10 flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId="top-tab-active"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
                className="absolute inset-0 -z-10 rounded-full bg-card ring-1 ring-border/80 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_4px_14px_-6px_hsl(var(--brand-blue)/0.35)]"
              />
            )}
            <Icon
              className={cn(
                "h-3.5 w-3.5 transition-colors",
                active && "text-[hsl(var(--brand-blue))]",
              )}
              strokeWidth={2.2}
            />
            <span>{m.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  const sidebarAction = (opts: {
    icon: LucideIcon;
    label: string;
    hint?: string;
    onClick: () => void;
    accent?: string;
  }) => {
    const Icon = opts.icon;
    return (
      <button
        key={opts.label}
        onClick={() => {
          opts.onClick();
          setNavOpen(false);
        }}
        className="group relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-[13.5px] font-medium text-foreground/75 transition-all duration-150 hover:bg-secondary/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-secondary/40 text-muted-foreground transition-colors group-hover:bg-secondary group-hover:text-foreground"
          style={opts.accent ? { color: opts.accent } : undefined}
        >
          <Icon className="h-4 w-4" strokeWidth={1.9} aria-hidden />
        </span>
        <span className="flex-1 truncate leading-none">{opts.label}</span>
        {opts.hint && (
          <span className="rounded-md bg-secondary/60 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground/80">
            {opts.hint}
          </span>
        )}
      </button>
    );
  };

  const SidebarSection = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="space-y-0.5">
      <div className="mb-1 px-3 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/60">
        {label}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );

  const MobileNav = (
    <div className="flex h-full flex-col overflow-y-auto pb-2">
      {/* Brand row — sticky; height matches main header (h-14) for aligned baseline */}
      <div className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between bg-sidebar/95 px-2 backdrop-blur-xl">
        <Link
          to="/workspaces"
          aria-label="Back to all workspaces"
          title="Back to all workspaces"
          className="group flex h-9 items-center gap-1 rounded-md pl-1 pr-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <img
            src={melloxLogo.url}
            alt=""
            className="h-[28px] w-[28px] shrink-0 select-none"
            draggable={false}
          />
          <span
            className="text-sm leading-none text-foreground"
            style={{ fontFamily: "var(--font-brand)" }}
          >
            Mellox AI
          </span>
          <ArrowLeft
            aria-hidden
            className="h-3.5 w-3.5 opacity-0 -translate-x-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0 group-focus-visible:opacity-100 group-focus-visible:translate-x-0"
          />
        </Link>
        <button
          type="button"
          onClick={() => setNavOpen(false)}
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        >
          <PanelRightOpen className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="flex flex-col gap-3 px-2 pt-1">
        {/* Workspace switcher */}
        <WorkspaceSwitcher
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          workspaceWebsite={workspaceWebsite}
          onSwitch={() => setNavOpen(false)}
        />

        <div className="h-px bg-border/50" />

        {/* Recent chats */}
        <SidebarSection label="Recent">
          <RecentChats onNavigate={() => setNavOpen(false)} />
        </SidebarSection>

        <div className="h-px bg-border/50" />

        {/* Workspace actions */}
        <SidebarSection label="Workspace">
          {sidebarAction({
            icon: BarChart3,
            label: "Analytics",
            hint: "⌘.",
            accent: "hsl(var(--brand-green))",
            onClick: () => setAnalyticsOpen(true),
          })}
          {sidebarAction({
            icon: CalendarIcon,
            label: "Content calendar",
            accent: "hsl(var(--brand-blue))",
            onClick: () => window.dispatchEvent(new CustomEvent("open:content-calendar")),
          })}
        </SidebarSection>

        <div className="h-px bg-border/50" />

        {/* Intelligence */}
        <SidebarSection label="Intelligence">
          {sidebarAction({
            icon: Sparkles,
            label: "AI Visibility",
            hint: "GEO · AEO",
            accent: "hsl(var(--brand-blue))",
            onClick: () => {
              window.dispatchEvent(new CustomEvent("open:ai-visibility"));
              setNavOpen(false);
            },
          })}
          {sidebarAction({
            icon: Brain,
            label: "Brand DNA",
            accent: "hsl(var(--brand-blue))",
            onClick: () => window.dispatchEvent(new CustomEvent("open:brand-dna")),
          })}
          {sidebarAction({
            icon: CalendarIcon,
            label: "Schedule",
            onClick: () => window.dispatchEvent(new CustomEvent("open:schedule")),
          })}
          {sidebarAction({
            icon: Bot,
            label: "Automations",
            accent: "rgb(16 185 129)",
            onClick: () => window.dispatchEvent(new CustomEvent("open:autopilot")),
          })}
          {sidebarAction({
            icon: Radio,
            label: "Competitors",
            hint: "Alerts",
            accent: "hsl(var(--brand-green))",
            onClick: () => {
              window.dispatchEvent(new CustomEvent("open:competitor-watch"));
              setNavOpen(false);
            },
          })}
        </SidebarSection>

        <div className="h-px bg-border/50" />

        {/* Collaborate */}
        <SidebarSection label="Collaborate">
          {sidebarAction({
            icon: Rocket,
            label: "Client Portal",
            onClick: () => window.dispatchEvent(new CustomEvent("open:client-portal")),
          })}
          {sidebarAction({
            icon: Share2,
            label: "Share",
            accent: "hsl(var(--brand-green))",
            onClick: () => window.dispatchEvent(new CustomEvent("open:share")),
          })}
        </SidebarSection>

        <div className="mt-2 border-t border-border/50 pt-2">
          <AccountMenu
            onOpenSettings={() => window.dispatchEvent(new CustomEvent("open:settings"))}
            onClose={() => setNavOpen(false)}
          />
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-[100dvh] w-full bg-sidebar text-foreground">
      <h1 className="sr-only">Mellox AI Workspace</h1>

      {/* Full-height left rail: sidebar OR collapsed icon rail. Sits alongside header + main, Qwen/ChatGPT style. */}
      {!navOpen && (
        <aside
          aria-label="Sidebar rail"
          className="flex h-full w-[48px] flex-none flex-col items-center border-r border-border/60 bg-sidebar py-3"
        >
          {/* Brand mark — always visible; links back to workspaces */}
          <Link
            to="/workspaces"
            aria-label="Mellox AI — back to workspaces"
            title="Back to all workspaces"
            className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <img
              src={melloxLogo.url}
              alt="Mellox AI"
              className="h-[26px] w-[26px] select-none"
              draggable={false}
            />
          </Link>

          {/* Divider between brand and actions */}
          <div aria-hidden className="mb-2 h-px w-6 bg-border/60" />

          <TooltipProvider delayDuration={200}>
            <div className="flex flex-1 flex-col items-center gap-1.5">
              {/* Open sidebar — visually distinct primary action */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setNavOpen(true)}
                    aria-label="Open sidebar"
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary/70 text-foreground shadow-sm ring-1 ring-border/60 transition-all hover:bg-secondary hover:text-[hsl(var(--brand-blue))] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <PanelRightClose className="h-[18px] w-[18px]" strokeWidth={1.9} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  Open sidebar
                </TooltipContent>
              </Tooltip>

              {/* Divider between primary and quick actions */}
              <div aria-hidden className="my-1 h-px w-6 bg-border/50" />

              {[
                {
                  icon: Sparkles,
                  label: "AI Visibility",
                  onClick: () => window.dispatchEvent(new CustomEvent("open:ai-visibility")),
                },
                {
                  icon: BarChart3,
                  label: "Analytics",
                  onClick: () => window.dispatchEvent(new CustomEvent("open:analytics")),
                },
                {
                  icon: CalendarIcon,
                  label: "Calendar",
                  onClick: () => window.dispatchEvent(new CustomEvent("open:content-calendar")),
                },
                {
                  icon: Brain,
                  label: "Brand DNA",
                  onClick: () => window.dispatchEvent(new CustomEvent("open:brand-dna")),
                },
                {
                  icon: Radio,
                  label: "Competitors",
                  onClick: () => window.dispatchEvent(new CustomEvent("open:competitor-watch")),
                },
              ].map(({ icon: Icon, label, onClick }) => (
                <Tooltip key={label}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={onClick}
                      aria-label={label}
                      className="group flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-all hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <Icon
                        className="h-[18px] w-[18px] transition-transform group-hover:scale-[1.08]"
                        strokeWidth={1.8}
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    {label}
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>

            {/* Account avatar pinned to bottom (ChatGPT-style) */}
            <div className="mt-2 border-t border-border/60 pt-3">
              <AccountMenuCompact
                onOpenSettings={() => window.dispatchEvent(new CustomEvent("open:settings"))}
              />
            </div>
          </TooltipProvider>
        </aside>
      )}

      <AnimatePresence initial={false} mode="sync">
        {navOpen && isInlineNav && (
          <>
            {isMobile && (
              <motion.div
                key="app-nav-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => setNavOpen(false)}
                className="fixed inset-0 z-30 bg-background/60 backdrop-blur-sm"
                aria-hidden
              />
            )}
            <motion.aside
              id="app-inline-nav"
              key="app-inline-nav"
              initial={isMobile ? { x: -sidebarWidth } : { width: 0, opacity: 0 }}
              animate={isMobile ? { x: 0 } : { width: sidebarWidth, opacity: 1 }}
              exit={isMobile ? { x: -sidebarWidth } : { width: 0, opacity: 0 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              style={isMobile ? { width: sidebarWidth } : undefined}
              className={cn(
                "h-full overflow-hidden border-r border-border/60 bg-sidebar [will-change:width,transform]",
                isMobile ? "fixed inset-y-0 left-0 z-40 shadow-2xl" : "flex-none",
              )}
            >
              <div style={{ width: sidebarWidth }} className="h-full">
                {MobileNav}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Right column: header + workspace — one continuous surface (ChatGPT style) */}
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        {/* Top bar — seamless: no border, same bg as chat, sticky at top */}
        <header
          role="banner"
          className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-3 bg-background px-3 sm:px-4"
        >
          {/* LEFT — logo · breadcrumb */}
          <div className="flex min-w-0 items-center gap-2">
            {/* Logo lives in the full-height sidebar / icon rail (Qwen/ChatGPT layout). No duplicate here. */}

            {/* Workspace breadcrumb — opens workspace menu */}
            <WorkspaceMenu
              workspaceName={workspaceName}
              workspaceId={workspaceId}
              trigger={
                <motion.button
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  title="Workspace menu"
                  className="group flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] font-medium tracking-tight text-foreground/90 transition-colors hover:bg-secondary/80 hover:text-foreground data-[state=open]:bg-secondary data-[state=open]:text-foreground"
                >
                  {brandLogo ? (
                    <img
                      src={brandLogo}
                      alt=""
                      className="h-4 w-4 shrink-0 rounded-[4px] object-contain bg-background ring-1 ring-border/60"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <span className="grid h-4 w-4 place-items-center rounded-[4px] bg-primary text-[9px] font-bold uppercase text-primary-foreground shadow-sm">
                      {(workspaceName?.[0] ?? "W").toUpperCase()}
                    </span>
                  )}
                  <span className="truncate max-w-[180px]">{workspaceName}</span>
                  <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/80 transition group-hover:text-foreground group-data-[state=open]:rotate-180" />
                </motion.button>
              }
            />

            {modules.length > 1 && <span className="hidden md:block ml-1.5">{TopTabs}</span>}
          </div>

          {/* RIGHT — status cluster + actions */}
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="flex min-w-0 shrink items-center gap-1 sm:gap-1.5"
          >
            {/* Desktop-only (xl+) — full action row stays untouched */}
            <div className="hidden items-center gap-1.5">
              {/* xl action row disabled — unified layout */}
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => setAnalyticsOpen(true)}
                title="Analytics  ·  ⌘ ."
                aria-label="Open analytics"
                className="group inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium text-muted-foreground transition-all hover:bg-secondary hover:text-foreground active:scale-95"
              >
                <BarChart3
                  className="h-3.5 w-3.5 transition-colors group-hover:text-[hsl(var(--brand-green))]"
                  strokeWidth={2}
                />
                <span>Analytics</span>
              </motion.button>

              <span className="mx-0.5 h-4 w-px bg-border/70" />

              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent("open:content-calendar"))}
                aria-label="Open calendar"
                title="Calendar"
                className="group flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium text-muted-foreground transition-all hover:bg-secondary hover:text-foreground active:scale-95"
              >
                <CalendarIcon className="h-3.5 w-3.5 transition-colors group-hover:text-[hsl(var(--brand-blue))]" />
                <span>Calendar</span>
              </button>

              <Suspense fallback={null}>
                <ClientPortalButton workspaceId={workspaceId} />
              </Suspense>

              <button
                onClick={() => window.dispatchEvent(new CustomEvent("open:share"))}
                aria-label="Share workspace"
                title="Share with workspace members"
                className="group flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-all hover:bg-secondary hover:text-foreground active:scale-95"
              >
                <Share2 className="h-3.5 w-3.5 transition-colors group-hover:text-[hsl(var(--brand-green))]" />
              </button>
            </div>

            {/* Mount Schedule + 24/7 Autopilot dialogs off-screen so their
              open:schedule / open:autopilot event listeners are always live,
              even though the visible triggers now live in the sidebar. */}
            <div className="sr-only" aria-hidden>
              <TopBarActions workspaceId={workspaceId} />
            </div>

            {/* Tablet & mobile (<xl): all actions live in the left sidebar (menu). */}

            {/* Studio toggle + Publish share one flex container to lock spacing */}
            <div className="flex shrink-0 items-center gap-1.5">
              <Suspense fallback={null}>
                <CompetitorWatchButton workspaceId={workspaceId} />
              </Suspense>
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent("toggle:studio"))}
                aria-label="Open Studio"
                title="Open Studio"
                className="group relative inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-[hsl(var(--brand-green)/0.35)] bg-[hsl(var(--brand-green)/0.10)] px-2.5 text-[12px] font-semibold tracking-tight text-[hsl(var(--brand-green))] shadow-[0_0_0_1px_hsl(var(--brand-green)/0.15)_inset,0_4px_14px_-6px_hsl(var(--brand-green)/0.55)] transition-all hover:bg-[hsl(var(--brand-green)/0.18)] hover:text-foreground hover:shadow-[0_0_0_1px_hsl(var(--brand-green)/0.35)_inset,0_6px_18px_-6px_hsl(var(--brand-green)/0.75)] active:scale-[0.97]"
              >
                <PanelRightOpen className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">Studio</span>
              </button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label="Share"
                    title="Share"
                    className="group relative inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-md bg-primary px-2.5 text-[12px] font-semibold tracking-tight text-primary-foreground shadow-sm transition hover:bg-primary/90 hover:shadow-md active:scale-[0.97] data-[state=open]:bg-primary/90 sm:px-3"
                  >
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full"
                    />
                    <Share2 className="relative h-3.5 w-3.5" strokeWidth={2.4} aria-hidden />
                    <span className="relative hidden sm:inline">Share</span>
                    <ChevronDown
                      className="relative h-3 w-3 opacity-80 transition group-data-[state=open]:rotate-180"
                      aria-hidden
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={8} className="w-64 p-1.5">
                  <DropdownMenuLabel className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Share
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      window.dispatchEvent(new CustomEvent("open:share"));
                    }}
                    className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-2"
                  >
                    <Share2 className="mt-0.5 h-4 w-4 text-[hsl(var(--brand-green))]" />
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium leading-tight">Invite teammates</div>
                      <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                        Share workspace access with your team
                      </div>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      window.dispatchEvent(new CustomEvent("open:client-portal"));
                    }}
                    className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-2"
                  >
                    <Users className="mt-0.5 h-4 w-4 text-[hsl(var(--brand-blue))]" />
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium leading-tight">Client portal</div>
                      <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                        Share plans with clients for approval
                      </div>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      window.dispatchEvent(new CustomEvent("open:publish"));
                    }}
                    className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-2"
                  >
                    <Rocket className="mt-0.5 h-4 w-4 text-foreground/80" />
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium leading-tight">Publish</div>
                      <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                        Deploy the latest version live
                      </div>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Mounted (hidden) so events open the underlying dialogs */}
              <Suspense fallback={null}>
                <PublishDialog workspaceId={workspaceId}>
                  <span data-publish-trigger className="hidden" aria-hidden />
                </PublishDialog>
                <ShareDialog workspaceId={workspaceId}>
                  <span data-share-trigger className="hidden" aria-hidden />
                </ShareDialog>
                <AiVisibilityDialog workspaceId={workspaceId} />
              </Suspense>
            </div>
          </motion.div>
        </header>

        {/* Workspace — chat area to the right of the full-height sidebar */}
        <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
          <main
            data-workspace-main="true"
            className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background"
          >
            <MobileManusLayout workspaceId={workspaceId} brandContext={brandContextForCoach} />
          </main>
        </div>
      </div>

      <CommandBar />
      <Suspense fallback={null}>
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

        {studioCanvas && (
          <StudioCanvasModal
            canvas={studioCanvas}
            onClose={closeStudio}
            workspaceName={workspaceName}
            workspaceId={workspaceId}
          />
        )}
        <WorkspaceDialogs
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          onRenamed={setWorkspaceName}
        />
        <ContentCalendar workspaceId={workspaceId} />
      </Suspense>
    </div>
  );
}

function MobileManusLayout({
  workspaceId,
  brandContext,
}: {
  workspaceId: string | null;
  brandContext?: string;
}) {
  const isMobile = useIsMobile();
  const [studioOpen, setStudioOpen] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem("raval:studioOpen") === "1") setStudioOpen(true);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem("raval:studioOpen", studioOpen ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [studioOpen]);
  useEffect(() => {
    const open = () => setStudioOpen(true);
    const toggle = () => setStudioOpen((v) => !v);
    window.addEventListener("open:studio", open as EventListener);
    window.addEventListener("toggle:studio", toggle as EventListener);
    return () => {
      window.removeEventListener("open:studio", open as EventListener);
      window.removeEventListener("toggle:studio", toggle as EventListener);
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
  const studioWidth = isMobile ? Math.min(320, Math.round(vw * 0.88)) : 320;

  // Swipe gestures on mobile: left-swipe from right edge opens studio; right-swipe closes it.
  useSwipe({
    enabled: isMobile,
    edgeStartRightPx: studioOpen ? undefined : 24,
    onSwipeLeft: () => {
      if (!studioOpen) setStudioOpen(true);
    },
    onSwipeRight: () => {
      if (studioOpen) setStudioOpen(false);
    },
  });

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-row bg-background">
      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {workspaceId ? (
          <ChatPanel
            workspaceId={workspaceId}
            variant="centered"
            mobileAccessory={
              <Suspense fallback={null}>
                <MarketingCoachPanel
                  workspaceId={workspaceId}
                  brandContext={brandContext}
                  leading={<MiniSiteThumb workspaceId={workspaceId} />}
                />
              </Suspense>
            }
          />
        ) : (
          <div className="p-6 text-sm text-muted-foreground">Loading workspace…</div>
        )}
      </section>

      {/* Studio — inline on desktop, overlay drawer on mobile. */}
      <AnimatePresence initial={false} mode="sync">
        {studioOpen && (
          <>
            {isMobile && (
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
              initial={isMobile ? { x: studioWidth } : { width: 0, opacity: 0 }}
              animate={isMobile ? { x: 0 } : { width: studioWidth, opacity: 1 }}
              exit={isMobile ? { x: studioWidth } : { width: 0, opacity: 0 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              style={isMobile ? { width: studioWidth } : undefined}
              className={cn(
                "h-full overflow-hidden border-l border-border/60 bg-sidebar [will-change:width,transform]",
                isMobile ? "fixed inset-y-0 right-0 z-40 shadow-2xl" : "flex-none",
              )}
            >
              <div style={{ width: studioWidth }} className="h-full overflow-y-auto">
                <StudioRail embedded />
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="hidden">
        <StudioBottomDock />
      </div>
    </div>
  );
}

function MiniSiteThumb({ workspaceId }: { workspaceId: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    supabase
      .from("workspaces")
      .select("website_url")
      .eq("id", workspaceId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const raw = data?.website_url?.trim();
        if (!raw) return;
        setUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const shot = url
    ? `https://api.microlink.io/?url=${encodeURIComponent(url)}&screenshot=true&meta=false&embed=screenshot.url&viewport.width=1024&viewport.height=640`
    : null;

  return (
    <span className="relative grid h-12 w-[68px] shrink-0 place-items-center overflow-hidden rounded-lg bg-gradient-to-br from-[hsl(var(--brand-blue)/0.18)] to-[hsl(var(--brand-green)/0.18)] ring-1 ring-border/60 shadow-sm">
      {shot && (
        <img
          src={shot}
          alt=""
          onLoad={() => setLoaded(true)}
          className={cn(
            "absolute inset-0 h-full w-full object-cover object-top transition-opacity",
            loaded ? "opacity-100" : "opacity-0",
          )}
          draggable={false}
        />
      )}
      {!loaded && (
        <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--brand-green))] shadow-[0_0_8px_hsl(var(--brand-green)/0.7)]" />
      )}
    </span>
  );
}

export default AppShell;
