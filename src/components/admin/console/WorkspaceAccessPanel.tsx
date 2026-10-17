"use client";

// Workspace access — put one workspace in read-only mode or suspend it, and open
// a short read-only support view of it. Both are sensitive: a written reason is
// required and, when two steps are required, a fresh authenticator code.
//
// A support view is not a login as the customer. It shows an allow-listed
// snapshot, changes nothing, ends after 30 minutes and every read is audited.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GroupLabel, Tile } from "@/components/app/surface/SurfaceLayout";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { hasPermission } from "@/lib/admin/permissions";
import type {
  AdminSupportViewStart,
  AdminWorkspaceAccess,
  AdminWorkspaceAccessMode,
} from "@/lib/admin/types";
import { AdminApiError, adminApi, errorMessage, useAdminMe } from "./api";
import { MfaPanel } from "./MfaPanel";
import { ago } from "./format";
import { Chip, Field, fieldClass, textareaClass } from "./parts";

const MODE: Record<
  AdminWorkspaceAccessMode,
  { label: string; tone: "success" | "warning" | "danger"; help: string }
> = {
  active: { label: "Active", tone: "success", help: "Everyone can use the workspace." },
  read_only: {
    label: "Read-only",
    tone: "warning",
    help: "Members can look around but nothing can be changed, scheduled or published.",
  },
  suspended: {
    label: "Suspended",
    tone: "danger",
    help: "Nobody can use the workspace until it is restored.",
  },
};

type Pending =
  | { kind: "access"; mode: AdminWorkspaceAccessMode; reason: string }
  | { kind: "view"; reason: string };

export function WorkspaceAccessPanel({
  workspaceId,
  access,
}: {
  workspaceId: string;
  access: AdminWorkspaceAccess;
}) {
  const me = useAdminMe();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<AdminWorkspaceAccessMode>(
    access.mode === "active" ? "read_only" : "active",
  );
  const [reason, setReason] = useState("");
  const [viewReason, setViewReason] = useState("");
  const [stepUp, setStepUp] = useState<Pending | null>(null);
  const can = (permission: Parameters<typeof hasPermission>[1]) =>
    me.data ? hasPermission(me.data.permissions, permission) : false;

  const run = useMutation({
    mutationFn: async (pending: Pending) => {
      if (pending.kind === "access") {
        await adminApi("/api/admin/workspaces/access", {
          method: "POST",
          body: { workspaceId, mode: pending.mode, reason: pending.reason },
        });
        return null;
      }
      return adminApi<AdminSupportViewStart>("/api/admin/view/start", {
        method: "POST",
        body: { workspaceId, reason: pending.reason },
      });
    },
    onSuccess: (result, pending) => {
      setStepUp(null);
      if (pending.kind === "view" && result) {
        toast.success("Support view opened for 30 minutes.");
        router.push(`/admin/view/${result.sessionId}`);
        return;
      }
      toast.success("Saved.");
      setReason("");
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

  const canSuspend = can("workspaces.suspend");
  const canView = can("support.impersonate");
  if (!canSuspend && !canView && access.mode === "active") return null;

  const reasonOk = reason.trim().length >= 10;
  const viewReasonOk = viewReason.trim().length >= 10;

  return (
    <>
      <GroupLabel>Access</GroupLabel>
      <Tile className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={MODE[access.mode].tone}>{MODE[access.mode].label}</Chip>
          <span className="text-[12.5px] text-muted-foreground">
            {MODE[access.mode].help}
            {access.changedAt ? ` Changed ${ago(access.changedAt)}.` : ""}
          </span>
        </div>
        {access.reason && (
          <p className="text-[12.5px] text-muted-foreground">Reason: “{access.reason}”</p>
        )}

        {stepUp && (
          <MfaPanel
            mode="reauth"
            onVerified={() => {
              const pending = stepUp;
              setStepUp(null);
              run.mutate(pending);
            }}
          />
        )}

        {canSuspend && !stepUp && (
          <div className="space-y-3 border-t border-border/50 pt-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Set access to">
                <select
                  className={fieldClass}
                  value={mode}
                  onChange={(event) => setMode(event.target.value as AdminWorkspaceAccessMode)}
                >
                  {(Object.keys(MODE) as AdminWorkspaceAccessMode[])
                    .filter((key) => key !== access.mode)
                    .map((key) => (
                      <option key={key} value={key}>
                        {MODE[key].label}
                      </option>
                    ))}
                </select>
              </Field>
            </div>
            <Field label="Reason" hint="At least 10 characters, saved in the audit log">
              <textarea
                className={textareaClass}
                value={reason}
                maxLength={300}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
            <Button
              size="sm"
              variant={mode === "suspended" ? "destructive" : "default"}
              disabled={!reasonOk || run.isPending || mode === access.mode}
              onClick={() => run.mutate({ kind: "access", mode, reason: reason.trim() })}
            >
              {run.isPending ? "Working…" : `Make ${MODE[mode].label.toLowerCase()}`}
            </Button>
          </div>
        )}

        {canView && !stepUp && (
          <div className="space-y-3 border-t border-border/50 pt-4">
            <Field
              label="Read-only support view"
              hint="Opens a snapshot of this workspace for 30 minutes. You can’t change anything from it, and every read is logged."
            >
              <textarea
                className={textareaClass}
                value={viewReason}
                maxLength={300}
                placeholder="Why do you need to look? (at least 10 characters)"
                onChange={(event) => setViewReason(event.target.value)}
              />
            </Field>
            <Button
              size="sm"
              variant="outline"
              disabled={!viewReasonOk || run.isPending}
              onClick={() => run.mutate({ kind: "view", reason: viewReason.trim() })}
            >
              Open support view
            </Button>
          </div>
        )}
      </Tile>
    </>
  );
}
