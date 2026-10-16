"use client";

// Security — who has admin access, whether they have a second factor, and the
// refused attempts and sensitive changes of the admin team.

import { useQuery } from "@tanstack/react-query";
import { SurfacePage, GroupLabel, Stat, Tile } from "@/components/app/surface/SurfaceLayout";
import { ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck, Users } from "@/components/icons";
import { ROLE_PRESETS, isAdminRoleKey } from "@/lib/admin/permissions";
import type { AdminSecurity } from "@/lib/admin/types";
import { adminApi } from "./api";
import { AuditList } from "./AuditList";
import { ago } from "./format";
import { Chip } from "./parts";

export function SecurityScreen() {
  const security = useQuery({
    queryKey: ["admin", "security"],
    queryFn: () => adminApi<AdminSecurity>("/api/admin/security"),
  });

  if (security.isLoading) {
    return (
      <SurfacePage title="Security">
        <Skeleton className="h-64 rounded-2xl" />
      </SurfacePage>
    );
  }
  if (security.error || !security.data) {
    return (
      <SurfacePage title="Security">
        <ErrorState
          description={security.error?.message ?? "Could not load security."}
          onRetry={() => void security.refetch()}
        />
      </SurfacePage>
    );
  }

  const { mfaRequired, admins, events } = security.data;
  const active = admins.filter((admin) => admin.status === "active");
  const withoutFactor = active.filter((admin) => admin.mfaFactors === 0);

  return (
    <SurfacePage title="Security" subtitle="Admin access and recent sensitive activity">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Second factor required"
          value={mfaRequired ? "On" : "Off"}
          icon={ShieldCheck}
          tone={mfaRequired ? "success" : "warning"}
          hint={mfaRequired ? "Admin routes need a verified code" : "Set ADMIN_REQUIRE_MFA=true"}
        />
        <Stat label="Active admins" value={active.length} icon={Users} />
        <Stat
          label="Admins without a second factor"
          value={withoutFactor.length}
          tone={withoutFactor.length > 0 ? "warning" : "success"}
          hint={
            withoutFactor.length > 0
              ? "They can't open the console while it is required"
              : undefined
          }
        />
      </div>

      <GroupLabel>Admins</GroupLabel>
      <Tile className="p-0">
        <ul>
          {admins.map((admin) => (
            <li
              key={admin.userId}
              className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 px-4 py-3 first:border-t-0"
            >
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-medium">{admin.email ?? admin.userId}</p>
                <p className="text-[12.5px] text-muted-foreground">
                  {isAdminRoleKey(admin.role) ? ROLE_PRESETS[admin.role].label : admin.role} · seen{" "}
                  {ago(admin.lastSeenAt)}
                </p>
              </div>
              <div className="flex gap-1.5">
                {admin.status !== "active" && <Chip tone="danger">Disabled</Chip>}
                <Chip tone={admin.mfaFactors > 0 ? "success" : "warning"}>
                  {admin.mfaFactors > 0 ? "2-step on" : "No 2-step"}
                </Chip>
              </div>
            </li>
          ))}
        </ul>
      </Tile>

      <GroupLabel>Refused attempts & sensitive changes</GroupLabel>
      {events.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Nothing to report.</p>
      ) : (
        <AuditList rows={events} />
      )}
    </SurfacePage>
  );
}
