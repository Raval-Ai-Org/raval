"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MotionConfig, motion } from "framer-motion";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart,
  Calendar,
  Command as CommandIcon,
  Copy,
  Download,
  Eye,
  FileText,
  Inbox,
  LayoutDashboard,
  Link as LinkIcon,
  MessageSquare,
  Plus,
  Rocket,
  Search,
  Sparkles,
  Swords,
  Users,
} from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Logo } from "@/components/brand/Logo";
import { dsGhostBtn, dsIconBtn } from "@/components/app/surface/buttons";
import { Link, useNavigate } from "@/lib/navigation";
import { WORKSPACES_HOME } from "@/lib/workspace/paths";
import { cn } from "@/lib/utils";
import { buildDigest, digestToCsv, digestToText } from "@/lib/agency/command-center";
import { useCommandCenter } from "./use-command-center";
import { OverviewView } from "./OverviewView";
import { ReviewView, type QueueTab } from "./ReviewView";
import { ClientsView } from "./ClientsView";
import { ScheduleView } from "./ScheduleView";
import { PerformanceView } from "./PerformanceView";
import { CommandPalette, type PaletteEntry } from "./CommandPalette";
import { DraftWeekDialog } from "./DraftWeekDialog";
import { ClientMark, clientHref } from "./ui";

type View = "overview" | "review" | "clients" | "schedule" | "performance";
const VIEWS: View[] = ["overview", "review", "clients", "schedule", "performance"];
const QUEUES: QueueTab[] = ["review", "ready", "failed"];

export function CommandCenter() {
  const cc = useCommandCenter();
  const navigate = useNavigate();
  const [view, setView] = useState<View>("overview");
  const [queue, setQueue] = useState<QueueTab>("review");
  const [clientFilter, setClientFilter] = useState("all");
  const [briefClient, setBriefClient] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [greeting, setGreeting] = useState("Hello");

  // Greeting on the client only (no SSR/CSR mismatch).
  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
  }, []);

  // View state lives in the URL so a view can be linked and survives refresh.
  useEffect(() => {
    const p = new URL(window.location.href).searchParams;
    const v = p.get("view");
    const qv = p.get("queue");
    const c = p.get("client");
    if (v && (VIEWS as string[]).includes(v)) setView(v as View);
    if (qv && (QUEUES as string[]).includes(qv)) setQueue(qv as QueueTab);
    if (c) setClientFilter(c);
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    const set = (k: string, v: string | null) =>
      v ? url.searchParams.set(k, v) : url.searchParams.delete(k);
    set("view", view === "overview" ? null : view);
    set("queue", view === "review" && queue !== "review" ? queue : null);
    set(
      "client",
      (view === "review" || view === "schedule") && clientFilter !== "all" ? clientFilter : null,
    );
    const next = `${url.pathname}${url.search}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(window.history.state, "", next);
    }
  }, [view, queue, clientFilter]);

  // A filter pointing at a client the caller no longer has falls back to all.
  useEffect(() => {
    if (clientFilter !== "all" && cc.clients.length && !cc.clientMap.has(clientFilter)) {
      setClientFilter("all");
    }
  }, [clientFilter, cc.clients.length, cc.clientMap]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = useCallback((href: string) => navigate({ to: href }), [navigate]);
  const openQueue = (tab: QueueTab, clientId?: string) => {
    setQueue(tab);
    setClientFilter(clientId ?? "all");
    setView("review");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const switchView = (v: View) => {
    setView(v);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const brief = (id: string) => {
    setBriefClient(id);
    switchView("overview");
    window.setTimeout(
      () =>
        document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask Mellox"]')?.focus(),
      350,
    );
  };

  /* ---------------- Report ---------------- */
  const digest = () =>
    buildDigest({
      clients: cc.clients,
      review: cc.review,
      ready: cc.ready,
      failed: cc.failed,
      scheduled: cc.stats.scheduledNext14,
      published14: cc.stats.published14,
      now: Date.now(),
    });
  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(digestToText(digest()));
      toast.success("Report copied", { description: "Paste it into Slack or an email." });
    } catch {
      toast.error("Couldn't copy", { description: "Your browser blocked the clipboard." });
    }
  };
  const downloadCsv = () => {
    const blob = new Blob([digestToCsv(digest())], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mellox-clients-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success("CSV downloaded");
  };
  const printReport = () => {
    const d = digest();
    const esc = (s: string | number) =>
      String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    const w = window.open("", "_blank", "width=900,height=1000");
    if (!w) {
      toast.error("Pop-up blocked", { description: "Allow pop-ups to print the report." });
      return;
    }
    w.document
      .write(`<!doctype html><html><head><meta charset="utf-8"><title>Client report — ${esc(d.dateLabel)}</title>
<style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#111;margin:40px;line-height:1.5}
h1{font-size:22px;margin:0}.sub{color:#666;font-size:13px;margin:2px 0 24px}
.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:24px}
.s{border:1px solid #e5e5e5;border-radius:14px;padding:12px}.n{font-size:22px;font-weight:600}.l{font-size:11px;color:#666}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid #eee}
th{font-size:11px;color:#666;font-weight:600}td.r,th.r{text-align:right}h2{font-size:14px;margin:28px 0 8px}
li{font-size:13px;margin:4px 0}.foot{margin-top:32px;color:#999;font-size:11px}</style></head><body>
<h1>Client report</h1><div class="sub">${esc(d.dateLabel)} · Mellox AI</div>
<div class="stats"><div class="s"><div class="n">${d.clients}</div><div class="l">Clients</div></div>
<div class="s"><div class="n">${d.review}</div><div class="l">To review</div></div>
<div class="s"><div class="n">${d.ready}</div><div class="l">Ready to post</div></div>
<div class="s"><div class="n">${d.scheduled}</div><div class="l">Scheduled, 14 days</div></div>
<div class="s"><div class="n">${d.published14}</div><div class="l">Posted, 14 days</div></div></div>
<table><thead><tr><th>Client</th><th>Health</th><th class="r">To review</th><th class="r">Scheduled</th><th class="r">Published</th></tr></thead><tbody>
${d.perClient.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.health)}</td><td class="r">${c.review}</td><td class="r">${c.scheduled}</td><td class="r">${c.published}</td></tr>`).join("")}
</tbody></table>
${d.waiting.length ? `<h2>Waiting for review</h2><ul>${d.waiting.map((x) => `<li><b>${esc(x.client)}</b> — ${esc(x.title)}</li>`).join("")}</ul>` : ""}
<div class="foot">Generated ${esc(new Date().toLocaleString())}</div>
<script>addEventListener("load",()=>setTimeout(()=>print(),200))</script></body></html>`);
    w.document.close();
  };

  /* ---------------- Palette ---------------- */
  const entries = useMemo<PaletteEntry[]>(() => {
    const ic = "h-3.5 w-3.5";
    const base: PaletteEntry[] = [
      {
        key: "v-overview",
        group: "Go to",
        label: "Overview",
        icon: <LayoutDashboard className={ic} />,
        run: () => switchView("overview"),
      },
      {
        key: "v-review",
        group: "Go to",
        label: `Review (${cc.review.length})`,
        icon: <Inbox className={ic} />,
        run: () => openQueue("review"),
      },
      {
        key: "v-ready",
        group: "Go to",
        label: `Ready to post (${cc.ready.length})`,
        icon: <Rocket className={ic} />,
        run: () => openQueue("ready"),
      },
      ...(cc.failed.length
        ? [
            {
              key: "v-failed",
              group: "Go to",
              label: `Failed posts (${cc.failed.length})`,
              icon: <AlertTriangle className={ic} />,
              run: () => openQueue("failed"),
            },
          ]
        : []),
      {
        key: "v-clients",
        group: "Go to",
        label: "Clients",
        icon: <Users className={ic} />,
        run: () => switchView("clients"),
      },
      {
        key: "v-schedule",
        group: "Go to",
        label: "Schedule",
        icon: <Calendar className={ic} />,
        run: () => switchView("schedule"),
      },
      {
        key: "v-performance",
        group: "Go to",
        label: "Performance",
        icon: <BarChart className={ic} />,
        run: () => switchView("performance"),
      },
      {
        key: "a-draft",
        group: "Actions",
        label: "Draft a week of posts",
        hint: "Uses AI credits",
        icon: <Sparkles className={ic} />,
        run: () => setDraftOpen(true),
      },
      {
        key: "a-copy",
        group: "Actions",
        label: "Copy client report",
        icon: <Copy className={ic} />,
        run: () => void copyReport(),
      },
      {
        key: "a-csv",
        group: "Actions",
        label: "Download report (CSV)",
        icon: <Download className={ic} />,
        run: downloadCsv,
      },
      {
        key: "a-add",
        group: "Actions",
        label: "Add a client",
        icon: <Plus className={ic} />,
        run: () => go(WORKSPACES_HOME),
      },
    ];
    const perClient = cc.clients.flatMap<PaletteEntry>((c) => [
      {
        key: `c-${c.id}`,
        group: "Clients",
        label: c.name,
        hint: c.domain ?? undefined,
        icon: <ClientMark client={c} size={20} />,
        run: () => go(clientHref(c, "home")),
      },
      {
        key: `c-${c.id}-ask`,
        group: "Clients",
        label: `${c.name} · Ask Mellox`,
        icon: <MessageSquare className={ic} />,
        searchOnly: true,
        run: () => brief(c.id),
      },
      {
        key: `c-${c.id}-review`,
        group: "Clients",
        label: `${c.name} · Review`,
        icon: <Inbox className={ic} />,
        searchOnly: true,
        run: () => openQueue("review", c.id),
      },
      {
        key: `c-${c.id}-cal`,
        group: "Clients",
        label: `${c.name} · Calendar`,
        icon: <Calendar className={ic} />,
        searchOnly: true,
        run: () => go(clientHref(c, "calendar")),
      },
      {
        key: `c-${c.id}-an`,
        group: "Clients",
        label: `${c.name} · Analytics`,
        icon: <BarChart className={ic} />,
        searchOnly: true,
        run: () => go(clientHref(c, "analytics")),
      },
      {
        key: `c-${c.id}-geo`,
        group: "Clients",
        label: `${c.name} · AI visibility`,
        icon: <Eye className={ic} />,
        searchOnly: true,
        run: () => go(clientHref(c, "visibility")),
      },
      {
        key: `c-${c.id}-comp`,
        group: "Clients",
        label: `${c.name} · Competitors`,
        icon: <Swords className={ic} />,
        searchOnly: true,
        run: () => go(clientHref(c, "competitors")),
      },
      {
        key: `c-${c.id}-bl`,
        group: "Clients",
        label: `${c.name} · Backlinks`,
        icon: <LinkIcon className={ic} />,
        searchOnly: true,
        run: () => go(clientHref(c, "backlinks")),
      },
    ]);
    return [...base, ...perClient];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cc.clients, cc.review.length, cc.ready.length, cc.failed.length]);

  const nav: { id: View; label: string; icon: typeof Inbox; badge?: number; alert?: boolean }[] = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    {
      id: "review",
      label: "Review",
      icon: Inbox,
      badge: cc.review.length + cc.failed.length,
      alert: cc.failed.length > 0,
    },
    { id: "clients", label: "Clients", icon: Users },
    { id: "schedule", label: "Schedule", icon: Calendar },
    { id: "performance", label: "Performance", icon: BarChart },
  ];

  const renderNav = (id: string) => (
    <nav className="ds-well flex rounded-full p-1" aria-label="Command Center">
      {nav.map((n) => {
        const on = view === n.id;
        return (
          <button
            key={n.id}
            onClick={() => switchView(n.id)}
            aria-current={on ? "page" : undefined}
            className={cn(
              "relative flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors",
              on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {on && (
              <motion.span
                layoutId={`cc-nav-${id}`}
                className="absolute inset-0 rounded-full bg-background shadow-sm ring-1 ring-border/60"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <n.icon className="relative h-4 w-4" />
            <span className="relative">{n.label}</span>
            {!!n.badge && (
              <span
                className={cn(
                  "relative min-w-[18px] rounded-full px-1.5 text-center text-[10.5px] font-semibold leading-[18px] tabular-nums",
                  n.alert
                    ? "bg-destructive text-destructive-foreground"
                    : "bg-primary text-primary-foreground",
                )}
              >
                {n.badge > 99 ? "99+" : n.badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );

  const error = cc.workspacesError ?? cc.contentError;

  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={200}>
        <div data-mellox-app className="relative min-h-[100dvh] bg-background text-foreground">
          <div
            aria-hidden
            className="ds-glow pointer-events-none absolute inset-x-0 top-0 h-[420px]"
          />

          {/* Header */}
          <header className="sticky top-0 z-30 border-b border-transparent bg-background/75 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
            <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-3 px-4 sm:px-6">
              <Link
                to={WORKSPACES_HOME}
                aria-label="Back to all clients"
                className={cn(dsIconBtn, "h-9 w-9 border border-border/70 bg-card")}
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <Link
                to={WORKSPACES_HOME}
                aria-label="Mellox AI home"
                className="hidden shrink-0 sm:block"
              >
                <Logo height={26} />
              </Link>
              <span aria-hidden className="hidden h-5 w-px bg-border sm:block" />
              <span className="truncate text-[14px] font-semibold tracking-tight">
                Command Center
              </span>

              <div className="mx-auto hidden lg:block">{renderNav("top")}</div>

              <div className="ml-auto flex items-center gap-2 lg:ml-0">
                <button
                  onClick={() => setPaletteOpen(true)}
                  aria-label="Search"
                  className={cn(
                    dsGhostBtn,
                    "h-9 w-9 p-0 sm:w-auto sm:gap-2 sm:pl-3 sm:pr-2 text-[12.5px] text-muted-foreground",
                  )}
                >
                  <Search className="h-4 w-4" />
                  <span className="hidden sm:inline">Search</span>
                  <kbd className="hidden h-5 items-center gap-0.5 rounded-md border border-border/60 bg-background px-1.5 text-[10px] font-semibold text-foreground/70 sm:inline-flex">
                    <CommandIcon className="h-2.5 w-2.5" />K
                  </kbd>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label="Report"
                      className={cn(dsGhostBtn, "h-9 w-9 p-0 sm:w-auto sm:px-3.5 text-[12.5px]")}
                    >
                      <FileText className="h-4 w-4" />
                      <span className="hidden sm:inline">Report</span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 rounded-2xl p-1.5">
                    <DropdownMenuItem
                      className="gap-2 rounded-xl"
                      onSelect={() => void copyReport()}
                    >
                      <Copy className="h-4 w-4" /> Copy as text
                    </DropdownMenuItem>
                    <DropdownMenuItem className="gap-2 rounded-xl" onSelect={downloadCsv}>
                      <Download className="h-4 w-4" /> Download CSV
                    </DropdownMenuItem>
                    <DropdownMenuItem className="gap-2 rounded-xl" onSelect={printReport}>
                      <FileText className="h-4 w-4" /> Print or save PDF
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <span
                  className="hidden items-center gap-1.5 rounded-full bg-[var(--ds-well-bg)] px-2.5 py-1 text-[11.5px] font-medium text-muted-foreground xl:inline-flex"
                  title="Updates live"
                >
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60 motion-reduce:hidden" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                  </span>
                  Live
                </span>
              </div>
            </div>
            {/* Nav on small screens */}
            <div className="mx-auto w-full max-w-7xl overflow-x-auto px-4 pb-2.5 [scrollbar-width:none] sm:px-6 lg:hidden [&::-webkit-scrollbar]:hidden">
              <div className="inline-flex">{renderNav("bottom")}</div>
            </div>
          </header>

          <main className="relative mx-auto w-full max-w-7xl px-4 pb-28 pt-6 sm:px-6">
            {error ? (
              <ErrorState
                title="Couldn't load your clients"
                detail={error}
                onRetry={cc.retryLoad}
              />
            ) : cc.loading ? (
              <LoadingSkeleton />
            ) : (
              <motion.div
                key={view}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              >
                {view !== "overview" && (
                  <h1 className="ds-page-title mb-5 text-[24px]">
                    {nav.find((n) => n.id === view)?.label}
                  </h1>
                )}
                {view === "overview" && (
                  <OverviewView
                    cc={cc}
                    greeting={greeting}
                    briefClient={briefClient}
                    onBriefClient={setBriefClient}
                    onQueue={openQueue}
                    onGo={go}
                    onClients={() => switchView("clients")}
                    onSchedule={() => switchView("schedule")}
                    onDraftWeek={() => setDraftOpen(true)}
                  />
                )}
                {view === "review" && (
                  <ReviewView
                    cc={cc}
                    tab={queue}
                    onTab={setQueue}
                    clientFilter={clientFilter}
                    onClientFilter={setClientFilter}
                    onOpenClient={(id) => {
                      const c = cc.clientMap.get(id);
                      if (c) go(clientHref(c, "home"));
                    }}
                  />
                )}
                {view === "clients" && (
                  <ClientsView
                    cc={cc}
                    onGo={go}
                    onReviewClient={(id) => openQueue("review", id)}
                    onBrief={brief}
                  />
                )}
                {view === "schedule" && (
                  <ScheduleView cc={cc} clientFilter={clientFilter} onGo={go} />
                )}
                {view === "performance" && <PerformanceView cc={cc} onGo={go} />}
              </motion.div>
            )}
          </main>

          <CommandPalette
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            entries={entries}
          />
          <DraftWeekDialog
            cc={cc}
            open={draftOpen}
            onOpenChange={setDraftOpen}
            onDone={() => openQueue("review")}
          />
        </div>
      </TooltipProvider>
    </MotionConfig>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-8" role="status" aria-label="Loading">
      <div className="flex flex-col items-center gap-3 pt-6">
        <Skeleton className="h-10 w-72 rounded-full" />
        <Skeleton className="h-4 w-56 rounded-full" />
        <Skeleton className="mt-5 h-[108px] w-full max-w-2xl rounded-[28px]" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[128px] rounded-[20px]" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[62px] rounded-[20px]" />
          ))}
        </div>
        <Skeleton className="h-[260px] rounded-[20px]" />
      </div>
    </div>
  );
}
