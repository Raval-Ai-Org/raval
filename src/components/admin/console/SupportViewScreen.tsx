"use client";

// Support view — a read-only snapshot of one workspace for the next 30 minutes.
// Not a login as the customer: it shows an allow-listed summary (no post or
// message text, no brand data, no credentials, no payment detail), cannot
// change anything, and every section opened is written to the audit log.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { SurfacePage, GroupLabel, Stat, Tile } from "@/components/app/surface/SurfaceLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield } from "@/components/icons";
import { toast } from "@/lib/toast";
import type { AdminSupportView, AdminSupportViewSection } from "@/lib/admin/types";
import { AdminApiError, adminApi, errorMessage } from "./api";
import { LoadError } from "./LoadError";
import { ago, fmtDate, fmtNumber, fmtUsd } from "./format";
import { Chip, Fact, TableFrame, rowClass, td, th } from "./parts";

const SECTIONS: Array<{ id: AdminSupportViewSection; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "content", label: "Content" },
  { id: "accounts", label: "Accounts" },
  { id: "jobs", label: "Jobs" },
];

type Obj = Record<string, unknown>;
const asObj = (value: unknown): Obj => (value && typeof value === "object" ? (value as Obj) : {});
const asList = (value: unknown): Obj[] => (Array.isArray(value) ? (value as Obj[]) : []);
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number => Number(value ?? 0);

function Countdown({ until, onEnd }: { until: string; onEnd: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Date.parse(until) - now);
  useEffect(() => {
    if (left === 0) onEnd();
  }, [left, onEnd]);
  const minutes = Math.floor(left / 60_000);
  const seconds = Math.floor((left % 60_000) / 1000);
  return (
    <span className="tabular-nums">
      {minutes}:{String(seconds).padStart(2, "0")}
    </span>
  );
}

function Counts({ label, value }: { label: string; value: unknown }) {
  const entries = Object.entries(asObj(value));
  return (
    <div>
      <p className="mb-1.5 text-[12px] text-muted-foreground">{label}</p>
      {entries.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">None</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {entries.map(([key, count]) => (
            <Chip key={key} tone={key === "failed" ? "danger" : "neutral"}>
              {key} · {num(count)}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}

export function SupportViewScreen({ sessionId }: { sessionId: string }) {
  const [section, setSection] = useState<AdminSupportViewSection>("overview");
  const [ended, setEnded] = useState(false);

  const view = useQuery({
    queryKey: ["admin", "view", sessionId, section],
    queryFn: () =>
      adminApi<AdminSupportView>(`/api/admin/view?session=${sessionId}&section=${section}`),
    enabled: !ended,
    retry: false,
  });

  const end = useMutation({
    mutationFn: () => adminApi("/api/admin/view/end", { method: "POST", body: { sessionId } }),
    onSuccess: () => {
      setEnded(true);
      toast.success("Support view ended.");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const over =
    ended ||
    (view.error instanceof AdminApiError &&
      (view.error.status === 403 || view.error.status === 404));

  if (over) {
    return (
      <SurfacePage title="Support view ended">
        <p className="text-[13px] text-muted-foreground">
          This read-only view is closed. Open a new one from the workspace page if you still need to
          look.
        </p>
        <div className="mt-4">
          <Link href="/admin/workspaces" className="text-[13px] text-primary hover:underline">
            Back to workspaces
          </Link>
        </div>
      </SurfacePage>
    );
  }

  const data = view.data;
  const body = asObj(data?.data);
  const workspace = asObj(body.workspace);

  return (
    <SurfacePage
      title={str(workspace.name) || "Support view"}
      subtitle="Read-only snapshot · nothing here can be changed"
      actions={
        <Button size="sm" variant="outline" disabled={end.isPending} onClick={() => end.mutate()}>
          End view
        </Button>
      }
    >
      <div
        role="status"
        className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl bg-warning/15 px-4 py-2.5 text-[13px]"
      >
        <Shield className="h-4 w-4 shrink-0" />
        <span className="font-medium">Read-only support view.</span>
        <span className="text-foreground/75">
          Every section you open is recorded.
          {data ? (
            <>
              {" "}
              Ends in <Countdown until={data.expiresAt} onEnd={() => setEnded(true)} />.
            </>
          ) : null}
        </span>
      </div>

      <div className="mb-5 flex flex-wrap gap-1" role="tablist" aria-label="Sections">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={section === item.id}
            onClick={() => setSection(item.id)}
            className={`rounded-full px-3.5 py-1.5 text-[13px] ${
              section === item.id
                ? "bg-primary text-primary-foreground"
                : "bg-foreground/[0.06] text-foreground/75 hover:bg-foreground/10"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {view.isLoading && <Skeleton className="h-64 rounded-2xl" />}
      {view.error && !over && <LoadError error={view.error} onRetry={() => void view.refetch()} />}

      {data && section === "overview" && (
        <>
          <Tile>
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <Fact label="Website">{str(workspace.domain) || "—"}</Fact>
              <Fact label="Industry">{str(workspace.industry) || "—"}</Fact>
              <Fact label="Plan">{str(workspace.plan) || "—"}</Fact>
              <Fact label="Created">{fmtDate(str(workspace.created_at))}</Fact>
              <Fact label="Onboarded">
                {str(workspace.onboarded_at) ? fmtDate(str(workspace.onboarded_at)) : "Not yet"}
              </Fact>
              <Fact label="Access">{str(body.access_mode) || "active"}</Fact>
            </dl>
          </Tile>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Stat label="AI calls, 30 days" value={fmtNumber(num(asObj(body.ai_30d).calls))} />
            <Stat
              label="Estimated AI cost, 30 days"
              value={fmtUsd(num(asObj(body.ai_30d).cost_usd))}
            />
          </div>

          <GroupLabel>Activity</GroupLabel>
          <Tile className="space-y-4 p-4">
            <Counts label="Content by status" value={body.content_by_status} />
            <Counts label="Connected accounts by status" value={body.accounts_by_status} />
            <Counts label="Studio jobs, last 7 days" value={body.jobs_7d_by_status} />
          </Tile>

          <GroupLabel>Members</GroupLabel>
          <Tile className="p-0">
            <ul>
              {asList(body.members).map((member, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-3 border-t border-border/50 px-4 py-3 first:border-t-0"
                >
                  <span className="min-w-0 truncate text-[13.5px]">{str(member.email) || "—"}</span>
                  <Chip>{str(member.role)}</Chip>
                </li>
              ))}
            </ul>
          </Tile>
        </>
      )}

      {data && section === "content" && (
        <TableFrame label="Content">
          <thead>
            <tr>
              <th className={th}>Title</th>
              <th className={th}>Kind</th>
              <th className={th}>Channel</th>
              <th className={th}>Status</th>
              <th className={th}>Created</th>
            </tr>
          </thead>
          <tbody>
            {asList(body.items).map((item) => (
              <tr key={str(item.id)} className={rowClass}>
                <td className={`${td} max-w-[280px] truncate font-medium`}>
                  {str(item.title) || "Untitled"}
                </td>
                <td className={td}>{str(item.kind)}</td>
                <td className={td}>{str(item.channel) || "—"}</td>
                <td className={td}>
                  <Chip>{str(item.status)}</Chip>
                </td>
                <td className={td}>{ago(str(item.created_at))}</td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      )}

      {data && section === "accounts" && (
        <>
          <GroupLabel>Social accounts</GroupLabel>
          <TableFrame label="Social accounts">
            <thead>
              <tr>
                <th className={th}>Platform</th>
                <th className={th}>Account</th>
                <th className={th}>Status</th>
                <th className={th}>Last synced</th>
                <th className={th}>Note</th>
              </tr>
            </thead>
            <tbody>
              {asList(body.social).map((row, i) => (
                <tr key={i} className={rowClass}>
                  <td className={`${td} font-medium`}>{str(row.platform)}</td>
                  <td className={td}>{str(row.username) || "—"}</td>
                  <td className={td}>
                    <Chip tone={str(row.status) === "active" ? "success" : "warning"}>
                      {str(row.status)}
                    </Chip>
                  </td>
                  <td className={td}>{ago(str(row.last_synced_at))}</td>
                  <td className={`${td} max-w-[240px] truncate text-muted-foreground`}>
                    {str(row.reconnect_reason) || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
          <GroupLabel>Website connections</GroupLabel>
          <TableFrame label="Website connections">
            <thead>
              <tr>
                <th className={th}>Provider</th>
                <th className={th}>Account</th>
                <th className={th}>Status</th>
                <th className={th}>Verified</th>
                <th className={th}>Last error</th>
              </tr>
            </thead>
            <tbody>
              {asList(body.connections).map((row, i) => (
                <tr key={i} className={rowClass}>
                  <td className={`${td} font-medium`}>{str(row.provider)}</td>
                  <td className={td}>{str(row.account_login) || "—"}</td>
                  <td className={td}>
                    <Chip tone={str(row.status) === "active" ? "success" : "warning"}>
                      {str(row.status)}
                    </Chip>
                  </td>
                  <td className={td}>{ago(str(row.last_verified_at))}</td>
                  <td className={`${td} max-w-[240px] truncate text-muted-foreground`}>
                    {str(row.last_error) || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        </>
      )}

      {data && section === "jobs" && (
        <TableFrame label="Studio jobs">
          <thead>
            <tr>
              <th className={th}>Type</th>
              <th className={th}>Stage</th>
              <th className={th}>Status</th>
              <th className={th}>Updated</th>
              <th className={th}>Error</th>
            </tr>
          </thead>
          <tbody>
            {asList(body.jobs).map((job) => (
              <tr key={str(job.id)} className={rowClass}>
                <td className={`${td} font-medium`}>{str(job.type)}</td>
                <td className={td}>{str(job.stage)}</td>
                <td className={td}>
                  <Chip tone={str(job.status) === "failed" ? "danger" : "neutral"}>
                    {str(job.status)}
                  </Chip>
                </td>
                <td className={td}>{ago(str(job.updated_at))}</td>
                <td className={`${td} max-w-[280px] truncate text-muted-foreground`}>
                  {str(job.error) || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      )}
    </SurfacePage>
  );
}
