"use client";

// Workspaces — one brand is one workspace. Server-side search, filter and paging.

import Link from "next/link";
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { SurfacePage } from "@/components/app/surface/SurfaceLayout";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2 } from "@/components/icons";
import type { AdminWorkspaceRow, Paged } from "@/lib/admin/types";
import { adminApi, query } from "./api";
import { LoadError } from "./LoadError";
import { fmtDate } from "./format";
import { Chip, Pager, SearchField, TableFrame, rowClass, td, th } from "./parts";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "recent", label: "New" },
  { value: "paid", label: "Paid" },
  { value: "free", label: "Free" },
  { value: "frozen", label: "Frozen" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

const PAGE_SIZE = 25;

export function WorkspacesScreen() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);

  const workspaces = useQuery({
    queryKey: ["admin", "workspaces", { search, filter, page }],
    queryFn: () =>
      adminApi<Paged<AdminWorkspaceRow>>(
        `/api/admin/workspaces${query({ q: search, filter, page, pageSize: PAGE_SIZE })}`,
      ),
    placeholderData: keepPreviousData,
  });

  return (
    <SurfacePage
      title="Workspaces"
      subtitle="Search by name, website, owner email or workspace id"
      actions={
        <SearchField
          label="Search workspaces"
          placeholder="Name, website, owner or id"
          value={search}
          onChange={(next) => {
            setSearch(next);
            setPage(1);
          }}
        />
      }
    >
      <div className="mb-4 overflow-x-auto">
        <SegmentedControl
          label="Filter workspaces"
          value={filter}
          onValueChange={(next) => {
            setFilter(next);
            setPage(1);
          }}
          options={FILTERS}
        />
      </div>

      {workspaces.isLoading && <Skeleton className="h-64 rounded-2xl" />}
      {workspaces.error && (
        <LoadError error={workspaces.error} onRetry={() => void workspaces.refetch()} />
      )}
      {workspaces.data && workspaces.data.rows.length === 0 && (
        <EmptyState
          icon={Building2}
          title="No workspaces match"
          description="Try a different search or filter."
        />
      )}
      {workspaces.data && workspaces.data.rows.length > 0 && (
        <>
          <TableFrame label="Workspaces">
            <thead>
              <tr>
                <th className={th}>Workspace</th>
                <th className={th}>Owner</th>
                <th className={th}>Plan</th>
                <th className={th}>Members</th>
                <th className={th}>Created</th>
              </tr>
            </thead>
            <tbody>
              {workspaces.data.rows.map((workspace) => (
                <tr key={workspace.id} className={rowClass}>
                  <td className={td}>
                    <Link
                      href={`/admin/workspaces/${workspace.id}`}
                      className="block min-w-0 hover:underline"
                    >
                      <span className="block truncate font-medium">{workspace.name}</span>
                      {workspace.domain && (
                        <span className="block truncate text-[12px] text-muted-foreground">
                          {workspace.domain}
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className={`${td} max-w-[220px] truncate`}>{workspace.ownerEmail ?? "—"}</td>
                  <td className={td}>
                    <div className="flex flex-wrap gap-1.5">
                      <Chip
                        tone={
                          workspace.billingPlan && workspace.billingPlan !== "free"
                            ? "primary"
                            : "neutral"
                        }
                      >
                        {workspace.billingPlan ?? workspace.plan ?? "free"}
                      </Chip>
                      {workspace.frozen && <Chip tone="warning">Frozen</Chip>}
                    </div>
                  </td>
                  <td className={`${td} tabular-nums`}>{workspace.memberCount}</td>
                  <td className={td}>{fmtDate(workspace.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
          <Pager page={page} pageSize={PAGE_SIZE} total={workspaces.data.total} onPage={setPage} />
        </>
      )}
    </SurfacePage>
  );
}
