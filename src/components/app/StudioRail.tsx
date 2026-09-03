"use client";

import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { useVisibleInterval } from "@/hooks/use-visible-interval";
import {
  PanelRightClose,
  PanelRightOpen,
  Plus,
  ChevronRight,
  Sparkles,
  Mail,
  Wand2,
  Calendar,
  Brain,
  Search,
  Share2,
  FileText,
  Zap,
} from "@/components/brand/icons";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  STUDIO_TILES,
  TILE_BY_ID,
  MOCK_SCHEDULED,
  MOCK_RECENT,
  type QueueItem,
  type CanvasType,
} from "@/lib/studio";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@/lib/use-server-fn";
import { updateContentItem } from "@/lib/content.functions";
import { genQueue, type GenJob } from "@/lib/generation-queue";
import { GenerationQueueRow } from "@/components/app/GenerationQueueRow";
import {
  useStudioSuggestions,
  type StudioSuggestion,
  type StudioSuggestionAccent,
} from "@/hooks/use-studio-suggestions";
import { GeneratePostImageButton } from "@/components/app/GeneratePostImageButton";
import { getAnyCachedImage } from "@/lib/post-image";
import { ConnectionsPanel } from "@/components/app/ConnectionsPanel";
import { publishContentItems } from "@/lib/sdr.functions";
import { toast } from "sonner";

const EASE = [0.22, 1, 0.36, 1] as const;

export const TINT_HEX: Record<string, string> = {
  "brand-blue": "#3b82f6",
  "brand-green": "#22c55e",
  amber: "#f59e0b",
  sky: "#0ea5e9",
  violet: "#8b5cf6",
  rose: "#f43f5e",
  teal: "#14b8a6",
  fuchsia: "#d946ef",
};

export function tintFor(type: CanvasType) {
  return TINT_HEX[TILE_BY_ID[type].tint] ?? "#3b82f6";
}

function openCanvas(type: CanvasType, id?: string, mode?: "draft" | "review" | "view") {
  window.dispatchEvent(new CustomEvent("open:canvas", { detail: { type, id, mode } }));
}

type Mode = "draft" | "review" | "view";
type Row = QueueItem & { mode: Mode; meta: string };

function kindToCanvas(kind: string | null, channel: string | null): CanvasType {
  if (kind === "brief") return "seo-brief";
  if (kind === "landing") return "landing-page";
  if (kind === "email") return "email";
  if (kind === "blog") return "article";
  if (channel === "instagram" || channel === "tiktok") return "design-asset";
  return "social-post";
}

function loadSelectedBrandContext(wsId: string) {
  let brandContext = "";
  let websiteUrl: string | null = null;
  try {
    const keys = [`brand-dna:v3:${wsId}`, `brand-dna:v2:${wsId}`, `brand-dna:${wsId}`];
    for (const k of keys) {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const b = JSON.parse(raw) as Record<string, string | null | undefined>;
      const parts: string[] = [];
      if (b.brandName) parts.push(`Brand: ${b.brandName}`);
      if (b.oneLiner) parts.push(`One-liner: ${b.oneLiner}`);
      if (b.industry) parts.push(`Industry: ${b.industry}`);
      if (b.products) parts.push(`Products: ${b.products}`);
      if (b.audience) parts.push(`Audience: ${b.audience}`);
      if (b.voice) parts.push(`Voice: ${b.voice}`);
      if (b.values) parts.push(`Values: ${b.values}`);
      if (b.doRules) parts.push(`Do: ${b.doRules}`);
      if (b.dontRules) parts.push(`Don't: ${b.dontRules}`);
      brandContext = parts.join("\n");
      websiteUrl = (b.websiteUrl as string) ?? null;
      break;
    }
  } catch {}
  return { brandContext, websiteUrl };
}

export function StudioRail({ embedded = false }: { embedded?: boolean } = {}) {
  // Start with the SSR default; hydrate from localStorage after mount to avoid
  // server/client markup mismatch.
  const [open, setOpen] = useState<boolean>(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [approvals, setApprovals] = useState<Row[]>([]);
  const [scheduledRows, setScheduledRows] = useState<Row[] | null>(null);
  const [recentRows, setRecentRows] = useState<Row[] | null>(null);
  const [genJobs, setGenJobs] = useState<GenJob[]>(() => genQueue.list());
  const runUpdate = useServerFn(updateContentItem);
  useEffect(() => {
    const sync = () => setGenJobs(genQueue.list());
    sync();
    return genQueue.subscribe(sync);
  }, []);
  useEffect(() => {
    if (embedded) {
      setOpen(true);
      return;
    }
    try {
      if (localStorage.getItem("studio:open") === "0") setOpen(false);
    } catch {}
  }, [embedded]);
  useEffect(() => {
    if (embedded) return;
    try {
      localStorage.setItem("studio:open", open ? "1" : "0");
    } catch {}
  }, [embedded, open]);

  const loadApprovals = useCallback(async (cancelledRef?: { readonly current: boolean }) => {
    const wsId = typeof window !== "undefined" ? localStorage.getItem("workspace:selected") : null;
    if (!wsId) {
      if (!cancelledRef?.current) setApprovals([]);
      return;
    }

    const [content, legacy] = await Promise.all([
      supabase
        .from("content_items")
        .select("id, title, body, kind, channel, status, created_at")
        .eq("workspace_id", wsId)
        .in("status", ["pending", "draft"])
        .order("created_at", { ascending: false })
        .limit(12),
      supabase
        .from("approvals")
        .select("id, action, status, payload, created_at")
        .eq("workspace_id", wsId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(12),
    ]);

    if (cancelledRef?.current) return;

    const realRows: Row[] = ((content.data ?? []) as any[]).map((r): Row => ({
      id: r.id,
      title: r.title || (r.body ? String(r.body).slice(0, 72) : "Untitled draft"),
      canvas: kindToCanvas(r.kind, r.channel),
      channel: r.channel ?? undefined,
      mode: "review",
      meta: r.status === "draft" ? "draft ready" : "needs approval",
    }));

    const legacyRows: Row[] = ((legacy.data ?? []) as any[]).map((row): Row => {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      const canvas = (
        typeof payload.canvas === "string" ? payload.canvas : "social-post"
      ) as CanvasType;
      return {
        id: row.id,
        title: row.action || "Pending approval",
        canvas,
        channel: typeof payload.channel === "string" ? payload.channel : undefined,
        mode: "review",
        meta: "needs approval",
      };
    });

    setApprovals([...realRows, ...legacyRows]);
  }, []);

  // Refresh approvals on mount, when content changes elsewhere (Studio save,
  // chat actions, approvals from the client portal), and on a slow interval.
  useEffect(() => {
    let cancelled = false;
    const cancelledRef = {
      get current() {
        return cancelled;
      },
    };
    const run = () => loadApprovals(cancelledRef).catch(() => {});
    run();
    const onChange = () => run();
    window.addEventListener("content:changed", onChange);
    window.addEventListener("approvals:changed", onChange);
    // interval handled by useVisibleInterval below
    return () => {
      cancelled = true;
      window.removeEventListener("content:changed", onChange);
      window.removeEventListener("approvals:changed", onChange);
      // no interval to clear here
    };
  }, [loadApprovals]);

  // Load real scheduled + recent from content_items
  useEffect(() => {
    let cancelled = false;
    const fmtWhen = (iso: string | null) => {
      if (!iso) return "scheduled";
      const d = new Date(iso);
      const today = new Date();
      const sameDay = d.toDateString() === today.toDateString();
      const tmrw = new Date(today);
      tmrw.setDate(tmrw.getDate() + 1);
      const isTmrw = d.toDateString() === tmrw.toDateString();
      const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      if (sameDay) return `Today · ${time}`;
      if (isTmrw) return `Tomorrow · ${time}`;
      return `${d.toLocaleDateString([], { weekday: "short" })} · ${time}`;
    };
    const fmtAgo = (iso: string) => {
      const diff = Date.now() - new Date(iso).getTime();
      const m = Math.round(diff / 60000);
      if (m < 1) return "just now";
      if (m < 60) return `${m}m ago`;
      const h = Math.round(m / 60);
      if (h < 24) return `${h}h ago`;
      return `${Math.round(h / 24)}d ago`;
    };
    const load = async () => {
      const wsId =
        typeof window !== "undefined" ? localStorage.getItem("workspace:selected") : null;
      if (!wsId) {
        if (!cancelled) {
          setScheduledRows([]);
          setRecentRows([]);
        }
        return;
      }
      const [sched, recent] = await Promise.all([
        supabase
          .from("content_items")
          .select("id, title, kind, channel, scheduled_at, status")
          .eq("workspace_id", wsId)
          .eq("status", "scheduled")
          .order("scheduled_at", { ascending: true, nullsFirst: false })
          .limit(8),
        supabase
          .from("content_items")
          .select("id, title, kind, channel, updated_at, status")
          .eq("workspace_id", wsId)
          .order("updated_at", { ascending: false })
          .limit(8),
      ]);
      if (cancelled) return;
      setScheduledRows(
        ((sched.data ?? []) as any[]).map((r): Row => ({
          id: r.id,
          title: r.title || "Untitled",
          canvas: kindToCanvas(r.kind, r.channel),
          channel: r.channel ?? undefined,
          mode: "view",
          meta: fmtWhen(r.scheduled_at),
        })),
      );
      setRecentRows(
        ((recent.data ?? []) as any[]).map((r): Row => ({
          id: r.id,
          title: r.title || "Untitled",
          canvas: kindToCanvas(r.kind, r.channel),
          channel: r.channel ?? undefined,
          mode: "view",
          meta: fmtAgo(r.updated_at),
        })),
      );
    };
    load();
    const onChange = () => load();
    window.addEventListener("content:changed", onChange);
    const t = window.setInterval(load, 30000);
    return () => {
      cancelled = true;
      window.removeEventListener("content:changed", onChange);
    };
  }, []);

  // Poll approvals + scheduled/recent only while tab is visible (60s cadence,
  // was 30s and ran forever on background tabs).
  useVisibleInterval(() => {
    window.dispatchEvent(new Event("content:changed"));
  }, 60000);

  if (!embedded && !open) {
    const pendingCount = approvals.length;
    return (
      <aside className="hidden xl:flex w-12 shrink-0 flex-col items-center justify-start py-4 pr-2 pl-1">
        <motion.button
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.25, ease: EASE }}
          whileHover={{ y: -2, scale: 1.05 }}
          whileTap={{ scale: 0.92 }}
          onClick={() => setOpen(true)}
          aria-label="Open Studio"
          className="group relative grid h-10 w-10 place-items-center overflow-hidden rounded-2xl text-white shadow-[0_6px_18px_-6px_hsl(var(--brand-green)/0.55),0_2px_6px_-2px_hsl(var(--brand-blue)/0.35)] transition-all duration-200 hover:shadow-[0_10px_28px_-8px_hsl(var(--brand-green)/0.65),0_4px_10px_-2px_hsl(var(--brand-blue)/0.45)]"
        >
          {/* Gradient background */}
          <span
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(135deg, hsl(var(--brand-green)) 0%, hsl(var(--brand-blue)) 100%)",
            }}
          />
          {/* Top gloss */}
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 h-1/2 rounded-t-2xl opacity-60"
            style={{
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0) 100%)",
            }}
          />
          {/* Inner ring */}
          <span
            aria-hidden
            className="absolute inset-[2.5px] rounded-[13px] border border-white/20"
          />
          {/* Icon */}
          <Wand2
            className="relative h-[18px] w-[18px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
            strokeWidth={2.2}
          />

          {pendingCount > 0 && (
            <span
              className="absolute -right-0.5 -top-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-[hsl(var(--brand-blue))] text-[9px] font-bold text-white ring-2 ring-background shadow-[0_0_8px_hsl(var(--brand-blue)/0.7)]"
              aria-label={`${pendingCount} pending`}
            >
              {pendingCount > 9 ? "9+" : pendingCount}
            </span>
          )}

          {/* Tooltip */}
          <span className="pointer-events-none absolute right-full mr-3 whitespace-nowrap rounded-lg bg-foreground px-2.5 py-1.5 text-[11px] font-medium text-background opacity-0 shadow-lg transition-all duration-200 group-hover:opacity-100 group-hover:-translate-x-0.5">
            Studio
          </span>
        </motion.button>
      </aside>
    );
  }

  const scheduled: Row[] =
    scheduledRows && scheduledRows.length > 0
      ? scheduledRows
      : scheduledRows === null
        ? MOCK_SCHEDULED.map((it) => ({ ...it, mode: "view", meta: it.when ?? "scheduled" }))
        : [];
  const recent: Row[] =
    recentRows && recentRows.length > 0
      ? recentRows
      : recentRows === null
        ? MOCK_RECENT.map((it) => ({ ...it, mode: "view", meta: it.when ?? "" }))
        : [];

  return (
    <motion.aside
      initial={{ x: 16, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.35, ease: EASE }}
      className={cn(
        embedded
          ? "flex h-full w-full min-w-0 flex-1 flex-col py-0"
          : "hidden xl:flex w-[300px] 2xl:w-[316px] shrink-0 flex-col py-3 pr-3 pl-1",
      )}
    >
      <div
        className={cn(
          "relative flex min-h-0 flex-1 flex-col overflow-hidden",
          embedded
            ? "bg-transparent"
            : "rounded-[28px] border border-border/60 bg-sidebar shadow-[0_10px_40px_-18px_rgba(0,0,0,0.18)]",
        )}
      >
        {!embedded && (
          <>
            <div
              aria-hidden
              className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full opacity-[0.08] blur-3xl"
              style={{
                background: "radial-gradient(circle, hsl(var(--brand-blue)), transparent 60%)",
              }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute bottom-0 -left-16 h-56 w-56 rounded-full opacity-[0.06] blur-3xl"
              style={{
                background: "radial-gradient(circle, hsl(var(--brand-green)), transparent 60%)",
              }}
            />
          </>
        )}

        {!embedded && (
          <header className="relative flex h-11 shrink-0 items-center justify-between px-3.5">
            <h2 className="ui-eyebrow text-foreground/85">
              <motion.span
                aria-hidden
                animate={{ rotate: [0, 8, -6, 0], scale: [1, 1.08, 1] }}
                transition={{ duration: 4, repeat: Infinity, ease: EASE }}
                className="grid h-4 w-4 place-items-center rounded-[5px]"
                style={{
                  background:
                    "linear-gradient(135deg, hsl(var(--brand-blue)), hsl(var(--brand-green)))",
                  boxShadow: "0 0 12px hsl(var(--brand-blue) / 0.45)",
                }}
              >
                <Sparkles className="h-2.5 w-2.5 text-white" strokeWidth={2.5} />
              </motion.span>
              Studio
            </h2>
            <button
              onClick={() => setOpen(false)}
              title="Collapse Studio"
              aria-label="Collapse Studio panel"
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              <PanelRightClose className="h-3.5 w-3.5" aria-hidden />
            </button>
          </header>
        )}

        <div className="relative min-h-0 flex-1 overflow-y-auto px-3.5 pt-4 pb-6 scrollbar-thin">
          <motion.button
            onClick={() => setCreateOpen((o) => !o)}
            whileTap={{ scale: 0.985 }}
            aria-expanded={createOpen}
            aria-controls="studio-create-canvases"
            aria-label={createOpen ? "Close canvas picker" : "Create a new canvas"}
            className="group relative flex h-10 w-full items-center justify-between gap-3 overflow-hidden rounded-xl border border-border/60 bg-card/60 pl-2 pr-3 text-[12.5px] font-medium tracking-tight text-foreground transition-all duration-200 hover:border-foreground/20 hover:bg-card"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <motion.span
                animate={{ rotate: createOpen ? 135 : 0 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-white shadow-[0_2px_8px_-2px_hsl(var(--brand-blue)/0.6)]"
                style={{
                  background:
                    "linear-gradient(135deg, hsl(var(--brand-blue)), hsl(var(--brand-green)))",
                }}
                aria-hidden
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.75} />
              </motion.span>
              <span className="truncate">{createOpen ? "Choose a canvas" : "Create"}</span>
            </span>
            <span
              className="pointer-events-none hidden shrink-0 items-center rounded-md bg-secondary/70 px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground sm:inline-flex"
              aria-hidden
            >
              ⌘J
            </span>
          </motion.button>

          <AnimatePresence initial={false}>
            {createOpen && (
              <motion.ul
                id="studio-create-canvases"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.28, ease: EASE }}
                className="mt-2 flex flex-col gap-1 overflow-hidden"
              >
                {STUDIO_TILES.map((t, idx) => (
                  <motion.li
                    key={t.id}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.025, duration: 0.22, ease: EASE }}
                  >
                    <button
                      onClick={() => {
                        openCanvas(t.id);
                        setCreateOpen(false);
                      }}
                      className="group flex w-full items-center gap-2.5 rounded-full px-2.5 py-1.5 text-left text-[12.5px] text-foreground/85 transition-all duration-200 hover:bg-secondary hover:text-foreground"
                    >
                      <span
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-border/40 transition-all duration-200 group-hover:scale-110"
                        style={{
                          background: `linear-gradient(135deg, ${TINT_HEX[t.tint]}22, ${TINT_HEX[t.tint]}08)`,
                          boxShadow: `inset 0 0 0 1px ${TINT_HEX[t.tint]}1a`,
                        }}
                      >
                        <t.icon
                          className="h-3 w-3"
                          strokeWidth={2.25}
                          style={{ color: TINT_HEX[t.tint] }}
                        />
                      </span>
                      <span className="flex-1 truncate">{t.label}</span>
                      <span className="rounded-full bg-secondary/60 px-1.5 py-0.5 text-[10px] text-muted-foreground/70 transition-opacity group-hover:opacity-100 opacity-0">
                        {t.sub.split(" · ")[0]}
                      </span>
                    </button>
                  </motion.li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>

          <BrandDnaCta />

          <ConnectionsPanel />

          <ApprovalsSection
            items={approvals}
            jobs={genJobs}
            onDecide={async (id, status) => {
              // Optimistic remove
              setApprovals((prev) => prev.filter((r) => r.id !== id));
              try {
                if (status === "published") {
                  // FR-024: approval stays editorial; "publish" then distributes.
                  await runUpdate({ data: { id, patch: { status: "approved" } } });
                  const wsId =
                    typeof window !== "undefined"
                      ? localStorage.getItem("workspace:selected")
                      : null;
                  if (wsId) {
                    try {
                      const res = await publishContentItems(wsId, [id], { type: "all" });
                      const skipped = res.results.filter((r) => r.status === "skipped");
                      if (skipped.length) {
                        toast.info("Nothing published", {
                          description: skipped[0].reason ?? "No active target",
                        });
                      }
                    } catch (e) {
                      toast.error("Publish failed", {
                        description: e instanceof Error ? e.message : "Please try again.",
                      });
                    }
                  }
                } else {
                  const patch: { status: ApprovalStatus } = { status };
                  await runUpdate({ data: { id, patch } });
                }
                window.dispatchEvent(new CustomEvent("content:changed"));
                window.dispatchEvent(new CustomEvent("approvals:changed"));
              } catch {
                // Reload truth on failure
                loadApprovals().catch(() => {});
              }
            }}
          />

          <SuggestionsSection />
          <Section title="Scheduled" empty="Nothing scheduled." items={scheduled} />
          <Section title="Recent" empty="Nothing yet." items={recent} muted />
        </div>
      </div>
    </motion.aside>
  );
}

function BrandDnaCta() {
  const [filled, setFilled] = useState<number | null>(null);
  useEffect(() => {
    const read = () => {
      try {
        const wsId = localStorage.getItem("workspace:active") || "";
        const keys = wsId
          ? [`brand-dna:v3:${wsId}`, `brand-dna:v2:${wsId}`, `brand-dna:${wsId}`]
          : [];
        for (const k of keys) {
          const raw = localStorage.getItem(k);
          if (!raw) continue;
          const b = JSON.parse(raw) as Record<string, string | undefined>;
          const n = ["audience", "voice", "values", "doRules", "dontRules"].filter((f) =>
            (b[f] ?? "").trim(),
          ).length;
          setFilled(n);
          return;
        }
        setFilled(0);
      } catch {
        setFilled(0);
      }
    };
    read();
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, []);

  if (filled === null || filled >= 5) return null;

  return (
    <button
      onClick={() =>
        window.dispatchEvent(new CustomEvent("open:brand-dna", { detail: { tab: "essentials" } }))
      }
      className="mt-2 flex w-full items-center gap-2 rounded-xl border border-dashed border-brand-green/40 bg-brand-green/5 px-2.5 py-2 text-left text-[11.5px] font-medium text-foreground/80 transition hover:border-brand-green/70 hover:bg-brand-green/10"
    >
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-brand-green/15 text-brand-green">
        <Sparkles className="h-3 w-3" strokeWidth={2.5} />
      </span>
      <span className="min-w-0 flex-1 truncate">Complete your Brand DNA</span>
      <span className="rounded-full bg-background/70 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
        {filled}/5
      </span>
    </button>
  );
}

type ApprovalStatus = "approved" | "rejected" | "published";

function ApprovalsSection({
  items,
  jobs,
  onDecide,
}: {
  items: Row[];
  jobs: GenJob[];
  onDecide: (id: string, status: ApprovalStatus) => void;
}) {
  if (items.length === 0 && jobs.length === 0) {
    return (
      <section className="ui-section-gap">
        <div className="mb-2 flex items-center gap-2 px-0.5">
          <h3 className="ui-eyebrow text-foreground/80">Needs approval</h3>
          <span className="rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
            0
          </span>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-dashed border-border/50 bg-card/30 p-4">
          <p className="text-[13px] font-medium text-foreground">You're all caught up</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
            New drafts from Studio and chat will appear here for review.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <button
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("open:canvas", {
                    detail: { type: "social-post", mode: "draft" },
                  }),
                )
              }
              className="rounded-full bg-foreground px-3 py-1 text-[11.5px] font-medium text-background transition hover:bg-foreground/90"
            >
              Open Studio
            </button>
            <button
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("chat:prefill", {
                    detail: { text: "Draft a post for this week", focus: true },
                  }),
                )
              }
              className="rounded-full border border-border/60 bg-transparent px-3 py-1 text-[11.5px] font-medium text-muted-foreground transition hover:bg-muted/50 hover:text-foreground"
            >
              Ask in chat
            </button>
          </div>
        </div>
      </section>
    );
  }
  const totalCount = items.length + jobs.length;
  return (
    <section className="relative ui-section-gap">
      <div className="relative mb-2 flex items-center justify-between px-0.5">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="ui-eyebrow text-foreground/80">Needs approval</h3>
          <motion.span
            key={totalCount}
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 420, damping: 20 }}
            className="rounded-full bg-amber-500/12 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/20"
          >
            {totalCount}
          </motion.span>
        </div>
      </div>

      <ul className="relative space-y-1.5">
        <AnimatePresence initial={false}>
          {jobs.map((job) => (
            <GenerationQueueRow key={job.id} job={job} />
          ))}
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {items.map((it, idx) => {
            const tile = TILE_BY_ID[it.canvas];
            const color = TINT_HEX[tile.tint];
            return (
              <motion.li
                key={it.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -8, transition: { duration: 0.18 } }}
                transition={{ delay: idx * 0.04, duration: 0.28, ease: EASE }}
              >
                <div
                  onClick={() => openCanvas(it.canvas, it.id, it.mode)}
                  className="group @container/card relative flex w-full cursor-pointer flex-col gap-2.5 overflow-hidden rounded-2xl border border-border/60 bg-card p-3 text-left transition-all duration-200 hover:border-border hover:bg-card hover:shadow-[0_4px_16px_-6px_rgba(0,0,0,0.08)]"
                >
                  {/* Top: thumbnail + meta */}
                  <div className="flex min-w-0 items-start gap-2.5">
                    <Thumbnail type={it.canvas} color={color} postId={it.id} />
                    <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span
                          className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                          style={{ background: `${color}18`, color }}
                        >
                          <tile.icon className="h-2.5 w-2.5" strokeWidth={2.5} />
                          <span className="truncate">{tile.label}</span>
                        </span>
                        {it.channel && (
                          <span className="truncate text-[10.5px] font-medium text-muted-foreground/80">
                            · {it.channel}
                          </span>
                        )}
                        <span className="ml-auto shrink-0 truncate text-[10px] font-medium text-muted-foreground/60">
                          {it.meta}
                        </span>
                      </div>
                      <p className="line-clamp-2 text-[13px] font-medium leading-snug text-foreground">
                        {it.title}
                      </p>
                    </div>
                  </div>

                  {/* Actions row — full width, responsive, wraps on narrow rails */}
                  <div className="flex flex-wrap items-center gap-1 border-t border-border/50 pt-2">
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDecide(it.id, "rejected");
                      }}
                      className="shrink-0 rounded-lg px-2 py-1 text-[11.5px] font-medium text-muted-foreground transition hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400"
                      aria-label="Reject draft"
                    >
                      Skip
                    </motion.button>
                    <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                      <GeneratePostImageButton
                        postId={it.id}
                        postTitle={it.title}
                        platform={(it.channel as any) ?? null}
                        workspaceId={
                          typeof window !== "undefined"
                            ? localStorage.getItem("workspace:selected")
                            : null
                        }
                      />
                    </div>

                    <div className="ml-auto flex shrink-0 items-center gap-1">
                      <motion.button
                        whileTap={{ scale: 0.95 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDecide(it.id, "approved");
                        }}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-medium text-foreground/80 transition hover:bg-muted"
                        aria-label="Approve draft"
                        title="Approve draft"
                      >
                        Approve
                      </motion.button>
                      <motion.button
                        whileTap={{ scale: 0.95 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDecide(it.id, "published");
                        }}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-foreground px-2 py-1 text-[11.5px] font-medium text-background transition hover:bg-foreground/90"
                        aria-label="Publish now"
                        title="Publish immediately"
                      >
                        <Zap className="h-3 w-3" strokeWidth={2.5} />
                        <span className="hidden @[220px]/card:inline">Publish</span>
                        <span className="@[220px]/card:hidden">Post</span>
                      </motion.button>
                    </div>
                  </div>
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </section>
  );
}

function RowLeadingVisual({
  canvas,
  postId,
  color,
  Icon,
}: {
  canvas: CanvasType;
  postId: string;
  color: string;
  Icon: React.ComponentType<{
    className?: string;
    style?: React.CSSProperties;
    strokeWidth?: number;
  }>;
}) {
  const [img, setImg] = useState<string | null>(() => getAnyCachedImage(postId));
  useEffect(() => {
    if (!postId) return;
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as { postId?: string } | undefined;
      if (!d?.postId || d.postId === postId) setImg(getAnyCachedImage(postId));
    };
    setImg(getAnyCachedImage(postId));
    window.addEventListener("post-image:cached", on as EventListener);
    return () => window.removeEventListener("post-image:cached", on as EventListener);
  }, [postId]);

  if (img && (canvas === "social-post" || canvas === "design-asset")) {
    return (
      <span
        className="relative grid h-6 w-6 shrink-0 overflow-hidden rounded-md transition-transform duration-200 group-hover:scale-110"
        style={{ boxShadow: `inset 0 0 0 1px ${color}33` }}
      >
        <img src={img} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <span
          className="absolute -bottom-0.5 -right-0.5 grid h-2.5 w-2.5 place-items-center rounded-full bg-emerald-500 text-[7px] text-white ring-2 ring-card"
          title="Image ready"
        >
          ✓
        </span>
      </span>
    );
  }
  return (
    <span
      className="grid h-5 w-5 shrink-0 place-items-center rounded-full transition-transform duration-200 group-hover:scale-110"
      style={{ background: `${color}22`, boxShadow: `inset 0 0 0 1px ${color}26` }}
    >
      <Icon className="h-2.5 w-2.5" strokeWidth={2.25} style={{ color }} />
    </span>
  );
}

function Thumbnail({ type, color, postId }: { type: CanvasType; color: string; postId?: string }) {
  const base = "relative h-[60px] w-[60px] shrink-0 overflow-hidden rounded-2xl";
  const bg = {
    background: `linear-gradient(135deg, ${color}30, ${color}08)`,
    boxShadow: `inset 0 0 0 1px ${color}1f`,
  };

  const [cachedImg, setCachedImg] = useState<string | null>(() => getAnyCachedImage(postId));
  useEffect(() => {
    if (!postId) return;
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as { postId?: string } | undefined;
      if (!d?.postId || d.postId === postId) setCachedImg(getAnyCachedImage(postId));
    };
    setCachedImg(getAnyCachedImage(postId));
    window.addEventListener("post-image:cached", on as EventListener);
    return () => window.removeEventListener("post-image:cached", on as EventListener);
  }, [postId]);

  if (cachedImg) {
    return (
      <div className={base} style={bg}>
        <img src={cachedImg} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <span
          className="absolute bottom-1 right-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-emerald-500 text-[8px] text-white ring-2 ring-card"
          title="Image ready"
        >
          ✓
        </span>
      </div>
    );
  }

  if (type === "social-post") {
    return (
      <div className={base} style={bg}>
        <div
          className="absolute left-1.5 top-1.5 h-2 w-2 rounded-full"
          style={{ background: color }}
        />
        <div className="absolute left-4 top-1.5 h-1 w-6 rounded bg-foreground/20" />
        <div className="absolute left-1.5 right-1.5 top-5 space-y-1">
          <div className="h-1 w-full rounded bg-foreground/15" />
          <div className="h-1 w-4/5 rounded bg-foreground/15" />
          <div className="h-1 w-3/5 rounded bg-foreground/15" />
        </div>
        <div
          className="absolute inset-x-1.5 bottom-1.5 h-3 rounded"
          style={{ background: `${color}40` }}
        />
      </div>
    );
  }
  if (type === "email") {
    return (
      <div className={base} style={bg}>
        <Mail
          className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2"
          style={{ color }}
        />
      </div>
    );
  }
  if (type === "seo-brief" || type === "article") {
    return (
      <div className={base} style={bg}>
        <div className="absolute inset-2 space-y-1">
          <div className="h-1.5 w-3/4 rounded" style={{ background: color }} />
          <div className="h-1 w-full rounded bg-foreground/15" />
          <div className="h-1 w-5/6 rounded bg-foreground/15" />
          <div className="h-1 w-2/3 rounded bg-foreground/15" />
        </div>
      </div>
    );
  }
  // landing-page, design-asset, fallback
  const Icon = TILE_BY_ID[type].icon;
  return (
    <div className={base} style={bg}>
      <Icon
        className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2"
        style={{ color }}
        strokeWidth={1.75}
      />
    </div>
  );
}

function Section({
  title,
  items,
  empty,
  muted,
  accent,
}: {
  title: string;
  items: Row[];
  empty: string;
  muted?: boolean;
  accent?: boolean;
}) {
  return (
    <section className="ui-section-gap">
      <div className="mb-1.5 flex items-center justify-between px-1">
        <h3 className="ui-eyebrow">{title}</h3>
        {items.length > 0 && (
          <motion.span
            key={items.length}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
            className={cn(
              "ui-count-pill",
              accent && "!bg-[hsl(var(--brand-blue))]/15 !text-[hsl(var(--brand-blue))]",
            )}
          >
            {items.length}
          </motion.span>
        )}
      </div>
      {items.length === 0 ? (
        <p className="ui-empty-body px-1">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {items.map((it, idx) => {
            const tile = TILE_BY_ID[it.canvas];
            const color = TINT_HEX[tile.tint];
            return (
              <motion.li
                key={it.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.03, duration: 0.25, ease: EASE }}
              >
                <motion.button
                  whileHover={{ x: 2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => openCanvas(it.canvas, it.id, it.mode)}
                  className={cn(
                    "group relative flex w-full items-center gap-2.5 rounded-full px-2 py-1.5 text-left text-[12px] transition-all duration-200 hover:bg-secondary/70",
                    muted
                      ? "text-muted-foreground hover:text-foreground"
                      : "text-foreground/85 hover:text-foreground",
                  )}
                >
                  <RowLeadingVisual
                    canvas={it.canvas}
                    postId={it.id}
                    color={color}
                    Icon={tile.icon}
                  />
                  <span className="min-w-0 flex-1 truncate">{it.title}</span>
                  {it.meta === "needs approval" ? (
                    <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                      approve
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full px-1.5 text-[10.5px] text-muted-foreground/60">
                      {it.meta}
                    </span>
                  )}
                </motion.button>
              </motion.li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const SUGGESTION_ACCENT: Record<
  StudioSuggestionAccent,
  { fg: string; bg: string; ring: string; dot: string }
> = {
  indigo: {
    fg: "text-indigo-600 dark:text-indigo-300",
    bg: "bg-indigo-500/10",
    ring: "ring-indigo-500/25",
    dot: "bg-indigo-500",
  },
  blue: {
    fg: "text-sky-600 dark:text-sky-300",
    bg: "bg-sky-500/10",
    ring: "ring-sky-500/25",
    dot: "bg-sky-500",
  },
  green: {
    fg: "text-emerald-600 dark:text-emerald-300",
    bg: "bg-emerald-500/10",
    ring: "ring-emerald-500/25",
    dot: "bg-emerald-500",
  },
  violet: {
    fg: "text-violet-600 dark:text-violet-300",
    bg: "bg-violet-500/10",
    ring: "ring-violet-500/25",
    dot: "bg-violet-500",
  },
  rose: {
    fg: "text-rose-600 dark:text-rose-300",
    bg: "bg-rose-500/10",
    ring: "ring-rose-500/25",
    dot: "bg-rose-500",
  },
  amber: {
    fg: "text-amber-600 dark:text-amber-300",
    bg: "bg-amber-500/10",
    ring: "ring-amber-500/25",
    dot: "bg-amber-500",
  },
};

const SUGGESTION_ICON = {
  Sparkles,
  Brain,
  Calendar,
  Search,
  Wand2,
  Mail,
  Share2,
  FileText,
} as const;

/**
 * Shared clamp + overflow rules for the suggestion card text spans.
 *
 * Both label and hint use the same base rules so their behaviour scales
 * identically as the grid column (`minmax(0, 1fr)`) shrinks and grows:
 *   - `min-w-0` + `max-w-full` + `w-full` — the span never forces the grid
 *     column to grow past its computed width, and always fills that column.
 *   - `overflow-hidden` + `break-words` + `[overflow-wrap:anywhere]` — an
 *     unbroken URL/token wraps instead of pushing the card wider.
 *   - Inline `display: -webkit-box` + `WebkitBoxOrient: vertical` — line
 *     clamping needs this explicitly; Tailwind's `line-clamp-*` utility
 *     doesn't always emit `display:-webkit-box` in v4 (WebKit bit us here).
 * Only the line count (2 for label, 1 for hint) and typography differ.
 */
const SUGGESTION_TEXT_BASE =
  "block w-full min-w-0 max-w-full overflow-hidden break-words [hyphens:auto] [overflow-wrap:anywhere]";

const clampStyle = (lines: number): React.CSSProperties => ({
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: lines,
});

function SuggestionsSection() {
  const { items, loading } = useStudioSuggestions();
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      const raw =
        typeof window !== "undefined" ? localStorage.getItem("studio:suggest-dismissed") : null;
      return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set<string>();
    }
  });
  const visible = items.filter((s) => !dismissed.has(s.id));

  const dismiss = (id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem("studio:suggest-dismissed", JSON.stringify([...next]));
      } catch {}
      return next;
    });
  };

  if (loading && items.length === 0) return null;
  if (visible.length === 0) return null;

  return (
    <section className="ui-section-gap">
      <div className="mb-1.5 flex items-center justify-between px-0.5">
        <h3 className="ui-eyebrow">
          <Sparkles className="h-2.5 w-2.5 text-indigo-500" strokeWidth={2.5} />
          Suggestions for you
        </h3>
        <span className="ui-count-pill">{visible.length}</span>
      </div>

      <ul className="flex flex-col gap-1.5">
        <AnimatePresence initial={false}>
          {visible.map((s, idx) => {
            const accent = SUGGESTION_ACCENT[s.accent];
            const Icon = SUGGESTION_ICON[s.icon];
            return (
              <motion.li
                key={s.id}
                layout
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -8, transition: { duration: 0.18 } }}
                transition={{ delay: idx * 0.04, duration: 0.25, ease: EASE }}
              >
                <div
                  className={cn(
                    "group relative grid min-h-[72px] grid-cols-[1.75rem_minmax(0,1fr)_auto] items-start gap-2.5 overflow-hidden rounded-2xl border border-border/50 bg-card/60 px-3 py-2.5 transition-all duration-200 hover:border-border hover:bg-card",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-xl ring-1",
                      accent.bg,
                      accent.ring,
                    )}
                  >
                    <Icon className={cn("h-3.5 w-3.5", accent.fg)} strokeWidth={2.25} />
                  </span>
                  <button
                    onClick={s.run}
                    title={s.hint ? `${s.label} — ${s.hint}` : s.label}
                    className="flex min-w-0 max-w-full flex-col items-stretch justify-center self-stretch overflow-hidden text-left"
                  >
                    <span
                      title={s.label}
                      style={clampStyle(2)}
                      className={cn(
                        SUGGESTION_TEXT_BASE,
                        "text-[12.5px] font-medium leading-snug text-foreground",
                      )}
                    >
                      {s.label}
                    </span>
                    <span
                      title={s.hint}
                      style={clampStyle(1)}
                      className={cn(
                        SUGGESTION_TEXT_BASE,
                        "mt-0.5 text-[10.5px] leading-snug text-muted-foreground/85",
                      )}
                    >
                      {s.hint}
                    </span>
                  </button>

                  <div className="flex min-w-0 shrink-0 items-center gap-1 self-center">
                    <button
                      onClick={s.run}
                      aria-label={`Run suggestion: ${s.label}`}
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition",
                        accent.bg,
                        accent.fg,
                        "hover:brightness-110",
                      )}
                    >
                      Try
                    </button>
                    <button
                      onClick={() => dismiss(s.id)}
                      title="Dismiss"
                      aria-label="Dismiss suggestion"
                      className="grid h-5 w-5 place-items-center rounded-full text-muted-foreground/60 opacity-0 transition hover:bg-secondary hover:text-foreground group-hover:opacity-100"
                    >
                      <span className="text-[12px] leading-none">×</span>
                    </button>
                  </div>
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </section>
  );
}
