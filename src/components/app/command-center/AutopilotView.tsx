"use client";

// Autopilot across every client. The same engine runs in each workspace; this
// view only reads a per-workspace summary (an RPC that runs with the caller's
// own rights) and sends per-workspace decisions, each role-checked on the
// server for that workspace. Nothing here reaches across clients.
import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Bot, Inbox, Lightbulb, Pause, Play } from "@/components/icons";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { dsGhostBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { autopilotKeys, useAgencyAutopilot } from "@/components/app/autopilot/hooks";
import { setAutopilotPaused } from "@/lib/autopilot.functions";
import { MODE_INFO, type AgencyAutopilotRow } from "@/lib/autopilot/contracts";
import {
  buildAutopilotAttention,
  needsYou,
  pauseReasonText,
  rowState,
  sortAgencyRows,
  type AutopilotTone,
} from "@/lib/autopilot/status";
import { canEdit, type CcClient } from "@/lib/agency/command-center";
import { cn } from "@/lib/utils";
import type { CommandCenter } from "./use-command-center";
import { ClientMark, StatTile, clientHref } from "./ui";

const TONE_DOT: Record<AutopilotTone, string> = {
  good: "bg-success",
  warn: "bg-warning",
  risk: "bg-destructive",
  idle: "bg-muted-foreground/40",
};

function nextLabel(row: AgencyAutopilotRow): string {
  if (!row.nextActionAt) return row.programId ? "Nothing planned" : "";
  const when = new Date(row.nextActionAt).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return row.nextActionTitle ? `${when} · ${row.nextActionTitle}` : when;
}

function Count({
  value,
  label,
  tone,
  onClick,
}: {
  value: number;
  label: string;
  tone?: "warn" | "risk" | "primary";
  onClick?: () => void;
}) {
  const colour =
    !value || !tone
      ? "text-muted-foreground"
      : tone === "risk"
        ? "text-destructive"
        : tone === "warn"
          ? "text-warning"
          : "text-primary";
  const body = (
    <>
      <span className={cn("text-[17px] font-semibold tabular-nums leading-none", colour)}>
        {value}
      </span>
      <span className="mt-1 block text-[11px] text-muted-foreground">{label}</span>
    </>
  );
  return onClick && value ? (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-[var(--ds-well-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {body}
    </button>
  ) : (
    <div className="px-2 py-1.5">{body}</div>
  );
}

export function AutopilotView({
  cc,
  onGo,
  onReviewClient,
}: {
  cc: CommandCenter;
  onGo: (href: string) => void;
  onReviewClient: (workspaceId: string) => void;
}) {
  const query = useAgencyAutopilot(true);
  const client = useQueryClient();

  const pause = useMutation({
    mutationFn: (args: { workspaceId: string; paused: boolean }) =>
      setAutopilotPaused({ data: args }),
    onSuccess: (_d, args) => {
      toast.success(args.paused ? "Autopilot paused" : "Autopilot resumed", {
        description: cc.clientMap.get(args.workspaceId)?.name,
      });
      void client.invalidateQueries({ queryKey: autopilotKeys.agency });
      void client.invalidateQueries({ queryKey: autopilotKeys.all(args.workspaceId) });
    },
    onError: (e) =>
      toast.error("We couldn't change that", {
        description: e instanceof Error ? e.message : "Try again.",
      }),
  });

  // Only clients the Command Center already knows (and so the caller belongs to).
  const rows = useMemo(
    () => sortAgencyRows((query.data ?? []).filter((r) => cc.clientMap.has(r.workspaceId))),
    [query.data, cc.clientMap],
  );
  const nameOf = (id: string) => cc.clientMap.get(id)?.name ?? "A client";
  const attention = useMemo(
    () => buildAutopilotAttention(rows, (id) => cc.clientMap.get(id)?.name ?? "a client"),
    [rows, cc.clientMap],
  );

  if (query.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-[var(--ds-radius-tile)]" />
        <Skeleton className="h-64 w-full rounded-[var(--ds-radius-tile)]" />
      </div>
    );
  }
  if (query.error) {
    return (
      <ErrorState
        title="We couldn't load Autopilot"
        detail={query.error instanceof Error ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (!rows.length) {
    return (
      <EmptyState
        icon={Bot}
        title="Autopilot isn't on for any client yet"
        description="Once it's switched on for a workspace, every client's plan and approvals show here."
      />
    );
  }

  const running = rows.filter((r) => r.status === "running").length;
  const paused = rows.filter((r) => r.status === "paused").length;
  const approvals = rows.reduce((n, r) => n + r.needsApproval, 0);
  const failures = rows.reduce((n, r) => n + r.failures, 0);
  const opportunities = rows.reduce((n, r) => n + r.newOpportunities, 0);
  const open = (c: CcClient) => onGo(clientHref(c, "autopilot"));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Running"
          value={running}
          sub={paused ? `${paused} paused` : "clients"}
          icon={<Bot className="h-4 w-4" />}
          tone="primary"
        />
        <StatTile
          label="Needs approval"
          value={approvals}
          sub="pieces"
          icon={<Inbox className="h-4 w-4" />}
          tone={approvals ? "warn" : "neutral"}
        />
        <StatTile
          label="New opportunities"
          value={opportunities}
          sub="worth a response"
          icon={<Lightbulb className="h-4 w-4" />}
        />
        <StatTile
          label="Didn't work"
          value={failures}
          sub="steps to fix"
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={failures ? "risk" : "neutral"}
        />
      </div>

      {attention.length > 0 && (
        <ul className="ds-tile divide-y divide-border/50 px-4 sm:px-5">
          {attention.map((item) => {
            const target = item.workspaceId ? cc.clientMap.get(item.workspaceId) : undefined;
            return (
              <li key={item.id} className="flex items-center gap-3 py-3">
                <span
                  className={cn(
                    "grid h-8 w-8 shrink-0 place-items-center rounded-full",
                    item.tone === "risk"
                      ? "bg-destructive/12 text-destructive"
                      : item.tone === "warn"
                        ? "bg-warning/12 text-warning"
                        : "bg-primary/12 text-primary",
                  )}
                >
                  {item.tone === "risk" ? (
                    <AlertTriangle className="h-4 w-4" />
                  ) : item.tone === "warn" ? (
                    <Inbox className="h-4 w-4" />
                  ) : (
                    <Lightbulb className="h-4 w-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium">{item.title}</p>
                  <p className="truncate text-[12px] text-muted-foreground">{item.detail}</p>
                </div>
                {target && (
                  <button
                    type="button"
                    onClick={() =>
                      item.id === "autopilot-approvals" ? onReviewClient(target.id) : open(target)
                    }
                    className={cn(dsGhostBtn, "h-8 shrink-0 px-3 text-[12.5px]")}
                  >
                    {item.cta}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ul className="space-y-2.5" aria-label="Autopilot by client">
        {rows.map((row) => {
          const c = cc.clientMap.get(row.workspaceId);
          if (!c) return null;
          const state = rowState(row);
          const mayEdit = canEdit(c.role);
          const isPaused = row.status === "paused";
          return (
            <li key={row.workspaceId} className="ds-tile p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <button
                  type="button"
                  onClick={() => open(c)}
                  className="flex min-w-0 flex-1 basis-[220px] items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <ClientMark client={c} size={36} />
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-semibold">{c.name}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", TONE_DOT[state.tone])} />
                      <span className="truncate">
                        {state.label}
                        {row.mode ? ` · ${MODE_INFO[row.mode].label}` : ""}
                        {isPaused && row.pauseReason && row.pauseReason !== "user"
                          ? ` · ${pauseReasonText(row.pauseReason)}`
                          : ""}
                      </span>
                    </span>
                  </span>
                </button>

                <div className="grid grid-cols-4 gap-1 sm:gap-3">
                  <Count
                    value={row.needsApproval + (row.planWaiting ? 1 : 0)}
                    label="To approve"
                    tone="warn"
                    onClick={() => (row.needsApproval ? onReviewClient(c.id) : open(c))}
                  />
                  <Count
                    value={row.newOpportunities}
                    label="Opportunities"
                    tone="primary"
                    onClick={() => open(c)}
                  />
                  <Count
                    value={row.failures}
                    label="Didn't work"
                    tone="risk"
                    onClick={() => open(c)}
                  />
                  <Count
                    value={row.performanceWarnings + row.missed}
                    label="Warnings"
                    tone="warn"
                    onClick={() => open(c)}
                  />
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {row.programId && mayEdit && (
                    <button
                      type="button"
                      disabled={pause.isPending}
                      aria-label={`${isPaused ? "Resume" : "Pause"} Autopilot for ${c.name}`}
                      onClick={() => pause.mutate({ workspaceId: c.id, paused: !isPaused })}
                      className={cn(dsGhostBtn, "h-8 px-3 text-[12.5px]")}
                    >
                      {isPaused ? (
                        <Play className="h-3.5 w-3.5" />
                      ) : (
                        <Pause className="h-3.5 w-3.5" />
                      )}
                      {isPaused ? "Resume" : "Pause"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => open(c)}
                    className={cn(
                      row.programId || needsYou(row) ? dsGhostBtn : dsPrimaryBtn,
                      "h-8 px-3 text-[12.5px]",
                    )}
                  >
                    {row.programId ? "Open" : "Set up"}
                  </button>
                </div>
              </div>
              {row.programId && (
                <p className="mt-3 truncate border-t border-border/50 pt-3 text-[12.5px] text-muted-foreground">
                  <span className="font-medium text-foreground/80">Next: </span>
                  {nextLabel(row) || "Nothing planned"}
                  <span className="sr-only"> for {nameOf(row.workspaceId)}</span>
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
