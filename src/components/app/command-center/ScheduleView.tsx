"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Calendar, Spinner, X } from "@/components/icons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { dsGhostBtn, dsIconBtn } from "@/components/app/surface/buttons";
import { cn } from "@/lib/utils";
import { dayLabel, type ReviewItem } from "@/lib/agency/command-center";
import type { CommandCenter } from "./use-command-center";
import { ChannelMark, ClientTag, channelLabel, clientHref, timeOf } from "./ui";

export function ScheduleView({
  cc,
  clientFilter,
  onGo,
}: {
  cc: CommandCenter;
  clientFilter: string;
  onGo: (href: string) => void;
}) {
  const [cancelling, setCancelling] = useState<ReviewItem | null>(null);
  const days = cc.schedule
    .map((d) => ({
      ...d,
      items: d.items.filter((i) => clientFilter === "all" || i.workspaceId === clientFilter),
    }))
    .filter((d) => d.items.length > 0);
  const total = days.reduce((n, d) => n + d.items.length, 0);

  return (
    <div className="ds-enter">
      <p className="mb-4 text-[13px] text-muted-foreground">
        {total === 0
          ? "Nothing scheduled in the next 14 days."
          : `${total} post${total === 1 ? "" : "s"} going out in the next 14 days.`}
      </p>

      {days.length === 0 ? (
        <div className="ds-tile py-6">
          <EmptyState
            icon={Calendar}
            title="Nothing scheduled"
            description="Approve drafts, then schedule them from Ready to post."
          />
        </div>
      ) : (
        <ol className="relative space-y-6 border-l border-[var(--ds-tile-border)] pl-5 sm:pl-7">
          {days.map((day, di) => (
            <motion.li
              key={day.key}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: { delay: Math.min(di, 6) * 0.05 } }}
            >
              <span
                className={cn(
                  "absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-background",
                  di === 0 ? "bg-primary" : "bg-border",
                )}
              />
              <div className="mb-2 flex items-baseline gap-2">
                <h3 className="text-[14px] font-semibold">{dayLabel(day.date, cc.now)}</h3>
                <span className="text-[12px] text-muted-foreground">{day.items.length}</span>
              </div>
              <ul className="space-y-1.5">
                <AnimatePresence initial={false}>
                  {day.items.map((it) => {
                    const client = cc.clientMap.get(it.workspaceId);
                    const busy = cc.busy.has(it.id);
                    return (
                      <motion.li
                        key={it.id}
                        layout
                        exit={{ opacity: 0, x: 30 }}
                        className="ds-tile group flex items-center gap-3 px-3 py-2.5"
                      >
                        <span className="w-16 shrink-0 text-[12.5px] font-semibold tabular-nums">
                          {timeOf(it.scheduledAt)}
                        </span>
                        <ChannelMark channel={it.channel} size={30} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium">
                            {it.title}
                          </span>
                          <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                            <ClientTag name={it.clientName} />
                            {channelLabel(it.channel)}
                          </span>
                        </span>
                        {busy ? (
                          <Spinner className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : (
                          <div className="flex items-center gap-0.5 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                            {client && (
                              <button
                                aria-label="Open calendar"
                                title="Open calendar"
                                onClick={() => onGo(clientHref(client, "calendar"))}
                                className={dsIconBtn}
                              >
                                <ArrowUpRight className="h-4 w-4" />
                              </button>
                            )}
                            {it.canDecide && (
                              <button
                                aria-label="Cancel schedule"
                                title="Cancel schedule"
                                onClick={() => setCancelling(it)}
                                className={cn(dsIconBtn, "hover:text-destructive")}
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
            </motion.li>
          ))}
        </ol>
      )}

      {cc.clients.length > 0 && (
        <div className="mt-8">
          <div className="ds-label mb-2">Open a calendar</div>
          <div className="flex flex-wrap gap-2">
            {cc.clients
              .filter((c) => c.clientStatus !== "paused")
              .map((c) => (
                <button
                  key={c.id}
                  onClick={() => onGo(clientHref(c, "calendar"))}
                  className={cn(dsGhostBtn, "h-8 px-3 text-[12.5px]")}
                >
                  <Calendar className="h-3.5 w-3.5" /> {c.name}
                </button>
              ))}
          </div>
        </div>
      )}

      <AlertDialog open={!!cancelling} onOpenChange={(o) => !o && setCancelling(null)}>
        <AlertDialogContent className="rounded-[28px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this post?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelling?.clientName} · {cancelling?.title}. It won&apos;t go out, and it moves
              back to Ready to post.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (cancelling) void cc.unschedule(cancelling);
                setCancelling(null);
              }}
            >
              Cancel post
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
