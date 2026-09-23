"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUp,
  Calendar,
  CheckCircle,
  ChevronDown,
  Eye,
  Inbox,
  Plug,
  Rocket,
  Settings,
  Sparkles,
  Users,
} from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { dsGhostBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { cn } from "@/lib/utils";
import { clientHealth, dayLabel, type AttentionItem } from "@/lib/agency/command-center";
import type { CommandCenter } from "./use-command-center";
import type { QueueTab } from "./ReviewView";
import {
  ChannelMark,
  ClientMark,
  ClientTag,
  HealthRing,
  SectionTitle,
  StatTile,
  clientHref,
  handPromptTo,
  timeOf,
} from "./ui";

const ACTION_ICON: Record<AttentionItem["action"], typeof Inbox> = {
  review: Inbox,
  ready: Rocket,
  failed: AlertTriangle,
  setup: Settings,
  accounts: Plug,
  calendar: Calendar,
  visibility: Eye,
};

const PROMPT_IDEAS = [
  "Plan next week's posts",
  "Write a LinkedIn post about our latest news",
  "What are competitors doing this month?",
  "Give me 5 blog ideas that could rank",
];

export function OverviewView({
  cc,
  greeting,
  briefClient,
  onBriefClient,
  onQueue,
  onGo,
  onClients,
  onSchedule,
  onDraftWeek,
}: {
  cc: CommandCenter;
  greeting: string;
  briefClient: string | null;
  onBriefClient: (id: string) => void;
  onQueue: (tab: QueueTab, clientId?: string) => void;
  onGo: (href: string) => void;
  onClients: () => void;
  onSchedule: () => void;
  onDraftWeek: () => void;
}) {
  const scheduledCount = cc.schedule.reduce((n, d) => n + d.items.length, 0);
  const needs = cc.attention.length;
  const upNext = cc.schedule
    .flatMap((d) => d.items.map((i) => ({ ...i, day: d.date })))
    .slice(0, 6);

  const act = (a: AttentionItem) => {
    if (a.action === "review" || a.action === "ready" || a.action === "failed") {
      onQueue(a.action);
      return;
    }
    const c = a.workspaceId ? cc.clientMap.get(a.workspaceId) : undefined;
    if (!c) return;
    const dest =
      a.action === "accounts"
        ? "accounts"
        : a.action === "calendar"
          ? "calendar"
          : a.action === "visibility"
            ? "visibility"
            : "home";
    onGo(clientHref(c, dest));
  };

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="ds-enter pt-2 text-center sm:pt-6">
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="font-display text-[32px] leading-[1.1] tracking-tight sm:text-[44px]"
        >
          {greeting}
          {cc.userName ? `, ${cc.userName}` : ""}
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.12 }}
          className="mt-2 text-[14.5px] text-muted-foreground"
        >
          {cc.clients.length === 0
            ? "Add your first client to get started."
            : needs === 0
              ? `All ${cc.clients.length} clients are on track.`
              : `${needs} thing${needs === 1 ? "" : "s"} need${needs === 1 ? "s" : ""} you across ${cc.clients.length} client${cc.clients.length === 1 ? "" : "s"}.`}
        </motion.p>

        {cc.clients.length > 0 && (
          <BriefComposer
            cc={cc}
            clientId={briefClient}
            onClient={onBriefClient}
            onSend={(id, text) => {
              const c = cc.clientMap.get(id);
              if (!c) return;
              handPromptTo(id, text);
              onGo(clientHref(c, "home"));
            }}
          />
        )}
      </section>

      {/* Pulse */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          icon={<Inbox className="h-4 w-4" />}
          label="To review"
          value={cc.review.length}
          tone={cc.review.length ? "warn" : "neutral"}
          onClick={() => onQueue("review")}
        />
        <StatTile
          icon={<Rocket className="h-4 w-4" />}
          label="Ready to post"
          value={cc.ready.length}
          tone={cc.ready.length ? "primary" : "neutral"}
          onClick={() => onQueue("ready")}
        />
        <StatTile
          icon={<Calendar className="h-4 w-4" />}
          label="Scheduled, 14 days"
          value={scheduledCount}
          onClick={onSchedule}
        />
        {cc.failed.length > 0 ? (
          <StatTile
            icon={<AlertTriangle className="h-4 w-4" />}
            label="Didn't go out"
            value={cc.failed.length}
            tone="risk"
            onClick={() => onQueue("failed")}
          />
        ) : (
          <StatTile
            icon={<Users className="h-4 w-4" />}
            label="Active clients"
            value={cc.clients.filter((c) => c.clientStatus === "active").length}
            sub={`of ${cc.clients.length}`}
            onClick={onClients}
          />
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {/* Needs you */}
        <div>
          <SectionTitle
            title="Needs you"
            count={needs}
            action={
              cc.clients.some((c) => c.role !== "viewer") && (
                <button onClick={onDraftWeek} className={cn(dsGhostBtn, "h-8 px-3 text-[12.5px]")}>
                  <Sparkles className="h-3.5 w-3.5" /> Draft a week
                </button>
              )
            }
          />
          {needs === 0 ? (
            <div className="ds-tile flex items-center gap-3 p-4">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-primary/15">
                <CheckCircle className="h-4 w-4" />
              </span>
              <div>
                <div className="text-[13.5px] font-medium">You&apos;re all caught up</div>
                <div className="text-[12px] text-muted-foreground">New work will show up here.</div>
              </div>
            </div>
          ) : (
            <ul className="space-y-2">
              <AnimatePresence initial={false}>
                {cc.attention.slice(0, 8).map((a, i) => {
                  const Icon = ACTION_ICON[a.action];
                  const c = a.workspaceId ? cc.clientMap.get(a.workspaceId) : undefined;
                  return (
                    <motion.li
                      key={a.key}
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 6) * 0.04 } }}
                      exit={{ opacity: 0, x: 30 }}
                    >
                      <button
                        onClick={() => act(a)}
                        className="ds-tile ds-tile-hover group flex w-full items-center gap-3 p-3 text-left"
                      >
                        {c ? (
                          <span className="relative">
                            <ClientMark client={c} size={36} />
                            <span
                              className={cn(
                                "absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full ring-2 ring-background",
                                a.tone === "risk" && "bg-destructive text-destructive-foreground",
                                a.tone === "warn" && "bg-warning text-background",
                                a.tone === "info" && "bg-foreground text-background",
                              )}
                            >
                              <Icon className="h-3 w-3" />
                            </span>
                          </span>
                        ) : (
                          <span
                            className={cn(
                              "grid h-9 w-9 shrink-0 place-items-center rounded-full",
                              a.tone === "risk" && "bg-destructive/12 text-destructive",
                              a.tone === "warn" && "bg-warning/12 text-warning",
                              a.tone === "info" && "bg-primary/15 text-foreground",
                            )}
                          >
                            <Icon className="h-4 w-4" />
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium">
                            {a.title}
                          </span>
                          <span className="block truncate text-[12px] text-muted-foreground">
                            {a.detail}
                          </span>
                        </span>
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--ds-well-bg)] px-3 py-1.5 text-[12px] font-semibold transition group-hover:bg-primary group-hover:text-primary-foreground">
                          {a.cta} <ArrowRight className="h-3 w-3" />
                        </span>
                      </button>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          )}
        </div>

        {/* Up next */}
        <div>
          <SectionTitle
            title="Up next"
            action={
              <button
                onClick={onSchedule}
                className="text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
              >
                See all
              </button>
            }
          />
          <div className="ds-tile p-2">
            {upNext.length === 0 ? (
              <div className="p-4 text-[12.5px] text-muted-foreground">Nothing scheduled yet.</div>
            ) : (
              <ul>
                {upNext.map((it) => (
                  <li key={it.id} className="flex items-center gap-3 rounded-2xl px-2 py-2">
                    <div className="w-[70px] shrink-0 text-right">
                      <div className="text-[12.5px] font-semibold tabular-nums">
                        {timeOf(it.scheduledAt)}
                      </div>
                      <div className="truncate text-[10.5px] text-muted-foreground">
                        {["Today", "Tomorrow"].includes(dayLabel(it.day, cc.now))
                          ? dayLabel(it.day, cc.now)
                          : it.day.toLocaleDateString(undefined, {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            })}
                      </div>
                    </div>
                    <ChannelMark channel={it.channel} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{it.title}</div>
                      <ClientTag name={it.clientName} className="mt-0.5" />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* Clients at a glance */}
      {cc.clients.length > 0 && (
        <section>
          <SectionTitle
            title="Clients"
            count={cc.clients.length}
            action={
              <button
                onClick={onClients}
                className="text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
              >
                Manage all
              </button>
            }
          />
          <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {cc.clients.map((c, i) => {
              const h = clientHealth(c);
              const review = c.pendingApprovals + c.draftCount;
              return (
                <motion.button
                  key={c.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 8) * 0.04 } }}
                  whileHover={{ y: -3 }}
                  onClick={() => onGo(clientHref(c, "home"))}
                  className="ds-tile ds-tile-hover flex w-[200px] shrink-0 snap-start flex-col items-center gap-2 p-4 text-center"
                >
                  <HealthRing score={h.score} tone={h.tone} size={60}>
                    <ClientMark client={c} size={38} />
                  </HealthRing>
                  <div className="w-full truncate text-[13.5px] font-semibold">{c.name}</div>
                  <div className="text-[11.5px] text-muted-foreground">
                    {review > 0 ? `${review} to review` : h.label}
                  </div>
                </motion.button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function BriefComposer({
  cc,
  clientId,
  onClient,
  onSend,
}: {
  cc: CommandCenter;
  clientId: string | null;
  onClient: (id: string) => void;
  onSend: (clientId: string, text: string) => void;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const client = (clientId && cc.clientMap.get(clientId)) || cc.clients[0];
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(160, el.scrollHeight)}px`;
  }, [text]);
  const send = () => {
    const t = text.trim();
    if (!t || !client) return;
    onSend(client.id, t);
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: 0.15, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="relative mx-auto mt-7 max-w-2xl text-left"
    >
      <div
        aria-hidden
        className="ds-glow pointer-events-none absolute -inset-6 rounded-[40px] opacity-80 blur-2xl"
      />
      <div className="relative rounded-[28px] border border-border/70 bg-card p-2 shadow-[var(--ds-window-shadow)] transition focus-within:border-primary/50">
        <textarea
          ref={ref}
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={client ? `Ask Mellox to do something for ${client.name}` : "Ask Mellox"}
          aria-label="Ask Mellox"
          className="block w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-2 px-1 pt-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="inline-flex h-9 max-w-[220px] items-center gap-2 rounded-full bg-[var(--ds-well-bg)] pl-1.5 pr-3 text-[13px] font-medium transition hover:bg-[var(--ds-well-bg-hover)]">
                {client && <ClientMark client={client} size={24} />}
                <span className="truncate">{client?.name}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-80 w-64 overflow-y-auto rounded-2xl p-1.5"
            >
              {cc.clients.map((c) => (
                <DropdownMenuItem
                  key={c.id}
                  className="gap-2.5 rounded-xl py-2"
                  onSelect={() => onClient(c.id)}
                >
                  <ClientMark client={c} size={22} />
                  <span className="truncate">{c.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            aria-label="Send"
            onClick={send}
            disabled={!text.trim()}
            className={cn(dsPrimaryBtn, "ml-auto h-9 w-9 p-0")}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="relative mt-3 flex flex-wrap justify-center gap-2">
        {PROMPT_IDEAS.map((p) => (
          <button
            key={p}
            onClick={() => {
              setText(p);
              ref.current?.focus();
            }}
            className="rounded-full border border-border/70 bg-card/70 px-3 py-1.5 text-[12.5px] text-foreground/80 backdrop-blur transition hover:border-foreground/25 hover:text-foreground"
          >
            {p}
          </button>
        ))}
      </div>
    </motion.div>
  );
}
