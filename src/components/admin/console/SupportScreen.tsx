"use client";

// Support — one search box for a user, workspace or Studio job (by id or part of
// a name, domain or, for admins who may see emails, an email). A workspace
// result can be given a goodwill credit or video adjustment: a bounded,
// audited change that needs a reason and a fresh second factor.

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { SurfacePage, GroupLabel, Tile } from "@/components/app/surface/SurfaceLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/lib/toast";
import { hasPermission } from "@/lib/admin/permissions";
import type { AdminCreditGrantResult, AdminLookup } from "@/lib/admin/types";
import { AdminApiError, adminApi, errorMessage, useAdminMe } from "./api";
import { LoadError } from "./LoadError";
import { MfaPanel } from "./MfaPanel";
import { ago } from "./format";
import { Chip, Field, SearchField, fieldClass, textareaClass } from "./parts";

const LIMITS = { credits: 2000, video: 1000 } as const;

type Grant = {
  workspaceId: string;
  name: string;
  meter: keyof typeof LIMITS;
  amount: string;
  reason: string;
  operationId: string;
};

export function SupportScreen() {
  const me = useAdminMe();
  const [term, setTerm] = useState("");
  const [grant, setGrant] = useState<Grant | null>(null);
  const [stepUp, setStepUp] = useState(false);
  const canGrant = me.data ? hasPermission(me.data.permissions, "credits.grant") : false;
  const ready = term.trim().length >= 3;

  const results = useQuery({
    queryKey: ["admin", "lookup", term.trim()],
    queryFn: () => adminApi<AdminLookup>(`/api/admin/lookup?q=${encodeURIComponent(term.trim())}`),
    enabled: ready,
  });

  const send = useMutation({
    mutationFn: (value: Grant) =>
      adminApi<AdminCreditGrantResult>("/api/admin/credits", {
        method: "POST",
        body: {
          workspaceId: value.workspaceId,
          meter: value.meter,
          amount: Number(value.amount),
          reason: value.reason.trim(),
          operationId: value.operationId,
        },
      }),
    onSuccess: (result) => {
      toast.success(result.replayed ? "Already applied." : "Adjustment added.");
      setGrant(null);
      setStepUp(false);
    },
    onError: (error) => {
      if (error instanceof AdminApiError && error.code === "reauth_required") {
        setStepUp(true);
        return;
      }
      toast.error(errorMessage(error));
    },
  });

  const amount = grant ? Number(grant.amount) : 0;
  const valid =
    grant !== null &&
    Number.isInteger(amount) &&
    amount >= 1 &&
    amount <= LIMITS[grant.meter] &&
    grant.reason.trim().length >= 10;
  const data = results.data;
  const empty = data && !data.users.length && !data.workspaces.length && !data.jobs.length;

  return (
    <SurfacePage title="Support" subtitle="Find a user, workspace or job">
      <SearchField
        value={term}
        onChange={setTerm}
        placeholder="Name, domain, or an id (3+ characters)"
        label="Search"
      />

      {grant && (
        <Tile className="mt-5 space-y-4 p-4">
          <h3 className="text-[14px] font-semibold">Add an adjustment to {grant.name}</h3>
          {stepUp ? (
            <MfaPanel
              mode="reauth"
              onVerified={() => {
                setStepUp(false);
                send.mutate(grant);
              }}
            />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="What">
                  <select
                    className={fieldClass}
                    value={grant.meter}
                    onChange={(event) =>
                      setGrant({ ...grant, meter: event.target.value as Grant["meter"] })
                    }
                  >
                    <option value="credits">Credits</option>
                    <option value="video">Video units (100 = 1 video)</option>
                  </select>
                </Field>
                <Field
                  label="Amount"
                  hint={`Up to ${LIMITS[grant.meter].toLocaleString()} per adjustment. It can be used for AI work only.`}
                >
                  <input
                    className={fieldClass}
                    inputMode="numeric"
                    value={grant.amount}
                    onChange={(event) =>
                      setGrant({ ...grant, amount: event.target.value.replace(/\D/g, "") })
                    }
                  />
                </Field>
              </div>
              <Field label="Reason" hint="At least 10 characters, saved in the audit log">
                <textarea
                  className={textareaClass}
                  value={grant.reason}
                  maxLength={300}
                  onChange={(event) => setGrant({ ...grant, reason: event.target.value })}
                />
              </Field>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={!valid || send.isPending}
                  onClick={() => send.mutate(grant)}
                >
                  {send.isPending ? "Adding…" : "Add adjustment"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={send.isPending}
                  onClick={() => setGrant(null)}
                >
                  Cancel
                </Button>
              </div>
            </>
          )}
        </Tile>
      )}

      {ready && results.isLoading && <Skeleton className="mt-5 h-40 rounded-2xl" />}
      {results.error && <LoadError error={results.error} onRetry={() => void results.refetch()} />}
      {empty && <p className="mt-5 text-[13px] text-muted-foreground">Nothing found.</p>}

      {data && data.users.length > 0 && (
        <>
          <GroupLabel>Users</GroupLabel>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.users.map((user) => (
              <Link key={user.id} href={`/admin/users/${user.id}`}>
                <Tile className="p-4 hover:bg-foreground/[0.03]">
                  <p className="truncate text-[13.5px] font-medium">{user.email ?? user.id}</p>
                  <p className="text-[12.5px] text-muted-foreground">
                    {user.name ?? "No name"} · joined {ago(user.createdAt)}
                  </p>
                </Tile>
              </Link>
            ))}
          </div>
        </>
      )}

      {data && data.workspaces.length > 0 && (
        <>
          <GroupLabel>Workspaces</GroupLabel>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.workspaces.map((workspace) => (
              <Tile key={workspace.id} className="flex items-start justify-between gap-3 p-4">
                <Link href={`/admin/workspaces/${workspace.id}`} className="min-w-0">
                  <p className="truncate text-[13.5px] font-medium">{workspace.name}</p>
                  <p className="text-[12.5px] text-muted-foreground">
                    {workspace.domain ?? "No website"} · created {ago(workspace.createdAt)}
                  </p>
                </Link>
                {canGrant && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setStepUp(false);
                      setGrant({
                        workspaceId: workspace.id,
                        name: workspace.name,
                        meter: "credits",
                        amount: "",
                        reason: "",
                        operationId: crypto.randomUUID(),
                      });
                    }}
                  >
                    Add credits
                  </Button>
                )}
              </Tile>
            ))}
          </div>
        </>
      )}

      {data && data.jobs.length > 0 && (
        <>
          <GroupLabel>Studio jobs</GroupLabel>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.jobs.map((job) => (
              <Link key={job.id} href={`/admin/workspaces/${job.workspaceId}`}>
                <Tile className="p-4 hover:bg-foreground/[0.03]">
                  <div className="flex items-center gap-2">
                    <p className="text-[13.5px] font-medium">{job.type}</p>
                    <Chip tone={job.status === "failed" ? "danger" : "neutral"}>{job.status}</Chip>
                  </div>
                  <p className="text-[12.5px] text-muted-foreground">
                    Updated {ago(job.updatedAt)} · open its workspace
                  </p>
                </Tile>
              </Link>
            ))}
          </div>
        </>
      )}
    </SurfacePage>
  );
}
