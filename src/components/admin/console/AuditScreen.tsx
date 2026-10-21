"use client";

// Audit log — everything the admin team did, and every refused attempt.
// Read-only: no screen or route edits or deletes a row.

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { SurfacePage } from "@/components/app/surface/SurfaceLayout";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity } from "@/components/icons";
import type { AdminAuditRow, Paged } from "@/lib/admin/types";
import { adminApi, query, useAdminMe } from "./api";
import { LoadError } from "./LoadError";
import { AuditExportPanel } from "./AuditExportPanel";
import { AuditList } from "./AuditList";
import { hasPermission } from "@/lib/admin/permissions";
import { Pager, SearchField } from "./parts";

const AREAS = [
  { value: "", label: "Everything" },
  { value: "user.", label: "Users" },
  { value: "admin.", label: "Admin team" },
] as const;

const PAGE_SIZE = 25;

export function AuditScreen() {
  const [area, setArea] = useState<(typeof AREAS)[number]["value"]>("");
  const [failed, setFailed] = useState<"all" | "failed">("all");
  const [target, setTarget] = useState("");
  const [page, setPage] = useState(1);
  const me = useAdminMe();
  const canExport = me.data ? hasPermission(me.data.permissions, "data.export") : false;

  const audit = useQuery({
    queryKey: ["admin", "audit", { area, failed, target, page }],
    queryFn: () =>
      adminApi<Paged<AdminAuditRow>>(
        `/api/admin/audit${query({
          action: area,
          failed: failed === "failed" ? "1" : undefined,
          targetId: target,
          page,
          pageSize: PAGE_SIZE,
        })}`,
      ),
    placeholderData: keepPreviousData,
  });

  return (
    <SurfacePage
      title="Audit log"
      subtitle="Every admin action and refused attempt, newest first. It can't be edited."
      actions={
        <SearchField
          label="Find by target id"
          placeholder="User or workspace id"
          value={target}
          onChange={(next) => {
            setTarget(next.trim());
            setPage(1);
          }}
        />
      }
    >
      {canExport && (
        <AuditExportPanel
          filter={{
            action: area || undefined,
            targetId: target || undefined,
            failedOnly: failed === "failed",
          }}
        />
      )}
      <div className="mb-4 flex flex-wrap gap-3 overflow-x-auto">
        <SegmentedControl
          label="Area"
          value={area}
          onValueChange={(next) => {
            setArea(next);
            setPage(1);
          }}
          options={AREAS}
        />
        <SegmentedControl
          label="Outcome"
          value={failed}
          onValueChange={(next) => {
            setFailed(next);
            setPage(1);
          }}
          options={[
            { value: "all", label: "All" },
            { value: "failed", label: "Refused" },
          ]}
        />
      </div>

      {audit.isLoading && <Skeleton className="h-64 rounded-2xl" />}
      {audit.error && <LoadError error={audit.error} onRetry={() => void audit.refetch()} />}
      {audit.data && audit.data.rows.length === 0 && (
        <EmptyState
          icon={Activity}
          title="Nothing recorded yet"
          description="Admin actions will show up here."
        />
      )}
      {audit.data && audit.data.rows.length > 0 && (
        <>
          <AuditList rows={audit.data.rows} />
          <Pager page={page} pageSize={PAGE_SIZE} total={audit.data.total} onPage={setPage} />
        </>
      )}
    </SurfacePage>
  );
}
