"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Sparkles, Spinner } from "@/components/icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { dsGhostBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { cn } from "@/lib/utils";
import type { CommandCenter } from "./use-command-center";
import { ClientMark } from "./ui";

/**
 * Drafting spends AI credits, so it only ever runs from here — an explicit
 * choice of clients and a click. The page never drafts on its own.
 */
export function DraftWeekDialog({
  cc,
  open,
  onOpenChange,
  onDone,
}: {
  cc: CommandCenter;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const eligible = useMemo(
    () => cc.clients.filter((c) => c.role !== "viewer" && c.onboarded),
    [cc.clients],
  );
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Default: active clients with nothing waiting for review.
    setPicked(
      new Set(
        eligible
          .filter((c) => c.clientStatus === "active" && c.pendingApprovals + c.draftCount === 0)
          .map((c) => c.id),
      ),
    );
  }, [open, eligible]);

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <Dialog open={open} onOpenChange={(o) => !running && onOpenChange(o)}>
      <DialogContent className="max-w-md rounded-[28px] p-0">
        <DialogHeader className="p-5 pb-2">
          <span className="mb-2 grid h-10 w-10 place-items-center rounded-full bg-primary/15">
            <Sparkles className="h-5 w-5" />
          </span>
          <DialogTitle>Draft a week of posts</DialogTitle>
          <DialogDescription>
            4 drafts per client, in each brand&apos;s own voice. They land in Review. Uses AI
            credits.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[46vh] overflow-y-auto px-3">
          {eligible.length === 0 ? (
            <p className="px-2 py-4 text-[13px] text-muted-foreground">
              No clients you can draft for yet. Finish a client&apos;s setup first.
            </p>
          ) : (
            <ul className="space-y-1">
              {eligible.map((c) => {
                const on = picked.has(c.id);
                const drafting = cc.drafting.has(c.id);
                const waiting = c.pendingApprovals + c.draftCount;
                return (
                  <li key={c.id}>
                    <button
                      disabled={running}
                      onClick={() => toggle(c.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left transition",
                        on ? "bg-[var(--ds-well-bg-hover)]" : "hover:bg-[var(--ds-well-bg)]",
                      )}
                    >
                      <ClientMark client={c} size={30} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium">{c.name}</span>
                        <span className="block text-[11.5px] text-muted-foreground">
                          {c.clientStatus === "paused"
                            ? "Paused"
                            : waiting
                              ? `${waiting} already waiting`
                              : "Nothing waiting"}
                        </span>
                      </span>
                      {drafting ? (
                        <Spinner className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : (
                        <span
                          className={cn(
                            "grid h-5 w-5 place-items-center rounded-full border transition",
                            on
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border",
                          )}
                        >
                          {on && <Check className="h-3 w-3" strokeWidth={3} />}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border/60 p-4">
          <span className="text-[12px] text-muted-foreground">
            {picked.size ? `${picked.size * 4} drafts` : "Pick clients"}
          </span>
          <div className="flex gap-2">
            <button
              disabled={running}
              onClick={() => onOpenChange(false)}
              className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")}
            >
              Cancel
            </button>
            <button
              disabled={running || picked.size === 0}
              onClick={async () => {
                setRunning(true);
                await cc.draftWeek([...picked]);
                setRunning(false);
                onOpenChange(false);
                onDone();
              }}
              className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px]")}
            >
              {running ? (
                <Spinner className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {running ? "Drafting…" : `Draft for ${picked.size || ""}`.trim()}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
