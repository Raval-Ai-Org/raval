"use client";

// Team & access — who may use the console and what each role can do. Changing
// the team is a sensitive action: it asks for a written reason and, when two
// steps are required, a fresh authenticator code.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SurfacePage, GroupLabel, Tile } from "@/components/app/surface/SurfaceLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/lib/toast";
import {
  ADMIN_ROLE_KEYS,
  PERMISSIONS,
  ROLE_PRESETS,
  hasPermission,
  type AdminRoleKey,
  type Permission,
} from "@/lib/admin/permissions";
import type { AdminTeamMember } from "@/lib/admin/types";
import { AdminApiError, adminApi, errorMessage, useAdminMe } from "./api";
import { LoadError } from "./LoadError";
import { ago } from "./format";
import { MfaPanel } from "./MfaPanel";
import { Chip, Field, fieldClass, textareaClass } from "./parts";

type Draft = {
  userId?: string;
  email: string;
  role: AdminRoleKey;
  status: "active" | "disabled";
  extra: Permission[];
  denied: Permission[];
  note: string;
  reason: string;
};

const EMPTY: Draft = {
  email: "",
  role: "analyst",
  status: "active",
  extra: [],
  denied: [],
  note: "",
  reason: "",
};

function draftOf(member: AdminTeamMember): Draft {
  return {
    userId: member.userId,
    email: member.email ?? "",
    role: member.role,
    status: member.status,
    extra: member.extraPermissions,
    denied: member.deniedPermissions,
    note: member.note ?? "",
    reason: "",
  };
}

/** "default" follows the role; "allow" adds it; "deny" removes it (deny wins). */
function modeOf(draft: Draft, permission: Permission): "default" | "allow" | "deny" {
  if (draft.denied.includes(permission)) return "deny";
  if (draft.extra.includes(permission)) return "allow";
  return "default";
}

export function TeamScreen() {
  const queryClient = useQueryClient();
  const me = useAdminMe();
  const canManage = me.data ? hasPermission(me.data.permissions, "admins.manage") : false;

  const team = useQuery({
    queryKey: ["admin", "team"],
    queryFn: () => adminApi<AdminTeamMember[]>("/api/admin/team"),
  });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [stepUp, setStepUp] = useState(false);

  const save = useMutation({
    mutationFn: (value: Draft) =>
      adminApi<{ ok: true; userId: string }>("/api/admin/team", {
        method: "POST",
        body: {
          ...(value.userId ? { userId: value.userId } : { email: value.email.trim() }),
          role: value.role,
          status: value.status,
          extraPermissions: value.extra,
          deniedPermissions: value.denied,
          note: value.note.trim() || undefined,
          reason: value.reason.trim(),
        },
      }),
    onSuccess: () => {
      toast.success("Saved.");
      setDraft(null);
      setStepUp(false);
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (error) => {
      if (error instanceof AdminApiError && error.code === "reauth_required") {
        setStepUp(true);
        return;
      }
      toast.error(errorMessage(error));
    },
  });

  const set = (patch: Partial<Draft>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));

  function setMode(permission: Permission, mode: "default" | "allow" | "deny") {
    if (!draft) return;
    const extra = draft.extra.filter((p) => p !== permission);
    const denied = draft.denied.filter((p) => p !== permission);
    if (mode === "allow") extra.push(permission);
    if (mode === "deny") denied.push(permission);
    set({ extra, denied });
  }

  const valid = draft
    ? draft.reason.trim().length >= 10 && (draft.userId || /.+@.+\..+/.test(draft.email.trim()))
    : false;

  return (
    <SurfacePage
      title="Team & access"
      subtitle="Roles are presets of permissions; the server checks the permission on every request"
      actions={
        canManage && !draft ? (
          <Button size="sm" onClick={() => setDraft({ ...EMPTY })}>
            Add admin
          </Button>
        ) : undefined
      }
    >
      {team.isLoading && <Skeleton className="h-48 rounded-2xl" />}
      {team.error && <LoadError error={team.error} onRetry={() => void team.refetch()} />}

      {draft && stepUp && (
        <div className="mb-5">
          <MfaPanel
            mode="reauth"
            onVerified={() => {
              setStepUp(false);
              save.mutate(draft);
            }}
          />
        </div>
      )}

      {draft && !stepUp && (
        <form
          className="mb-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) save.mutate(draft);
          }}
        >
          <Tile className="space-y-4">
            <h4 className="text-[14px] font-semibold">
              {draft.userId ? "Change access" : "Add an admin"}
            </h4>
            {!draft.userId && (
              <Field label="Their account email" hint="They must already have a Mellox account.">
                <input
                  type="email"
                  value={draft.email}
                  onChange={(event) => set({ email: event.target.value })}
                  className={fieldClass}
                  autoFocus
                  required
                />
              </Field>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Role" hint={ROLE_PRESETS[draft.role].description}>
                <select
                  value={draft.role}
                  onChange={(event) => set({ role: event.target.value as AdminRoleKey })}
                  className={fieldClass}
                >
                  {ADMIN_ROLE_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {ROLE_PRESETS[key].label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Status">
                <select
                  value={draft.status}
                  onChange={(event) => set({ status: event.target.value as Draft["status"] })}
                  className={fieldClass}
                >
                  <option value="active">Active</option>
                  <option value="disabled">Disabled</option>
                </select>
              </Field>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-[12.5px] font-medium text-foreground/80">
                Permissions (the role&apos;s own are the default)
              </legend>
              <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {PERMISSIONS.map((permission) => {
                  const inRole = ROLE_PRESETS[draft.role].permissions.includes(permission);
                  const mode = modeOf(draft, permission);
                  return (
                    <label
                      key={permission}
                      className="flex items-center justify-between gap-3 text-[13px]"
                    >
                      <span className="min-w-0 truncate font-mono text-[12px]">
                        {permission}
                        <span className="ml-1.5 font-sans text-muted-foreground">
                          {inRole ? "in role" : ""}
                        </span>
                      </span>
                      <select
                        aria-label={`${permission} access`}
                        value={mode}
                        onChange={(event) => setMode(permission, event.target.value as typeof mode)}
                        className="h-8 rounded-full bg-[var(--ds-well-bg)] px-2.5 text-[12.5px]"
                      >
                        <option value="default">Role default</option>
                        <option value="allow">Always allow</option>
                        <option value="deny">Never allow</option>
                      </select>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <Field label="Note (optional)">
              <input
                value={draft.note}
                onChange={(event) => set({ note: event.target.value })}
                className={fieldClass}
                maxLength={300}
              />
            </Field>
            <Field label="Reason" hint="At least 10 characters. Saved in the audit log.">
              <textarea
                value={draft.reason}
                onChange={(event) => set({ reason: event.target.value })}
                className={textareaClass}
                maxLength={300}
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={!valid || save.isPending}>
                {save.isPending ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDraft(null)}
                disabled={save.isPending}
              >
                Cancel
              </Button>
            </div>
          </Tile>
        </form>
      )}

      {team.data && (
        <>
          <GroupLabel>Admins ({team.data.length})</GroupLabel>
          <Tile className="p-0">
            <ul>
              {team.data.map((member) => (
                <li
                  key={member.userId}
                  className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 px-4 py-3 first:border-t-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-medium">
                      {member.email ?? member.userId}
                    </p>
                    <p className="text-[12.5px] text-muted-foreground">
                      {ROLE_PRESETS[member.role].label} · {member.effectivePermissions.length}{" "}
                      permissions
                      {member.lastSeenAt ? ` · seen ${ago(member.lastSeenAt)}` : ""}
                    </p>
                    {member.note && (
                      <p className="mt-0.5 text-[12px] text-muted-foreground">{member.note}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {member.source === "environment" && <Chip>Server setting</Chip>}
                    {member.status === "disabled" && <Chip tone="danger">Disabled</Chip>}
                    {member.userId === me.data?.userId && <Chip tone="primary">You</Chip>}
                    {canManage && member.source === "team" && member.userId !== me.data?.userId && (
                      <Button size="sm" variant="outline" onClick={() => setDraft(draftOf(member))}>
                        Edit
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Tile>

          <GroupLabel>What each role can do</GroupLabel>
          <div className="grid gap-3 sm:grid-cols-2">
            {ADMIN_ROLE_KEYS.map((key) => (
              <Tile key={key} className="space-y-1.5">
                <p className="text-[14px] font-medium">{ROLE_PRESETS[key].label}</p>
                <p className="text-[12.5px] text-muted-foreground">
                  {ROLE_PRESETS[key].description}
                </p>
                <p className="break-words font-mono text-[11.5px] leading-relaxed text-muted-foreground">
                  {ROLE_PRESETS[key].permissions.join(" · ")}
                </p>
              </Tile>
            ))}
          </div>
        </>
      )}
    </SurfacePage>
  );
}
