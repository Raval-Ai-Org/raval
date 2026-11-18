"use client";

// AdminShell — the frame of the Mellox admin console: header, a grouped
// navigation rail and the page. "Every day" is always open (Overview,
// Customers, Activity, Errors, Revenue); the other groups fold away, and the
// group holding the open page is always unfolded. The rail only lists what
// this admin may open; the server checks the same permission again on every
// request.

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart,
  Bot,
  Building2,
  CalendarClock,
  ChevronDown,
  CreditCard,
  Cpu,
  Gauge,
  History,
  Layers,
  LineChart,
  Gift,
  Megaphone,
  Plug,
  Power,
  Search,
  Bookmark as FlagIcon,
  Shield,
  ShieldCheck,
  UserCircle2,
  Users,
  Wallet,
  ZapOff,
} from "@/components/icons";
import { hasPermission, type Permission } from "@/lib/admin/permissions";
import type { AdminMe, AdminPulse } from "@/lib/admin/types";
import { cn } from "@/lib/utils";
import { AdminApiError, adminApi, adminKeys, useAdminMe } from "./api";
import { MfaPanel } from "./MfaPanel";
import { pulseKey } from "./pulse-ui";

type NavId =
  | "overview"
  | "customers"
  | "activity"
  | "errors"
  | "revenue"
  | "users"
  | "workspaces"
  | "plans"
  | "promos"
  | "flags"
  | "announcements"
  | "usage"
  | "ai"
  | "jobs"
  | "abuse"
  | "analytics"
  | "integrations"
  | "support"
  | "health"
  | "emergency"
  | "audit"
  | "security"
  | "team"
  | "billing";

type NavIcon = ComponentType<{ className?: string; strokeWidth?: number }>;

type NavDef = {
  id: NavId;
  label: string;
  href: string;
  icon: NavIcon;
  /** Shown when the admin holds this permission (or, for billing, may open it). */
  permission?: Permission;
};

type NavGroup = {
  id: "home" | "people" | "product" | "system" | "admin";
  label: string;
  foldable: boolean;
  items: NavDef[];
};

const GROUPS: NavGroup[] = [
  {
    id: "home",
    label: "Every day",
    foldable: false,
    items: [
      {
        id: "overview",
        label: "Overview",
        href: "/admin",
        icon: Gauge,
        permission: "overview.read",
      },
      {
        id: "customers",
        label: "Customers",
        href: "/admin/customers",
        icon: Users,
        permission: "overview.read",
      },
      {
        id: "activity",
        label: "Activity",
        href: "/admin/activity",
        icon: Activity,
        permission: "overview.read",
      },
      {
        id: "errors",
        label: "Errors",
        href: "/admin/errors",
        icon: AlertTriangle,
        permission: "overview.read",
      },
      {
        id: "revenue",
        label: "Revenue",
        href: "/admin/revenue",
        icon: Wallet,
        permission: "overview.read",
      },
    ],
  },
  {
    id: "people",
    label: "People",
    foldable: true,
    items: [
      {
        id: "users",
        label: "Accounts",
        href: "/admin/users",
        icon: UserCircle2,
        permission: "users.read",
      },
      {
        id: "workspaces",
        label: "Workspaces",
        href: "/admin/workspaces",
        icon: Building2,
        permission: "workspaces.read",
      },
      {
        id: "plans",
        label: "Plans & limits",
        href: "/admin/plans",
        icon: Layers,
        permission: "entitlements.read",
      },
      {
        id: "promos",
        label: "Trial codes",
        href: "/admin/promos",
        icon: Gift,
        permission: "entitlements.read",
      },
      {
        id: "support",
        label: "Support lookup",
        href: "/admin/support",
        icon: Search,
        permission: "lookup.read",
      },
      { id: "billing", label: "Billing desk", href: "/admin/billing", icon: CreditCard },
    ],
  },
  {
    id: "product",
    label: "Product",
    foldable: true,
    items: [
      { id: "ai", label: "AI models", href: "/admin/ai", icon: Bot, permission: "ai.read" },
      {
        id: "usage",
        label: "AI cost",
        href: "/admin/usage",
        icon: BarChart,
        permission: "usage.read",
      },
      {
        id: "flags",
        label: "Feature flags",
        href: "/admin/flags",
        icon: FlagIcon,
        permission: "flags.read",
      },
      {
        id: "announcements",
        label: "Announcements",
        href: "/admin/announcements",
        icon: Megaphone,
        permission: "announcements.manage",
      },
      {
        id: "analytics",
        label: "Feature use",
        href: "/admin/analytics",
        icon: LineChart,
        permission: "analytics.read",
      },
      {
        id: "integrations",
        label: "Connected apps",
        href: "/admin/integrations",
        icon: Plug,
        permission: "integrations.read",
      },
    ],
  },
  {
    id: "system",
    label: "System",
    foldable: true,
    items: [
      {
        id: "health",
        label: "Health",
        href: "/admin/health",
        icon: Cpu,
        permission: "health.read",
      },
      {
        id: "jobs",
        label: "Background jobs",
        href: "/admin/jobs",
        icon: CalendarClock,
        permission: "jobs.read",
      },
      {
        id: "abuse",
        label: "Abuse signals",
        href: "/admin/abuse",
        icon: ZapOff,
        permission: "abuse.read",
      },
      {
        id: "emergency",
        label: "Emergency stop",
        href: "/admin/emergency",
        icon: Power,
        permission: "health.read",
      },
    ],
  },
  {
    id: "admin",
    label: "Admin team",
    foldable: true,
    items: [
      {
        id: "team",
        label: "Team & access",
        href: "/admin/team",
        icon: Shield,
        permission: "admins.read",
      },
      {
        id: "security",
        label: "Security",
        href: "/admin/security",
        icon: ShieldCheck,
        permission: "security.read",
      },
      {
        id: "audit",
        label: "Audit log",
        href: "/admin/audit",
        icon: History,
        permission: "audit.read",
      },
    ],
  },
];

const NAV: NavDef[] = GROUPS.flatMap((group) => group.items);

function canSee(me: Pick<AdminMe, "permissions" | "billing">, item: NavDef): boolean {
  return item.id === "billing"
    ? me.billing
    : item.permission
      ? hasPermission(me.permissions, item.permission)
      : true;
}

export function visibleNav(me: Pick<AdminMe, "permissions" | "billing">): NavDef[] {
  return NAV.filter((item) => canSee(me, item));
}

function visibleGroups(me: Pick<AdminMe, "permissions" | "billing">): NavGroup[] {
  return GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => canSee(me, item)),
  })).filter((group) => group.items.length > 0);
}

function activeId(pathname: string): NavId {
  if (pathname.startsWith("/admin/view/")) return "support";
  const found = NAV.filter((item) => item.href !== "/admin").find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  return found?.id ?? "overview";
}

const FOLD_KEY = "admin:nav-open";

function readFolds(): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(FOLD_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function Rail({
  groups,
  active,
  roleLabel,
  errorBadge,
}: {
  groups: NavGroup[];
  active: NavId;
  roleLabel: string;
  errorBadge: number;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => setOpen(readFolds()), []);
  const toggle = (id: string, value: boolean) => {
    setOpen((current) => {
      const next = { ...current, [id]: value };
      try {
        window.localStorage.setItem(FOLD_KEY, JSON.stringify(next));
      } catch {
        // A blocked store only means the folds aren't remembered.
      }
      return next;
    });
  };

  return (
    <nav aria-label="Admin sections" className="flex h-full flex-col overflow-y-auto px-3 py-4">
      {groups.map((group) => {
        const holdsActive = group.items.some((item) => item.id === active);
        const expanded = !group.foldable || holdsActive || open[group.id] === true;
        return (
          <div key={group.id} className="mb-1">
            {group.foldable ? (
              <button
                type="button"
                onClick={() => toggle(group.id, !expanded)}
                disabled={holdsActive}
                aria-expanded={expanded}
                className="flex w-full items-center justify-between rounded-lg px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground hover:text-foreground disabled:hover:text-muted-foreground"
              >
                {group.label}
                <ChevronDown
                  className={cn(
                    "size-3.5 transition-transform duration-200",
                    !expanded && "-rotate-90",
                  )}
                />
              </button>
            ) : (
              <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {group.label}
              </p>
            )}
            <div
              className={cn(
                "grid transition-[grid-template-rows] duration-300 ease-out",
                expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
              )}
            >
              <ul className="min-h-0 overflow-hidden" inert={!expanded}>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const current = item.id === active;
                  const badge = item.id === "errors" ? errorBadge : 0;
                  return (
                    <li key={item.id}>
                      <Link
                        href={item.href}
                        aria-current={current ? "page" : undefined}
                        className={cn(
                          "relative my-0.5 flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium transition-colors",
                          current
                            ? "bg-foreground text-background shadow-[0_10px_20px_-12px_hsl(0_0%_0%/0.5)]"
                            : "text-foreground/75 hover:bg-foreground/[0.05] hover:text-foreground",
                        )}
                      >
                        <Icon className="size-4 shrink-0" strokeWidth={2} />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {badge > 0 && (
                          <span className="rounded-full bg-destructive px-1.5 py-px text-[10.5px] font-semibold text-white tabular-nums">
                            {badge > 99 ? "99+" : badge}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        );
      })}
      <p className="mt-auto px-2.5 pt-4 text-[11.5px] leading-snug text-muted-foreground">
        Signed in as {roleLabel}
      </p>
    </nav>
  );
}

/** Phones: one scrolling row of the sections. */
function MobileNav({ items, active }: { items: NavDef[]; active: NavId }) {
  return (
    <nav
      aria-label="Admin sections"
      className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-border/60 px-4 py-2 md:hidden"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const current = item.id === active;
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium",
              current ? "bg-foreground text-background" : "bg-foreground/[0.05] text-foreground/80",
            )}
          >
            <Icon className="size-3.5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const me = useAdminMe();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  const items = useMemo(() => (me.data ? visibleNav(me.data) : []), [me.data]);
  const groups = useMemo(() => (me.data ? visibleGroups(me.data) : []), [me.data]);
  const active = activeId(pathname);
  const canPulse = me.data ? hasPermission(me.data.permissions, "overview.read") : false;
  // The same query the pulse pages use, so the Errors badge costs nothing extra there.
  const pulse = useQuery({
    queryKey: pulseKey,
    queryFn: () => adminApi<AdminPulse>("/api/admin/pulse"),
    enabled: canPulse,
    refetchInterval: 120_000,
    staleTime: 60_000,
  });
  const errorBadge = pulse.data?.totals.errors24h ?? 0;
  const error = me.error instanceof AdminApiError ? me.error : null;

  let body: ReactNode;
  if (me.isLoading) {
    body = (
      <div className="mx-auto max-w-3xl space-y-3 p-6">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  } else if (error?.code === "mfa_required") {
    body = (
      <div className="grid h-full place-items-center p-6">
        <MfaPanel
          mode="gate"
          onVerified={() => void queryClient.invalidateQueries({ queryKey: adminKeys.all })}
        />
      </div>
    );
  } else if (error?.status === 404 || error?.status === 401) {
    body = (
      <div className="grid h-full place-items-center p-6">
        <EmptyState
          icon={Shield}
          title="Admins only"
          description="Your account isn't on the Mellox admin team."
        />
      </div>
    );
  } else if (me.error || !me.data) {
    body = (
      <div className="grid h-full place-items-center p-6">
        <ErrorState
          title="Admin console isn't available"
          description={me.error?.message ?? "Try again in a moment."}
          onRetry={() => void me.refetch()}
        />
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <div className="grid h-full place-items-center p-6">
        <EmptyState
          icon={Shield}
          title="No sections yet"
          description="Your role doesn't include any admin sections. Ask a super admin."
        />
      </div>
    );
  } else {
    body = (
      <div className="flex h-full min-h-0 flex-col md:flex-row">
        <MobileNav items={items} active={active} />
        <aside className="hidden w-[232px] shrink-0 border-r border-border/60 md:block">
          <Rail
            groups={groups}
            active={active}
            roleLabel={me.data.roleLabel}
            errorBadge={errorBadge}
          />
        </aside>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    );
  }

  return (
    <div data-mellox-app className="flex h-dvh flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="ds-grad-pill grid h-8 w-8 place-items-center rounded-full text-[#0b1a0d]">
            <Shield className="h-4 w-4" />
          </span>
          <h1 className="text-[15px] font-semibold">Mellox admin</h1>
        </div>
        <Link
          href="/projects"
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to app
        </Link>
      </header>
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  );
}
