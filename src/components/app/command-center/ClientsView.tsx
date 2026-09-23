"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart,
  Calendar,
  Eye,
  LayoutGrid,
  Link as LinkIcon,
  List,
  MessageSquare,
  MoreHorizontal,
  Pause,
  Play,
  Plug,
  Plus,
  Search,
  Swords,
} from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/empty-state";
import { dsGhostBtn, dsIconBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { Link } from "@/lib/navigation";
import { WORKSPACES_HOME } from "@/lib/workspace/paths";
import { cn } from "@/lib/utils";
import { clientHealth, type CcClient } from "@/lib/agency/command-center";
import type { CommandCenter } from "./use-command-center";
import { ClientMark, HealthRing, TONE_TEXT, clientHref, type ClientDestination } from "./ui";

type Filter = "all" | "attention" | "active" | "onboarding" | "paused";
type Sort = "attention" | "name" | "recent" | "review";

const TOOLS: { dest: ClientDestination; label: string; icon: typeof Calendar }[] = [
  { dest: "home", label: "Chat", icon: MessageSquare },
  { dest: "calendar", label: "Calendar", icon: Calendar },
  { dest: "analytics", label: "Analytics", icon: BarChart },
  { dest: "visibility", label: "AI visibility", icon: Eye },
  { dest: "competitors", label: "Competitors", icon: Swords },
  { dest: "backlinks", label: "Backlinks", icon: LinkIcon },
];

export function ClientsView({
  cc,
  onGo,
  onReviewClient,
  onBrief,
}: {
  cc: CommandCenter;
  onGo: (href: string) => void;
  onReviewClient: (id: string) => void;
  onBrief: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("attention");
  const [layout, setLayout] = useState<"grid" | "list">(() => {
    try {
      return localStorage.getItem("cc:clients-layout") === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });
  const setLayoutSaved = (l: "grid" | "list") => {
    setLayout(l);
    try {
      localStorage.setItem("cc:clients-layout", l);
    } catch {
      /* per-viewer convenience only */
    }
  };

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return cc.clients
      .map((c) => ({ c, h: clientHealth(c) }))
      .filter(({ c, h }) => {
        if (filter === "attention" && (h.tone === "good" || h.tone === "idle")) return false;
        if (filter !== "all" && filter !== "attention" && c.clientStatus !== filter) return false;
        if (!needle) return true;
        return [c.name, c.domain, c.industry].some((v) => v?.toLowerCase().includes(needle));
      })
      .sort((a, b) => {
        if (sort === "name") return a.c.name.localeCompare(b.c.name);
        if (sort === "recent")
          return new Date(b.c.lastActivityAt).getTime() - new Date(a.c.lastActivityAt).getTime();
        if (sort === "review")
          return b.c.pendingApprovals + b.c.draftCount - (a.c.pendingApprovals + a.c.draftCount);
        const rank = (t: string) => (t === "idle" ? 999 : 0);
        return a.h.score + rank(a.h.tone) - (b.h.score + rank(b.h.tone));
      });
  }, [cc.clients, q, filter, sort]);

  const counts = useMemo(() => {
    const hs = cc.clients.map((c) => ({ c, h: clientHealth(c) }));
    return {
      all: hs.length,
      attention: hs.filter(({ h }) => h.tone === "warn" || h.tone === "risk").length,
      active: hs.filter(({ c }) => c.clientStatus === "active").length,
      onboarding: hs.filter(({ c }) => c.clientStatus === "onboarding").length,
      paused: hs.filter(({ c }) => c.clientStatus === "paused").length,
    };
  }, [cc.clients]);

  return (
    <div className="ds-enter">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex h-10 flex-1 items-center gap-2 rounded-full border border-border/70 bg-card px-4 focus-within:border-primary/50 md:max-w-sm">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search clients"
            className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(
            [
              ["all", "All"],
              ["attention", "Needs attention"],
              ["active", "Active"],
              ["onboarding", "Onboarding"],
              ["paused", "Paused"],
            ] as [Filter, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              aria-pressed={filter === id}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-all",
                filter === id
                  ? "border-foreground bg-foreground text-background"
                  : "border-border/70 bg-card text-foreground/80 hover:border-foreground/25",
              )}
            >
              {label}
              <span
                className={cn(
                  "tabular-nums",
                  filter === id ? "text-background/70" : "text-muted-foreground",
                )}
              >
                {counts[id]}
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 md:ml-auto">
          <select
            aria-label="Sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="h-8 rounded-full border border-border/70 bg-card px-3 text-[12.5px] outline-none"
          >
            <option value="attention">Needs attention first</option>
            <option value="review">Most to review</option>
            <option value="recent">Recently active</option>
            <option value="name">Name</option>
          </select>
          <div className="ds-well flex rounded-full p-0.5">
            {(["grid", "list"] as const).map((l) => (
              <button
                key={l}
                aria-label={l === "grid" ? "Grid" : "List"}
                aria-pressed={layout === l}
                onClick={() => setLayoutSaved(l)}
                className={cn(
                  "grid h-7 w-8 place-items-center rounded-full transition",
                  layout === l
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground",
                )}
              >
                {l === "grid" ? (
                  <LayoutGrid className="h-3.5 w-3.5" />
                ) : (
                  <List className="h-3.5 w-3.5" />
                )}
              </button>
            ))}
          </div>
          <Link to={WORKSPACES_HOME} className={cn(dsPrimaryBtn, "h-8 px-3.5 text-[12.5px]")}>
            <Plus className="h-3.5 w-3.5" /> Add client
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="ds-tile mt-4 py-6">
          <EmptyState
            icon={Search}
            title={cc.clients.length === 0 ? "No clients yet" : "No clients match"}
            action={
              cc.clients.length === 0 ? (
                <Link to={WORKSPACES_HOME} className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px]")}>
                  <Plus className="h-3.5 w-3.5" /> Add a client
                </Link>
              ) : (
                <button
                  className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")}
                  onClick={() => {
                    setQ("");
                    setFilter("all");
                  }}
                >
                  Clear filters
                </button>
              )
            }
          />
        </div>
      ) : layout === "grid" ? (
        <motion.div layout className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence initial={false}>
            {rows.map(({ c }, i) => (
              <ClientCard
                key={c.id}
                client={c}
                index={i}
                cc={cc}
                onGo={onGo}
                onReviewClient={onReviewClient}
                onBrief={onBrief}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      ) : (
        <div className="ds-tile mt-4 overflow-hidden">
          <div className="hidden grid-cols-[minmax(0,2.2fr)_repeat(5,minmax(0,0.8fr))_auto] gap-3 border-b border-[var(--ds-tile-border)] px-4 py-2.5 text-[11.5px] font-medium text-muted-foreground md:grid">
            <span>Client</span>
            <span>Health</span>
            <span className="text-right">Review</span>
            <span className="text-right">Scheduled</span>
            <span className="text-right">Published</span>
            <span className="text-right">AI score</span>
            <span className="w-8" />
          </div>
          <ul>
            {rows.map(({ c, h }) => (
              <li
                key={c.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--ds-tile-border)] px-4 py-3 last:border-0 hover:bg-[var(--ds-well-bg)] md:grid-cols-[minmax(0,2.2fr)_repeat(5,minmax(0,0.8fr))_auto]"
              >
                <button
                  onClick={() => onGo(clientHref(c, "home"))}
                  className="flex min-w-0 items-center gap-3 text-left"
                >
                  <ClientMark client={c} size={32} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-medium">{c.name}</span>
                    <span className="block truncate text-[11.5px] text-muted-foreground">
                      {c.domain ?? "No website yet"}
                    </span>
                  </span>
                </button>
                <span
                  className={cn("hidden text-[12.5px] font-medium md:block", TONE_TEXT[h.tone])}
                >
                  {h.label}
                </span>
                <Num v={c.pendingApprovals + c.draftCount} onClick={() => onReviewClient(c.id)} />
                <Num v={c.scheduledCount} />
                <Num v={c.publishedCount} />
                <span className="hidden text-right text-[13px] tabular-nums md:block">
                  {c.geoScore ?? "—"}
                </span>
                <ClientMenu client={c} cc={cc} onGo={onGo} onBrief={onBrief} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Num({ v, onClick }: { v: number; onClick?: () => void }) {
  const cls = cn(
    "hidden text-right text-[13px] tabular-nums md:block",
    v === 0 && "text-muted-foreground",
  );
  if (onClick && v > 0) {
    return (
      <button onClick={onClick} className={cn(cls, "font-semibold hover:underline")}>
        {v}
      </button>
    );
  }
  return <span className={cls}>{v}</span>;
}

function ClientCard({
  client: c,
  index,
  cc,
  onGo,
  onReviewClient,
  onBrief,
}: {
  client: CcClient;
  index: number;
  cc: CommandCenter;
  onGo: (href: string) => void;
  onReviewClient: (id: string) => void;
  onBrief: (id: string) => void;
}) {
  const h = clientHealth(c);
  const review = c.pendingApprovals + c.draftCount;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { delay: Math.min(index, 8) * 0.035, duration: 0.35, ease: [0.16, 1, 0.3, 1] },
      }}
      exit={{ opacity: 0, scale: 0.97 }}
      className="ds-tile ds-tile-hover group relative flex flex-col p-4"
    >
      <div className="flex items-start gap-3">
        <button
          onClick={() => onGo(clientHref(c, "home"))}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <ClientMark client={c} size={40} />
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold tracking-tight">
              {c.name}
            </span>
            <span className="block truncate text-[12px] text-muted-foreground">
              {c.domain ?? "No website yet"}
            </span>
          </span>
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <HealthRing score={h.score} tone={h.tone} size={40}>
                <span className="text-[11px] font-semibold tabular-nums">
                  {h.tone === "idle" ? "—" : h.score}
                </span>
              </HealthRing>
            </span>
          </TooltipTrigger>
          <TooltipContent side="left">
            {h.label}
            {h.reasons.length > 0 && ` · ${h.reasons.join(" · ")}`}
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="mt-2 flex min-h-[22px] flex-wrap items-center gap-1.5">
        <span className={cn("text-[12px] font-medium", TONE_TEXT[h.tone])}>{h.label}</span>
        {h.reasons
          .filter((r) => r !== h.label)
          .slice(0, 2)
          .map((r) => (
            <span
              key={r}
              className="rounded-full bg-[var(--ds-well-bg)] px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              {r}
            </span>
          ))}
      </div>

      <div className="mt-4 grid grid-cols-4 gap-1.5">
        <Metric
          label="Review"
          value={review}
          strong={review > 0}
          onClick={review > 0 ? () => onReviewClient(c.id) : undefined}
        />
        <Metric label="Scheduled" value={c.scheduledCount} />
        <Metric label="Posted" value={c.publishedCount} />
        <Metric label="AI score" value={c.geoScore} />
      </div>

      <div className="mt-4 flex items-center gap-0.5 border-t border-[var(--ds-tile-border)] pt-3">
        {TOOLS.map((t) => (
          <Tooltip key={t.dest}>
            <TooltipTrigger asChild>
              <button
                aria-label={`${t.label} for ${c.name}`}
                onClick={() => onGo(clientHref(c, t.dest))}
                className={dsIconBtn}
              >
                <t.icon className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t.label}</TooltipContent>
          </Tooltip>
        ))}
        <div className="ml-auto">
          <ClientMenu client={c} cc={cc} onGo={onGo} onBrief={onBrief} />
        </div>
      </div>
    </motion.div>
  );
}

function Metric({
  label,
  value,
  strong,
  onClick,
}: {
  label: string;
  value: number | null;
  strong?: boolean;
  onClick?: () => void;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={cn(
        "ds-well px-2 py-2 text-left",
        onClick && "transition hover:bg-[var(--ds-well-bg-hover)]",
      )}
    >
      <div
        className={cn(
          "text-[16px] font-semibold tabular-nums leading-none",
          strong && "text-foreground",
          value === 0 || value === null ? "text-muted-foreground" : "",
        )}
      >
        {value ?? "—"}
      </div>
      <div className="mt-1 truncate text-[10.5px] text-muted-foreground">{label}</div>
    </Comp>
  );
}

function ClientMenu({
  client: c,
  cc,
  onGo,
  onBrief,
}: {
  client: CcClient;
  cc: CommandCenter;
  onGo: (href: string) => void;
  onBrief: (id: string) => void;
}) {
  const canManage = c.role === "owner" || c.role === "admin";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button aria-label={`More for ${c.name}`} className={dsIconBtn}>
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52 rounded-2xl p-1.5">
        <DropdownMenuItem className="gap-2 rounded-xl" onSelect={() => onBrief(c.id)}>
          <MessageSquare className="h-4 w-4" /> Ask Mellox
        </DropdownMenuItem>
        <DropdownMenuItem
          className="gap-2 rounded-xl"
          onSelect={() => onGo(clientHref(c, "accounts"))}
        >
          <Plug className="h-4 w-4" /> Connected accounts
        </DropdownMenuItem>
        {canManage && (
          <>
            <DropdownMenuSeparator />
            {c.clientStatus === "paused" ? (
              <DropdownMenuItem
                className="gap-2 rounded-xl"
                onSelect={() => void cc.setClientStatus(c.id, "active")}
              >
                <Play className="h-4 w-4" /> Mark active
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                className="gap-2 rounded-xl"
                onSelect={() => void cc.setClientStatus(c.id, "paused")}
              >
                <Pause className="h-4 w-4" /> Pause client
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
