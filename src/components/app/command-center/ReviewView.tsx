"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  Check,
  CheckCircle,
  Inbox,
  RefreshCw,
  Rocket,
  Spinner,
  X,
} from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { EmptyState } from "@/components/ui/empty-state";
import { dsGhostBtn, dsIconBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { cn } from "@/lib/utils";
import type { ReviewItem } from "@/lib/agency/command-center";
import type { CommandCenter } from "./use-command-center";
import { ChannelMark, ClientMark, ClientTag, channelLabel, timeAgo } from "./ui";

export type QueueTab = "review" | "ready" | "failed";

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

export function ReviewView({
  cc,
  tab,
  onTab,
  clientFilter,
  onClientFilter,
  onOpenClient,
}: {
  cc: CommandCenter;
  tab: QueueTab;
  onTab: (t: QueueTab) => void;
  clientFilter: string;
  onClientFilter: (id: string) => void;
  onOpenClient: (id: string) => void;
}) {
  const source = tab === "review" ? cc.review : tab === "ready" ? cc.ready : cc.failed;
  const [channel, setChannel] = useState("all");
  const items = useMemo(
    () =>
      source.filter(
        (i) =>
          (clientFilter === "all" || i.workspaceId === clientFilter) &&
          (channel === "all" || (i.channel ?? "other") === channel),
      ),
    [source, clientFilter, channel],
  );
  const perClient = useMemo(() => {
    const m = new Map<string, number>();
    source.forEach((i) => m.set(i.workspaceId, (m.get(i.workspaceId) ?? 0) + 1));
    return m;
  }, [source]);
  const channels = useMemo(
    () => [...new Set(source.map((i) => i.channel ?? "other"))].sort(),
    [source],
  );

  const [focusId, setFocusId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);

  // Keep focus and selection on items that still exist.
  useEffect(() => {
    setSelected((prev) => {
      const live = new Set(items.map((i) => i.id));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
    if (!items.some((i) => i.id === focusId)) setFocusId(items[0]?.id ?? null);
  }, [items, focusId]);
  useEffect(() => {
    setSelected(new Set());
    setChannel("all");
  }, [tab]);

  const focused = items.find((i) => i.id === focusId) ?? null;
  const selectedItems = items.filter((i) => selected.has(i.id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = items.length > 0 && selected.size === items.length;

  const advance = (id: string) => {
    const idx = items.findIndex((i) => i.id === id);
    const next = items[idx + 1] ?? items[idx - 1];
    setFocusId(next?.id ?? null);
  };
  const decideOne = async (it: ReviewItem, d: "approved" | "rejected") => {
    advance(it.id);
    await cc.decide([it], d);
  };

  // Keyboard: J/K move, X select, A approve, R send back, Enter preview.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (!items.length) return;
      const idx = Math.max(
        0,
        items.findIndex((i) => i.id === focusId),
      );
      const key = e.key.toLowerCase();
      if (key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setFocusId(items[Math.min(items.length - 1, idx + 1)].id);
      } else if (key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setFocusId(items[Math.max(0, idx - 1)].id);
      } else if (key === "x" && focused) {
        toggle(focused.id);
      } else if (tab === "review" && key === "a" && focused?.canDecide) {
        void decideOne(focused, "approved");
      } else if (tab === "review" && key === "r" && focused?.canDecide) {
        void decideOne(focused, "rejected");
      } else if (e.key === "Enter" && focused) {
        setSheetOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, focusId, focused, tab]);

  useEffect(() => {
    if (focusId)
      document.getElementById(`cc-item-${focusId}`)?.scrollIntoView({ block: "nearest" });
  }, [focusId]);

  const tabs: { id: QueueTab; label: string; count: number }[] = [
    { id: "review", label: "To review", count: cc.review.length },
    { id: "ready", label: "Ready to post", count: cc.ready.length },
    { id: "failed", label: "Failed", count: cc.failed.length },
  ];

  return (
    <div className="ds-enter">
      {/* Queue tabs */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="ds-well inline-flex w-full rounded-full p-1 sm:w-auto" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => onTab(t.id)}
              className={cn(
                "relative flex-1 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors sm:flex-none",
                tab === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab === t.id && (
                <motion.span
                  layoutId="cc-queue-tab"
                  className="absolute inset-0 rounded-full bg-background shadow-sm ring-1 ring-border/60"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              <span className="relative inline-flex items-center gap-1.5">
                {t.label}
                <span
                  className={cn(
                    "tabular-nums text-[11.5px]",
                    t.id === "failed" && t.count > 0 ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {t.count}
                </span>
              </span>
            </button>
          ))}
        </div>
        {tab === "review" && items.length > 0 && (
          <p className="hidden text-[11.5px] text-muted-foreground lg:block">
            <Kbd>J</Kbd>/<Kbd>K</Kbd> move · <Kbd>A</Kbd> approve · <Kbd>R</Kbd> send back ·{" "}
            <Kbd>X</Kbd> select
          </p>
        )}
      </div>

      {/* Filters */}
      {source.length > 0 && (
        <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <FilterPill
            active={clientFilter === "all"}
            onClick={() => onClientFilter("all")}
            label="All clients"
            count={source.length}
          />
          {cc.clients
            .filter((c) => perClient.has(c.id))
            .map((c) => (
              <FilterPill
                key={c.id}
                active={clientFilter === c.id}
                onClick={() => onClientFilter(c.id)}
                label={c.name}
                count={perClient.get(c.id) ?? 0}
                mark={<ClientMark client={c} size={16} />}
              />
            ))}
          {channels.length > 1 && (
            <select
              aria-label="Channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="ml-auto h-8 shrink-0 rounded-full border border-border/70 bg-card px-3 text-[12.5px] outline-none"
            >
              <option value="all">All channels</option>
              {channels.map((ch) => (
                <option key={ch} value={ch}>
                  {channelLabel(ch)}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {items.length === 0 ? (
        <div className="ds-tile mt-4 py-6">
          <EmptyState
            icon={tab === "failed" ? CheckCircle : Inbox}
            title={
              tab === "review"
                ? "Nothing to review"
                : tab === "ready"
                  ? "Nothing waiting to post"
                  : "No failed posts"
            }
            description={
              tab === "review"
                ? "New drafts from every client land here."
                : tab === "ready"
                  ? "Approved posts show up here until they're scheduled."
                  : undefined
            }
          />
        </div>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          {/* List */}
          <div className="ds-tile overflow-hidden">
            <div className="flex items-center gap-3 border-b border-[var(--ds-tile-border)] px-4 py-2.5">
              <CheckBox
                checked={allSelected}
                partial={selected.size > 0 && !allSelected}
                onChange={() =>
                  setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)))
                }
                label="Select all"
              />
              <span className="text-[12px] text-muted-foreground">
                {selected.size > 0 ? `${selected.size} selected` : `${items.length} items`}
              </span>
            </div>
            <ul className="max-h-[62vh] overflow-y-auto p-1.5">
              <AnimatePresence initial={false}>
                {items.map((it) => (
                  <motion.li
                    key={it.id}
                    id={`cc-item-${it.id}`}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: 40, transition: { duration: 0.2 } }}
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-2xl px-2.5 py-2.5 transition-colors",
                      focusId === it.id
                        ? "bg-[var(--ds-well-bg-hover)]"
                        : "hover:bg-[var(--ds-well-bg)]",
                    )}
                  >
                    {focusId === it.id && (
                      <motion.span
                        layoutId="cc-focus-bar"
                        className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full bg-primary"
                      />
                    )}
                    <CheckBox
                      checked={selected.has(it.id)}
                      onChange={() => toggle(it.id)}
                      label={`Select ${it.title}`}
                    />
                    <button
                      onClick={() => {
                        setFocusId(it.id);
                        if (window.matchMedia("(max-width: 1023px)").matches) setSheetOpen(true);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <ChannelMark channel={it.channel} size={34} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium">{it.title}</span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                          <ClientTag name={it.clientName} />
                          <span className="truncate">
                            {channelLabel(it.channel)} · {timeAgo(it.createdAt, cc.now)}
                          </span>
                        </span>
                      </span>
                    </button>
                    <RowActions cc={cc} item={it} tab={tab} onDecide={decideOne} />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>

          {/* Preview (desktop) */}
          <div className="hidden lg:block">
            <div className="sticky top-[132px]">
              <AnimatePresence mode="wait">
                {focused && (
                  <motion.div
                    key={focused.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <PostPreview
                      cc={cc}
                      item={focused}
                      tab={tab}
                      onDecide={decideOne}
                      onOpenClient={onOpenClient}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      )}

      {/* Preview (mobile) */}
      <Sheet open={sheetOpen && !!focused} onOpenChange={setSheetOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[92dvh] overflow-y-auto rounded-t-[28px] p-4 lg:hidden"
        >
          <SheetTitle className="sr-only">{focused?.title ?? "Preview"}</SheetTitle>
          {focused && (
            <PostPreview
              cc={cc}
              item={focused}
              tab={tab}
              onDecide={async (it, d) => {
                setSheetOpen(false);
                await decideOne(it, d);
              }}
              onOpenClient={onOpenClient}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Floating bulk bar */}
      <AnimatePresence>
        {selectedItems.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="fixed inset-x-0 bottom-5 z-40 mx-auto flex w-[calc(100%-32px)] max-w-md items-center gap-2 rounded-full border border-border/70 bg-background/90 p-1.5 pl-4 shadow-[var(--ds-window-shadow)] backdrop-blur-xl"
          >
            <span className="flex-1 text-[13px] font-medium tabular-nums">
              {selectedItems.length} selected
            </span>
            {tab === "review" && (
              <>
                <button
                  className={cn(dsGhostBtn, "h-9 px-3.5 text-[13px]")}
                  onClick={() => void cc.decide(selectedItems, "rejected")}
                >
                  <X className="h-3.5 w-3.5" /> Send back
                </button>
                <button
                  className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px]")}
                  onClick={() => void cc.decide(selectedItems, "approved")}
                >
                  <Check className="h-3.5 w-3.5" /> Approve
                </button>
              </>
            )}
            <button
              aria-label="Clear selection"
              className={dsIconBtn}
              onClick={() => setSelected(new Set())}
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function RowActions({
  cc,
  item,
  tab,
  onDecide,
}: {
  cc: CommandCenter;
  item: ReviewItem;
  tab: QueueTab;
  onDecide: (it: ReviewItem, d: "approved" | "rejected") => Promise<void>;
}) {
  const busy = cc.busy.has(item.id);
  if (!item.canDecide) {
    return (
      <span className="shrink-0 rounded-full bg-[var(--ds-well-bg)] px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
        View only
      </span>
    );
  }
  if (busy) return <Spinner className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />;
  if (tab === "review") {
    return (
      <div className="flex shrink-0 items-center gap-1 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        <button
          aria-label="Send back"
          title="Send back (R)"
          onClick={() => void onDecide(item, "rejected")}
          className={cn(dsIconBtn, "hover:text-destructive")}
        >
          <X className="h-4 w-4" />
        </button>
        <button
          aria-label="Approve"
          title="Approve (A)"
          onClick={() => void onDecide(item, "approved")}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition hover:bg-primary/90 active:scale-95"
        >
          <Check className="h-4 w-4" />
        </button>
      </div>
    );
  }
  return null;
}

function PostPreview({
  cc,
  item,
  tab,
  onDecide,
  onOpenClient,
}: {
  cc: CommandCenter;
  item: ReviewItem;
  tab: QueueTab;
  onDecide: (it: ReviewItem, d: "approved" | "rejected") => Promise<void>;
  onOpenClient: (id: string) => void;
}) {
  const client = cc.clientMap.get(item.workspaceId);
  const busy = cc.busy.has(item.id);
  const canPost = item.source === "content" && item.canDecide && item.channel !== "tiktok";
  return (
    <div className="ds-tile overflow-hidden">
      <div className="flex items-center gap-3 border-b border-[var(--ds-tile-border)] p-4">
        {client && <ClientMark client={client} size={36} />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold">{item.clientName}</div>
          <div className="text-[12px] text-muted-foreground">
            {channelLabel(item.channel)} · {item.kind === "approval" ? "Request" : item.kind}
          </div>
        </div>
        <ChannelMark channel={item.channel} size={32} />
      </div>

      <div className="max-h-[48vh] space-y-3 overflow-y-auto p-4">
        {tab === "failed" && (
          <div className="flex items-start gap-2 rounded-2xl bg-destructive/10 p-3 text-[12.5px] text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            This post didn&apos;t go out. Retry, or open it in the workspace to see why.
          </div>
        )}
        {item.mediaUrl && /^https?:\/\//.test(item.mediaUrl) && (
          /* User media from storage/provider — not an app asset. */
          <img
            src={item.mediaUrl}
            alt=""
            className="max-h-72 w-full rounded-2xl object-cover ring-1 ring-border/60"
          />
        )}
        <h3 className="text-[16px] font-semibold leading-snug tracking-tight">{item.title}</h3>
        {item.body ? (
          <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-foreground/90">
            {item.body}
          </p>
        ) : (
          <p className="text-[13px] text-muted-foreground">No text yet.</p>
        )}
        {item.hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {item.hashtags.map((h) => (
              <span
                key={h}
                className="rounded-full bg-[var(--ds-well-bg)] px-2 py-0.5 text-[11.5px] font-medium text-foreground/75"
              >
                {h.startsWith("#") ? h : `#${h}`}
              </span>
            ))}
          </div>
        )}
        <div className="text-[11.5px] text-muted-foreground">
          Created {timeAgo(item.createdAt, cc.now)}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--ds-tile-border)] bg-[var(--ds-well-bg)] p-3">
        <button
          onClick={() => onOpenClient(item.workspaceId)}
          className={cn(dsGhostBtn, "h-9 px-3.5 text-[13px]")}
        >
          Open <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!item.canDecide ? (
            <span className="text-[12px] text-muted-foreground">View only</span>
          ) : tab === "review" ? (
            <>
              <button
                disabled={busy}
                onClick={() => void onDecide(item, "rejected")}
                className={cn(dsGhostBtn, "h-9 px-3.5 text-[13px]")}
              >
                {busy ? (
                  <Spinner className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <X className="h-3.5 w-3.5" />
                )}{" "}
                Send back
              </button>
              <button
                disabled={busy}
                onClick={() => void onDecide(item, "approved")}
                className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px]")}
              >
                {busy ? (
                  <Spinner className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                Approve
              </button>
            </>
          ) : tab === "ready" ? (
            canPost && (
              <>
                <SchedulePicker cc={cc} item={item} />
                <button
                  disabled={busy}
                  onClick={() => void cc.publishNow(item)}
                  className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px]")}
                >
                  {busy ? (
                    <Spinner className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Rocket className="h-3.5 w-3.5" />
                  )}
                  Post now
                </button>
              </>
            )
          ) : (
            <button
              disabled={busy}
              onClick={() => void cc.retry(item)}
              className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px]")}
              title="Uses one publishing credit"
            >
              {busy ? (
                <Spinner className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SchedulePicker({ cc, item }: { cc: CommandCenter; item: ReviewItem }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(() => {
    const d = new Date(Date.now() + 24 * 3600e3);
    d.setHours(10, 0, 0, 0);
    return toLocalInput(d);
  });
  const when = new Date(value);
  const valid = !Number.isNaN(when.getTime()) && when.getTime() > Date.now() + 5 * 60_000;
  const quick = [
    { label: "In 1 hour", at: () => new Date(Date.now() + 3600e3) },
    {
      label: "Tomorrow 10am",
      at: () => {
        const d = new Date(Date.now() + 24 * 3600e3);
        d.setHours(10, 0, 0, 0);
        return d;
      },
    },
    {
      label: "Monday 9am",
      at: () => {
        const d = new Date();
        d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
        d.setHours(9, 0, 0, 0);
        return d;
      },
    },
  ];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={cn(dsGhostBtn, "h-9 px-3.5 text-[13px]")}>
          <CalendarClock className="h-3.5 w-3.5" /> Schedule
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 rounded-[20px] p-3">
        <div className="ds-label mb-2">Post on</div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {quick.map((q) => (
            <button
              key={q.label}
              onClick={() => setValue(toLocalInput(q.at()))}
              className="rounded-full bg-[var(--ds-well-bg)] px-2.5 py-1 text-[12px] font-medium hover:bg-[var(--ds-well-bg-hover)]"
            >
              {q.label}
            </button>
          ))}
        </div>
        <input
          type="datetime-local"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-10 w-full rounded-xl border border-border/70 bg-[var(--ds-well-bg)] px-3 text-[13px] outline-none focus:border-primary/50"
        />
        <button
          disabled={!valid || cc.busy.has(item.id)}
          onClick={async () => {
            if (await cc.scheduleAt(item, when)) setOpen(false);
          }}
          className={cn(dsPrimaryBtn, "mt-3 h-9 w-full text-[13px]")}
        >
          {cc.busy.has(item.id) ? (
            <Spinner className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : null}
          {valid
            ? `Schedule for ${when.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`
            : "Pick a future time"}
        </button>
      </PopoverContent>
    </Popover>
  );
}

function FilterPill({
  active,
  label,
  count,
  onClick,
  mark,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
  mark?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${label} · ${count}`}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-all",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border/70 bg-card text-foreground/80 hover:border-foreground/25 hover:text-foreground",
      )}
    >
      {mark}
      <span className="max-w-[140px] truncate">{label}</span>
      <span className={cn("tabular-nums", active ? "text-background/70" : "text-muted-foreground")}>
        {count}
      </span>
    </button>
  );
}

function CheckBox({
  checked,
  partial,
  onChange,
  label,
}: {
  checked: boolean;
  partial?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      role="checkbox"
      aria-checked={partial ? "mixed" : checked}
      aria-label={label}
      onClick={onChange}
      className={cn(
        "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[6px] border transition-all",
        checked || partial
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background hover:border-foreground/40",
      )}
    >
      {checked ? (
        <Check className="h-3 w-3" strokeWidth={3} />
      ) : partial ? (
        <span className="h-0.5 w-2 rounded-full bg-current" />
      ) : null}
    </button>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mx-0.5 inline-grid h-[18px] min-w-[18px] place-items-center rounded-md border border-border/70 bg-background px-1 font-sans text-[10.5px] font-semibold text-foreground/70">
      {children}
    </kbd>
  );
}
