"use client";

// One customer: who they are, what they own, what was done to their account,
// and the few actions support may take. Every action asks for a reason and is
// recorded in the audit log by the database function that performs it.

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SurfacePage, GroupLabel, Tile } from "@/components/app/surface/SurfaceLayout";
import { ErrorState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft } from "@/components/icons";
import { toast } from "@/lib/toast";
import type { AdminUserDetail } from "@/lib/admin/types";
import { adminApi, errorMessage, useAdminMe } from "./api";
import { AuditList } from "./AuditList";
import { ConfirmAction } from "./ConfirmAction";
import { ago, fmtDate, fmtDateTime } from "./format";
import { Chip, Fact, textareaClass } from "./parts";
import { hasPermission } from "@/lib/admin/permissions";

export function UserDetailScreen({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const me = useAdminMe();
  const key = ["admin", "users", "detail", id];
  const detail = useQuery({
    queryKey: key,
    queryFn: () => adminApi<AdminUserDetail>(`/api/admin/users/detail?id=${id}`),
  });
  const can = (permission: Parameters<typeof hasPermission>[1]) =>
    me.data ? hasPermission(me.data.permissions, permission) : false;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "users"] });

  const suspend = useMutation({
    mutationFn: ({ suspend: next, reason }: { suspend: boolean; reason: string }) =>
      adminApi<{ suspended: boolean; sessionsEnded: number }>("/api/admin/users/suspend", {
        method: "POST",
        body: { userId: id, suspend: next, reason },
      }),
    onSuccess: (result) => {
      toast.success(
        result.suspended
          ? `Suspended. ${result.sessionsEnded} session${result.sessionsEnded === 1 ? "" : "s"} ended.`
          : "Account restored.",
      );
      void refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const signOut = useMutation({
    mutationFn: (reason: string) =>
      adminApi<{ sessionsEnded: number }>("/api/admin/users/sessions", {
        method: "POST",
        body: { userId: id, reason },
      }),
    onSuccess: (result) => {
      toast.success(
        `Signed out of ${result.sessionsEnded} session${result.sessionsEnded === 1 ? "" : "s"}.`,
      );
      void refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const [note, setNote] = useState("");
  const addNote = useMutation({
    mutationFn: (body: string) =>
      adminApi("/api/admin/users/notes", { method: "POST", body: { userId: id, body } }),
    onSuccess: () => {
      setNote("");
      toast.success("Note saved.");
      void refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (detail.isLoading) {
    return (
      <SurfacePage>
        <Skeleton className="h-64 rounded-2xl" />
      </SurfacePage>
    );
  }
  if (detail.error || !detail.data) {
    return (
      <SurfacePage>
        <ErrorState
          description={detail.error?.message ?? "Could not load this user."}
          onRetry={() => void detail.refetch()}
        />
      </SurfacePage>
    );
  }

  const { user, workspaces, billing, notes, audit } = detail.data;
  const isSelf = me.data?.userId === user.id;

  return (
    <SurfacePage
      title={user.email ?? user.id}
      subtitle={user.name ?? undefined}
      actions={
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> All users
        </Link>
      }
    >
      <div className="mb-4 flex flex-wrap gap-1.5">
        {user.suspended ? <Chip tone="danger">Suspended</Chip> : <Chip tone="success">Active</Chip>}
        {user.isAdmin && <Chip tone="primary">Admin</Chip>}
        {!user.emailConfirmed && <Chip tone="warning">Email not confirmed</Chip>}
      </div>

      <Tile>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="User id">
            <span className="font-mono text-[12.5px]">{user.id}</span>
          </Fact>
          <Fact label="Joined">{fmtDate(user.createdAt)}</Fact>
          <Fact label="Last sign-in">
            {user.lastSignInAt
              ? `${ago(user.lastSignInAt)} (${fmtDateTime(user.lastSignInAt)})`
              : "Never"}
          </Fact>
          <Fact label="Sign-in methods">
            {user.providers.length ? user.providers.join(", ") : "—"}
          </Fact>
          <Fact label="Open sessions">{user.sessions}</Fact>
          <Fact label="Second factor">{user.mfaFactors > 0 ? "Set up" : "Not set up"}</Fact>
          <Fact label="Persona">{user.persona ?? "—"}</Fact>
          <Fact label="Workspaces">{user.workspaceCount}</Fact>
        </dl>
      </Tile>

      {(can("users.suspend") || can("users.sessions.revoke")) && (
        <>
          <GroupLabel>Actions</GroupLabel>
          <Tile className="space-y-4">
            {isSelf ? (
              <p className="text-[13px] text-muted-foreground">
                You can&apos;t change your own account from here.
              </p>
            ) : (
              <div className="flex flex-wrap items-start gap-3">
                {can("users.suspend") && (
                  <ConfirmAction
                    label={user.suspended ? "Restore account" : "Suspend account"}
                    confirmLabel={user.suspended ? "Restore" : "Suspend"}
                    tone={user.suspended ? "default" : "danger"}
                    description={
                      user.suspended
                        ? "They will be able to sign in again."
                        : "They are signed out everywhere and can't sign in until restored."
                    }
                    onConfirm={(reason) =>
                      suspend
                        .mutateAsync({ suspend: !user.suspended, reason })
                        .then(() => undefined)
                    }
                  />
                )}
                {can("users.sessions.revoke") && !user.suspended && (
                  <ConfirmAction
                    label="Sign out everywhere"
                    description="Ends every open session. They can sign in again."
                    onConfirm={(reason) => signOut.mutateAsync(reason).then(() => undefined)}
                  />
                )}
              </div>
            )}
          </Tile>
        </>
      )}

      <GroupLabel>Workspaces</GroupLabel>
      {workspaces.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Not a member of any workspace.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {workspaces.map((workspace) => (
            <Link key={workspace.id} href={`/admin/workspaces/${workspace.id}`}>
              <Tile interactive className="space-y-1">
                <p className="truncate text-[14px] font-medium">{workspace.name}</p>
                <p className="text-[12.5px] text-muted-foreground">
                  {workspace.owned ? "Owner" : workspace.role} · {workspace.plan ?? "no plan"}
                </p>
              </Tile>
            </Link>
          ))}
        </div>
      )}

      {billing.length > 0 && (
        <>
          <GroupLabel>Billing accounts</GroupLabel>
          <div className="grid gap-3 sm:grid-cols-2">
            {billing.map((account) => (
              <Tile key={account.id} className="space-y-1">
                <p className="text-[14px] font-medium capitalize">
                  {account.planId} · {account.status.replace("_", " ")}
                  {account.comped && " · comped"}
                </p>
                <p className="text-[12.5px] text-muted-foreground">
                  {account.trialEndsAt ? `Trial ends ${fmtDate(account.trialEndsAt)} · ` : ""}
                  {account.currentPeriodEnd
                    ? `Renews ${fmtDate(account.currentPeriodEnd)}`
                    : "No billing period"}
                </p>
              </Tile>
            ))}
          </div>
        </>
      )}

      <GroupLabel>Internal notes</GroupLabel>
      <Tile className="space-y-4">
        {can("users.notes.write") && (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (note.trim()) addNote.mutate(note.trim());
            }}
          >
            <label className="block">
              <span className="sr-only">New note</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Add a note for the team. Customers never see these."
                maxLength={2000}
                className={textareaClass}
              />
            </label>
            <Button type="submit" size="sm" disabled={!note.trim() || addNote.isPending}>
              {addNote.isPending ? "Saving…" : "Save note"}
            </Button>
          </form>
        )}
        {notes.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No notes yet.</p>
        ) : (
          <ul className="space-y-3">
            {notes.map((entry) => (
              <li
                key={entry.id}
                className="border-t border-border/50 pt-3 first:border-t-0 first:pt-0"
              >
                <p className="whitespace-pre-wrap break-words text-[13.5px]">{entry.body}</p>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  {entry.authorEmail ?? "Unknown"} · {fmtDateTime(entry.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Tile>

      {can("audit.read") && (
        <>
          <GroupLabel>History</GroupLabel>
          {audit.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              Nothing has been done to this account.
            </p>
          ) : (
            <AuditList rows={audit} compact />
          )}
        </>
      )}
    </SurfacePage>
  );
}
