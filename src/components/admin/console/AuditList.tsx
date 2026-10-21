"use client";

// AuditList — audit rows, newest first, each openable to show what changed.
// Used on the Audit log page and in the history of a user or workspace.

import { useState } from "react";
import { ChevronRight } from "@/components/icons";
import type { AdminAuditRow } from "@/lib/admin/types";
import { cn } from "@/lib/utils";
import { actionLabel, fmtDateTime } from "./format";
import { Chip } from "./parts";

function Json({ label, value }: { label: string; value: Record<string, unknown> | null }) {
  if (!value || Object.keys(value).length === 0) return null;
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <pre className="max-h-48 overflow-auto rounded-xl bg-[var(--ds-well-bg)] p-2.5 text-[12px] leading-relaxed">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function Row({ row, compact }: { row: AdminAuditRow; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(row.before || row.after || row.reason || row.error || row.requestId);
  return (
    <li className="border-t border-border/50 first:border-t-0">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((value) => !value)}
        aria-expanded={hasDetail ? open : undefined}
        className={cn(
          "flex w-full items-start gap-3 px-4 py-3 text-left",
          hasDetail && "hover:bg-foreground/[0.03]",
        )}
      >
        <ChevronRight
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
            !hasDetail && "opacity-0",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[13.5px] font-medium">{actionLabel(row.action)}</span>
            {!row.success && <Chip tone="danger">Refused</Chip>}
            {row.actorRole && <Chip>{row.actorRole.replace("_", " ")}</Chip>}
          </div>
          <p className="mt-0.5 break-words text-[12.5px] text-muted-foreground">
            {row.actorEmail ?? row.actorUserId ?? "System"} · {fmtDateTime(row.createdAt)}
            {!compact && row.targetType && (
              <>
                {" "}
                · {row.targetType} <span className="font-mono">{row.targetId}</span>
              </>
            )}
          </p>
        </div>
      </button>
      {open && (
        <div className="space-y-3 px-4 pb-4 pl-11">
          {row.reason && (
            <p className="text-[13px]">
              <span className="text-muted-foreground">Reason: </span>
              {row.reason}
            </p>
          )}
          {row.error && <p className="text-[13px] text-destructive">{row.error}</p>}
          <div className="grid gap-3 md:grid-cols-2">
            <Json label="Before" value={row.before} />
            <Json label="After" value={row.after} />
          </div>
          <p className="break-all font-mono text-[11.5px] text-muted-foreground">
            {row.requestId && `request ${row.requestId}`}
            {row.ip && ` · ${row.ip}`}
          </p>
        </div>
      )}
    </li>
  );
}

export function AuditList({ rows, compact }: { rows: AdminAuditRow[]; compact?: boolean }) {
  return (
    <ul className="ds-tile overflow-hidden p-0" aria-label="Audit history">
      {rows.map((row) => (
        <Row key={row.id} row={row} compact={compact} />
      ))}
    </ul>
  );
}
