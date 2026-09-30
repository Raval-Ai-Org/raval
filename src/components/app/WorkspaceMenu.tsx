"use client";

import { Spinner } from "@/components/icons";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "@/lib/navigation";
import { emitAppEvent } from "@/lib/app-events";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ErrorState } from "@/components/ui/empty-state";
import { ArrowLeft, Check, Gift, Plus, Search, LayoutGrid, LogOut } from "@/components/brand/icons";
import { useEntitlements } from "@/lib/billing/use-entitlements";
import { PLANS, SIGNUP_GRANT } from "@/lib/billing/catalog";
import { asPlan, formatNumber, nextPlan } from "@/lib/billing/present";
import { useWorkspaces, workspaceLabel, type WorkspaceSummary } from "@/hooks/use-workspaces";
import { workspacePath, WORKSPACES_HOME } from "@/lib/workspace/paths";
import { signOutAndRedirect } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { WorkspaceLogo } from "./WorkspaceLogo";
import { cn } from "@/lib/utils";

type Props = {
  workspaceName: string;
  workspaceId: string | null;
  trigger: ReactNode;
};

function initials(name: string) {
  const parts = name
    .trim()
    .split(/\s+|\.|-/)
    .filter(Boolean);
  return ((parts[0]?.[0] ?? "W") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function WorkspaceMenu({ workspaceName, workspaceId, trigger }: Props) {
  const navigate = useNavigate();
  const billing = useEntitlements();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [q, setQ] = useState("");
  const { data, isLoading: loading, isError, error, refetch } = useWorkspaces({ enabled: open });
  const workspaces = useMemo(() => data ?? [], [data]);
  const workspaceListFailed = isError && !data;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? workspaces.filter((w) => workspaceLabel(w).toLowerCase().includes(needle))
      : workspaces;
    // Current workspace first
    return [...list].sort((a, b) => {
      if (a.id === workspaceId) return -1;
      if (b.id === workspaceId) return 1;
      return 0;
    });
  }, [q, workspaces, workspaceId]);

  const pick = (w: WorkspaceSummary) => {
    setOpen(false);
    if (w.id === workspaceId) return;
    navigate({ to: workspacePath(w.id) });
  };

  // The real account balance (shared by all the owner's brands).
  const plan = asPlan(billing.data?.entitledPlan);
  const credits = billing.data?.meters.credits.available ?? 0;
  const allowance = plan === "free" ? SIGNUP_GRANT.credits : PLANS[plan].allowances.credits;
  const leftPct = allowance > 0 ? Math.max(0, Math.min(100, (credits / allowance) * 100)) : 0;
  const low = leftPct <= 20;
  const canUpgrade = Boolean(billing.data?.isOwner && nextPlan(plan));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={10}
        className="w-[300px] overflow-hidden rounded-2xl border border-border/60 bg-popover/95 p-0 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
      >
        {/* Back to workspaces dashboard */}
        <button
          onClick={() => {
            setOpen(false);
            navigate({ to: WORKSPACES_HOME });
          }}
          className="group flex w-full items-center gap-2 border-b border-border/60 px-3 py-2 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          aria-label="Back to workspaces dashboard"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          <span>Back to workspaces</span>
        </button>

        {/* Plan and credits (real account balance) */}
        {billing.data && (
          <div className="space-y-2 p-3">
            <div className="flex items-center justify-between gap-2 text-[12px]">
              <span className="font-semibold text-foreground">{PLANS[plan].label} plan</span>
              <span className="tabular-nums text-muted-foreground">
                <span className={cn("font-semibold", low ? "text-warning" : "text-foreground")}>
                  {formatNumber(credits)}
                </span>{" "}
                credits left
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--ds-well-bg)]">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(credits > 0 ? 3 : 0, leftPct)}%` }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className={cn("h-full rounded-full", low ? "bg-warning" : "bg-primary")}
              />
            </div>
            <div className="flex gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  emitAppEvent("open:usage");
                }}
                className="flex-1 rounded-full border border-border/70 px-2 py-1.5 text-[11.5px] font-medium text-foreground/85 transition-colors hover:bg-secondary"
              >
                Plan & billing
              </button>
              {billing.data.isOwner && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    emitAppEvent(
                      "open:upgrade",
                      canUpgrade && !low
                        ? undefined
                        : { code: "insufficient_balance", meter: "credits" },
                    );
                  }}
                  className="flex flex-1 items-center justify-center gap-1 rounded-full bg-primary px-2 py-1.5 text-[11.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <Gift className="h-3.5 w-3.5" strokeWidth={2.2} />
                  {canUpgrade && !low ? "Upgrade" : "Get credits"}
                </button>
              )}
            </div>
          </div>
        )}

        <div className="h-px bg-border/60" />

        {/* Workspaces */}
        <div className="flex items-center justify-between px-3 pb-1 pt-2">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/80">
            Workspaces
          </div>
        </div>

        <div className="mx-2 mb-2 flex items-center gap-2 rounded-lg border border-border/60 bg-card/50 px-2 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search workspaces…"
            className="flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>

        <div className="max-h-[260px] overflow-y-auto px-1.5 pb-1.5 [scrollbar-width:thin]">
          {loading && (
            <div className="space-y-1 px-1 py-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-9 animate-pulse rounded-lg bg-surface/60" />
              ))}
            </div>
          )}

          {!loading && workspaceListFailed && (
            <ErrorState
              size="sm"
              title="Workspaces didn't load"
              detail={error instanceof Error ? error.message : null}
              onRetry={() => void refetch()}
            />
          )}

          {!loading && !workspaceListFailed && filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
              No workspaces found
            </div>
          )}

          {!loading &&
            !workspaceListFailed &&
            filtered.map((w) => {
              const active = w.id === workspaceId;
              const name = workspaceLabel(w);
              return (
                <button
                  key={w.id}
                  onClick={() => pick(w)}
                  className={cn(
                    "group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors",
                    active
                      ? "bg-secondary text-foreground"
                      : "text-foreground/85 hover:bg-secondary/70",
                  )}
                >
                  <WorkspaceLogo name={name} websiteUrl={w.websiteUrl} size={28} />

                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{name}</span>
                  {active && (
                    <Check className="h-3.5 w-3.5 text-[hsl(var(--brand-green))]" aria-hidden />
                  )}
                </button>
              );
            })}
        </div>

        <div className="border-t border-border/60 p-1.5">
          <button
            onClick={() => {
              setOpen(false);
              navigate({ to: WORKSPACES_HOME });
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-[12.5px] font-medium text-foreground/85 transition-colors hover:bg-secondary/70 hover:text-foreground"
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-secondary/80 text-muted-foreground">
              <Plus className="h-3.5 w-3.5" aria-hidden />
            </span>
            <span className="flex-1 truncate">New workspace</span>
          </button>
          <button
            onClick={() => {
              setOpen(false);
              navigate({ to: WORKSPACES_HOME });
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-secondary/80 text-muted-foreground">
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
            </span>
            <span className="flex-1 truncate">Manage all workspaces</span>
          </button>
          <button
            onClick={async () => {
              if (signingOut) return;
              setSigningOut(true);
              setOpen(false);
              await signOutAndRedirect(queryClient);
            }}
            disabled={signingOut}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground disabled:opacity-60"
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-secondary/80 text-muted-foreground">
              {signingOut ? (
                <Spinner className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <LogOut className="h-3.5 w-3.5" aria-hidden />
              )}
            </span>
            <span className="flex-1 truncate">{signingOut ? "Signing out…" : "Sign out"}</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
