"use client";

// AdminShell — the frame of the Mellox admin console: header, navigation rail
// and the page. The rail only lists what this admin may open; the server checks
// the same permission again on every request.

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { SurfaceLayout, type SurfaceNavItem } from "@/components/app/surface/SurfaceLayout";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  ArrowLeft,
  Building2,
  Gauge,
  Layers,
  Shield,
  ShieldCheck,
  Users,
  Wallet,
} from "@/components/icons";
import { hasPermission, type Permission } from "@/lib/admin/permissions";
import type { AdminMe } from "@/lib/admin/types";
import { AdminApiError, adminKeys, useAdminMe } from "./api";
import { MfaPanel } from "./MfaPanel";

type NavId =
  "overview" | "users" | "workspaces" | "plans" | "audit" | "security" | "team" | "billing";

type NavDef = {
  id: NavId;
  label: string;
  href: string;
  icon: SurfaceNavItem<NavId>["icon"];
  /** Shown when the admin holds this permission (or, for billing, may open it). */
  permission?: Permission;
};

const NAV: NavDef[] = [
  { id: "overview", label: "Overview", href: "/admin", icon: Gauge, permission: "overview.read" },
  { id: "users", label: "Users", href: "/admin/users", icon: Users, permission: "users.read" },
  {
    id: "workspaces",
    label: "Workspaces",
    href: "/admin/workspaces",
    icon: Building2,
    permission: "workspaces.read",
  },
  {
    id: "plans",
    label: "Plans",
    href: "/admin/plans",
    icon: Layers,
    permission: "entitlements.read",
  },
  { id: "billing", label: "Billing", href: "/admin/billing", icon: Wallet },
  {
    id: "audit",
    label: "Audit log",
    href: "/admin/audit",
    icon: Activity,
    permission: "audit.read",
  },
  {
    id: "security",
    label: "Security",
    href: "/admin/security",
    icon: ShieldCheck,
    permission: "security.read",
  },
  {
    id: "team",
    label: "Team & access",
    href: "/admin/team",
    icon: Shield,
    permission: "admins.read",
  },
];

export function visibleNav(me: Pick<AdminMe, "permissions" | "billing">): NavDef[] {
  return NAV.filter((item) =>
    item.id === "billing"
      ? me.billing
      : item.permission
        ? hasPermission(me.permissions, item.permission)
        : true,
  );
}

function activeId(pathname: string): NavId {
  const found = NAV.filter((item) => item.href !== "/admin").find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  return found?.id ?? "overview";
}

export function AdminShell({ children }: { children: ReactNode }) {
  const me = useAdminMe();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  const items = useMemo(() => (me.data ? visibleNav(me.data) : []), [me.data]);
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
      <SurfaceLayout
        items={items.map(({ id, label, icon }) => ({ id, label, icon }))}
        value={activeId(pathname)}
        onChange={(id) => {
          const target = items.find((item) => item.id === id);
          if (target) router.push(target.href);
        }}
        label="Admin sections"
        railBottom={
          <p className="px-2 text-[11.5px] leading-snug text-muted-foreground">
            Signed in as {me.data.roleLabel}
          </p>
        }
      >
        <div className="h-full overflow-y-auto">{children}</div>
      </SurfaceLayout>
    );
  }

  return (
    <div data-mellox-app className="flex h-dvh flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-primary/15 text-primary">
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
