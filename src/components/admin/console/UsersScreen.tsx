"use client";

// Users — find any account. Server-side search, filter, sort and paging; email
// addresses are masked unless the admin holds users.pii.read.

import Link from "next/link";
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { SurfacePage } from "@/components/app/surface/SurfaceLayout";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { Users } from "@/components/icons";
import type { AdminUserRow, Paged } from "@/lib/admin/types";
import { adminApi, query } from "./api";
import { ago, fmtDate } from "./format";
import { Chip, Pager, SearchField, TableFrame, rowClass, td, th } from "./parts";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "recent", label: "New" },
  { value: "suspended", label: "Suspended" },
  { value: "unconfirmed", label: "Unconfirmed" },
  { value: "admins", label: "Admins" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

const PAGE_SIZE = 25;

export function UsersScreen() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<"created" | "last_seen">("created");
  const [page, setPage] = useState(1);

  const users = useQuery({
    queryKey: ["admin", "users", { search, filter, sort, page }],
    queryFn: () =>
      adminApi<Paged<AdminUserRow>>(
        `/api/admin/users${query({ q: search, filter, sort, page, pageSize: PAGE_SIZE })}`,
      ),
    placeholderData: keepPreviousData,
  });

  return (
    <SurfacePage
      title="Users"
      subtitle="Search by email, name or user id"
      actions={
        <>
          <SearchField
            label="Search users"
            placeholder="Email, name or id"
            value={search}
            onChange={(next) => {
              setSearch(next);
              setPage(1);
            }}
          />
          <SegmentedControl
            label="Sort"
            value={sort}
            onValueChange={(next) => {
              setSort(next);
              setPage(1);
            }}
            options={[
              { value: "created", label: "Newest" },
              { value: "last_seen", label: "Last seen" },
            ]}
          />
        </>
      }
    >
      <div className="mb-4 overflow-x-auto">
        <SegmentedControl
          label="Filter users"
          value={filter}
          onValueChange={(next) => {
            setFilter(next);
            setPage(1);
          }}
          options={FILTERS}
        />
      </div>

      {users.isLoading && <Skeleton className="h-64 rounded-2xl" />}
      {users.error && (
        <ErrorState description={users.error.message} onRetry={() => void users.refetch()} />
      )}
      {users.data && users.data.rows.length === 0 && (
        <EmptyState
          icon={Users}
          title="No users match"
          description="Try a different search or filter."
        />
      )}
      {users.data && users.data.rows.length > 0 && (
        <>
          <TableFrame label="Users">
            <thead>
              <tr>
                <th className={th}>Person</th>
                <th className={th}>Status</th>
                <th className={th}>Workspaces</th>
                <th className={th}>Joined</th>
                <th className={th}>Last sign-in</th>
              </tr>
            </thead>
            <tbody>
              {users.data.rows.map((user) => (
                <tr key={user.id} className={rowClass}>
                  <td className={td}>
                    <Link
                      href={`/admin/users/${user.id}`}
                      className="block min-w-0 hover:underline"
                    >
                      <span className="block truncate font-medium">{user.email ?? user.id}</span>
                      {user.name && (
                        <span className="block truncate text-[12px] text-muted-foreground">
                          {user.name}
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className={td}>
                    <div className="flex flex-wrap gap-1.5">
                      {user.suspended && <Chip tone="danger">Suspended</Chip>}
                      {user.isAdmin && <Chip tone="primary">Admin</Chip>}
                      {!user.emailConfirmed && <Chip tone="warning">Unconfirmed</Chip>}
                      {!user.suspended && !user.isAdmin && user.emailConfirmed && (
                        <Chip tone="success">Active</Chip>
                      )}
                    </div>
                  </td>
                  <td className={`${td} tabular-nums`}>{user.workspaceCount}</td>
                  <td className={td}>{fmtDate(user.createdAt)}</td>
                  <td className={td}>{ago(user.lastSignInAt)}</td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
          <Pager page={page} pageSize={PAGE_SIZE} total={users.data.total} onPage={setPage} />
        </>
      )}
    </SurfacePage>
  );
}
