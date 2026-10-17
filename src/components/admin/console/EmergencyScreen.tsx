"use client";

// Emergency controls — stop a paid area for the whole platform, or start it
// again. A flip needs a written reason and, when two steps are required, a
// fresh authenticator code; it is audited with the change and takes effect
// within about ten seconds.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SurfacePage, Tile } from "@/components/app/surface/SurfaceLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/lib/toast";
import { hasPermission } from "@/lib/admin/permissions";
import type { AdminSwitch } from "@/lib/admin/types";
import { AdminApiError, adminApi, errorMessage, useAdminMe } from "./api";
import { ConfirmAction } from "./ConfirmAction";
import { LoadError } from "./LoadError";
import { MfaPanel } from "./MfaPanel";
import { ago } from "./format";
import { Chip } from "./parts";

type Pending = { key: AdminSwitch["key"]; engaged: boolean; reason: string };

export function EmergencyScreen() {
  const queryClient = useQueryClient();
  const me = useAdminMe();
  const [stepUp, setStepUp] = useState<Pending | null>(null);
  const canManage = me.data ? hasPermission(me.data.permissions, "emergency.manage") : false;

  const switches = useQuery({
    queryKey: ["admin", "switches"],
    queryFn: () => adminApi<AdminSwitch[]>("/api/admin/switches"),
    refetchInterval: 30_000,
  });

  const flip = useMutation({
    mutationFn: (pending: Pending) =>
      adminApi<{ key: string; engaged: boolean }>("/api/admin/switches", {
        method: "POST",
        body: pending,
      }),
    onSuccess: (result) => {
      toast.success(result.engaged ? "Stopped." : "Running again.");
      setStepUp(null);
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (error, pending) => {
      if (error instanceof AdminApiError && error.code === "reauth_required") {
        setStepUp(pending);
        return;
      }
      toast.error(errorMessage(error));
    },
  });

  const stopped = (switches.data ?? []).filter((item) => item.engaged).length;

  return (
    <SurfacePage
      title="Emergency controls"
      subtitle={
        stopped > 0
          ? `${stopped} area${stopped === 1 ? "" : "s"} stopped for every customer`
          : "Everything is running. Stopping an area affects every customer at once."
      }
    >
      {stepUp && (
        <div className="mb-5">
          <MfaPanel
            mode="reauth"
            onVerified={() => {
              const pending = stepUp;
              setStepUp(null);
              flip.mutate(pending);
            }}
          />
        </div>
      )}
      {switches.isLoading && <Skeleton className="h-48 rounded-2xl" />}
      {switches.error && (
        <LoadError error={switches.error} onRetry={() => void switches.refetch()} />
      )}
      {switches.data && (
        <div className="grid gap-3 sm:grid-cols-2">
          {switches.data.map((item) => (
            <Tile key={item.key} className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-[14px] font-semibold">{item.label}</h3>
                  <p className="mt-0.5 text-[12.5px] text-muted-foreground">{item.description}</p>
                </div>
                <Chip tone={item.engaged ? "danger" : "success"}>
                  {item.engaged ? "Stopped" : "Running"}
                </Chip>
              </div>
              {item.engaged && (
                <p className="text-[12.5px] text-muted-foreground">
                  Stopped {ago(item.changedAt)}
                  {item.changedByEmail ? ` by ${item.changedByEmail}` : ""}
                  {item.reason ? ` — “${item.reason}”` : ""}
                </p>
              )}
              {canManage && (
                <ConfirmAction
                  label={item.engaged ? "Start again" : "Stop"}
                  confirmLabel={item.engaged ? "Start again" : "Stop for everyone"}
                  tone={item.engaged ? "default" : "danger"}
                  description={
                    item.engaged
                      ? "Customers can use this again within seconds."
                      : "Customers see a short “paused for maintenance” message until you start it again."
                  }
                  onConfirm={(reason) =>
                    flip
                      .mutateAsync({ key: item.key, engaged: !item.engaged, reason })
                      .then(() => undefined)
                  }
                />
              )}
            </Tile>
          ))}
        </div>
      )}
    </SurfacePage>
  );
}
