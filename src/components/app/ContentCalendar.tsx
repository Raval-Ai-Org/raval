import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { authedFetch } from "@/lib/authed-fetch";
import { streamImage } from "@/lib/streamImage";
import {
  CalendarDays,
  Sparkles,
  Loader2,
  Plus,
  Trash2,
  Check,
  ChevronLeft,
  ChevronRight,
  Wand2,
  Filter,
  Copy,
  RefreshCw,
  GripVertical,
} from "@/components/ui/gemini-icons";
import { Image as ImageIcon, X as XIcon } from "@/components/ui/gemini-icons";
import { FileText, Mail } from "@/components/ui/gemini-icons";
import { Upload, History, RotateCcw, Save, ArrowLeft, ArrowRight } from "@/components/ui/gemini-icons";
import { BrandLogo, type BrandKey } from "@/components/brand/BrandLogo";

/* ---------------------------------------------------------- */
/* Types & storage                                            */
/* ---------------------------------------------------------- */

type Channel =
  | "instagram"
  | "linkedin"
  | "twitter"
  | "tiktok"
  | "youtube"
  | "blog"
  | "email";

type EntryType =
  | "post"
  | "reel"
  | "carousel"
  | "thread"
  | "article"
  | "newsletter"
  | "video";

type Status = "idea" | "draft" | "approved" | "scheduled" | "published";

export type CalendarEntry = {
  id: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:mm
  channel: Channel;
  type: EntryType;
  title: string;
  hook?: string;
  caption?: string;
  hashtags?: string[];
  status: Status;
  imageUrl?: string; // legacy — mirrors images[0]
  images?: string[];
  versions?: VersionSnapshot[];
};

export type VersionSnapshot = {
  id: string;
  at: number; // epoch ms
  label?: string; // "manual" | "auto" | etc.
  title: string;
  hook?: string;
  caption?: string;
  hashtags?: string[];
  images?: string[];
};

const CHANNELS: { id: Channel; label: string; color: string; emoji: string; brand?: BrandKey }[] = [
  { id: "instagram", label: "Instagram", color: "#E1306C", emoji: "📸", brand: "instagram" },
  { id: "linkedin", label: "LinkedIn", color: "#0A66C2", emoji: "💼", brand: "linkedin" },
  { id: "twitter", label: "X / Twitter", color: "#000000", emoji: "🐦", brand: "x" },
  { id: "tiktok", label: "TikTok", color: "#000000", emoji: "🎵", brand: "tiktok" },
  { id: "youtube", label: "YouTube", color: "#FF0000", emoji: "▶️", brand: "youtube" },
  { id: "blog", label: "Blog", color: "#14b8a6", emoji: "📝" },
  { id: "email", label: "Email", color: "#f43f5e", emoji: "✉️" },
];

function ChannelIcon({ ch, size = 14, brand = true }: { ch: (typeof CHANNELS)[number]; size?: number; brand?: boolean }) {
  if (ch.brand) return <BrandLogo name={ch.brand} brand={brand} size={size} />;
  const Icon = ch.id === "blog" ? FileText : Mail;
  return <Icon style={{ width: size, height: size }} strokeWidth={2} />;
}
const CH_BY_ID = CHANNELS.reduce(
  (m, c) => ((m[c.id] = c), m),
  {} as Record<Channel, (typeof CHANNELS)[number]>,
);

const STATUS_COLORS: Record<Status, string> = {
  idea: "bg-muted text-muted-foreground",
  draft: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  approved: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  scheduled: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  published: "bg-foreground/10 text-foreground",
};

const STORAGE_KEY = (wsId: string | null) =>
  `content-calendar:${wsId ?? "default"}`;

function loadEntries(wsId: string | null): CalendarEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY(wsId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Migration: legacy imageUrl → images[]
    return parsed.map((e: any) => {
      const images: string[] = Array.isArray(e.images)
        ? e.images.filter((x: any) => typeof x === "string" && x)
        : e.imageUrl
        ? [e.imageUrl]
        : [];
      return {
        ...e,
        images,
        imageUrl: images[0],
        versions: Array.isArray(e.versions) ? e.versions : [],
      } as CalendarEntry;
    });
  } catch {
    return [];
  }
}
function saveEntries(wsId: string | null, entries: CalendarEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY(wsId), JSON.stringify(entries));
  } catch {}
}

/* ---------------------------------------------------------- */
/* Date helpers                                               */
/* ---------------------------------------------------------- */

const fmtYMD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseYMD = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const monthLabel = (d: Date) =>
  d.toLocaleDateString(undefined, { month: "long", year: "numeric" });

function buildMonthGrid(anchor: Date) {
  const first = startOfMonth(anchor);
  const startWeekday = (first.getDay() + 6) % 7; // Mon-start
  const start = addDays(first, -startWeekday);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/* ---------------------------------------------------------- */
/* AI generation                                              */
/* ---------------------------------------------------------- */

async function aiGenerateCalendar(input: {
  prompt: string;
  channels: Channel[];
  startDate: string;
  days: number;
  postsPerWeek: number;
}): Promise<CalendarEntry[]> {
  const channelList = input.channels.length
    ? input.channels.join(", ")
    : "instagram, linkedin, twitter";
  const sys = `Generate a content calendar.
Return ONLY a JSON array (no prose, no markdown fences). Each item:
{"date":"YYYY-MM-DD","time":"HH:mm","channel":"instagram|linkedin|twitter|tiktok|youtube|blog|email","type":"post|reel|carousel|thread|article|newsletter|video","title":"<6-10 words>","hook":"<scroll-stopping first line>","caption":"<full ready-to-post caption 60-180 words>","hashtags":["#tag1","#tag2"]}

Rules:
- Start on ${input.startDate}, span ${input.days} days.
- ~${input.postsPerWeek} posts/week total across these channels: ${channelList}.
- Mix formats (educational, behind-the-scenes, social proof, launch, lead-magnet).
- Use platform-native tone. LinkedIn: insight-led. Instagram: visual + emoji. X: punchy + thread when type=thread. Email: subject in title, body in caption.
- Real, specific copy. No placeholders like "[brand]".
- Output 8-${Math.min(40, Math.round((input.postsPerWeek * input.days) / 7) + 2)} items. JSON only.`;

  const res = await authedFetch("/api/ai-generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task: "freeform", prompt: `${sys}\n\nBrand context: ${input.prompt || "general brand"}` }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "AI generation failed");
  const text: string = data.text ?? "";
  // Extract JSON array
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("Couldn't parse AI response");
  const arr = JSON.parse(match[0]);
  if (!Array.isArray(arr)) throw new Error("Bad AI shape");
  return arr
    .filter((x) => x && x.date && x.channel && x.title)
    .map((x: any, i: number): CalendarEntry => ({
      id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
      date: String(x.date),
      time: x.time ? String(x.time) : "09:00",
      channel: (CH_BY_ID[x.channel as Channel] ? x.channel : "instagram") as Channel,
      type: (x.type as EntryType) || "post",
      title: String(x.title),
      hook: x.hook ? String(x.hook) : undefined,
      caption: x.caption ? String(x.caption) : undefined,
      hashtags: Array.isArray(x.hashtags) ? x.hashtags.slice(0, 12).map(String) : [],
      status: "draft",
    }));
}

async function aiRegenerateEntry(entry: CalendarEntry, brandContext: string): Promise<Partial<CalendarEntry>> {
  const sys = `Rewrite ONE social post. Keep the same date, time, channel and type.
Channel: ${entry.channel}. Type: ${entry.type}. Title concept: "${entry.title}".
Return ONLY a JSON object (no prose, no fences):
{"title":"<6-10 words, may refine>","hook":"<scroll-stopping first line>","caption":"<platform-native 60-180 words, no placeholders>","hashtags":["#tag1","#tag2"]}
Make it noticeably different from any previous version. Be specific and useful.`;
  const res = await authedFetch("/api/ai-generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task: "freeform",
      prompt: `${sys}\n\nBrand context: ${brandContext || "general brand"}\n\nPrevious hook: ${entry.hook ?? ""}\nPrevious caption: ${entry.caption ?? ""}`,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Regenerate failed");
  const text: string = data.text ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Couldn't parse AI response");
  const obj = JSON.parse(match[0]);
  return {
    title: obj.title ? String(obj.title) : entry.title,
    hook: obj.hook ? String(obj.hook) : entry.hook,
    caption: obj.caption ? String(obj.caption) : entry.caption,
    hashtags: Array.isArray(obj.hashtags) ? obj.hashtags.slice(0, 12).map(String) : entry.hashtags,
  };
}

/* ---------------------------------------------------------- */
/* Main component                                             */
/* ---------------------------------------------------------- */

export function ContentCalendar({ workspaceId }: { workspaceId: string | null }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [anchor, setAnchor] = useState<Date>(() => startOfMonth(new Date()));
  const [view, setView] = useState<"month" | "list">("month");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<CalendarEntry | null>(null);
  const [filter, setFilter] = useState<Channel | "all">("all");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [regenIds, setRegenIds] = useState<Set<string>>(new Set());
  const [showGenerator, setShowGenerator] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);

  const createBlankPost = (date?: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const item: CalendarEntry = {
      id,
      date: date ?? fmtYMD(new Date()),
      time: "09:00",
      channel: "instagram",
      type: "post",
      title: "Untitled post",
      status: "draft",
    };
    setEntries((arr) => [...arr, item]);
    setSelectedEntry(item);
    toast.success("Blank post created — fill it in");
  };

  // Track viewport to auto-switch to list view + collapse right rail on small screens
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 900px)");
    const apply = () => setIsNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (isNarrow && view === "month") setView("list");
  }, [isNarrow]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen to global event
  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener("open:content-calendar", h);
    return () => window.removeEventListener("open:content-calendar", h);
  }, []);

  // Load on workspace change / open
  useEffect(() => {
    setEntries(loadEntries(workspaceId));
  }, [workspaceId, open]);

  // Persist
  useEffect(() => {
    if (open) saveEntries(workspaceId, entries);
  }, [entries, workspaceId, open]);

  const filtered = useMemo(
    () => (filter === "all" ? entries : entries.filter((e) => e.channel === filter)),
    [entries, filter],
  );

  const byDate = useMemo(() => {
    const m = new Map<string, CalendarEntry[]>();
    for (const e of filtered) {
      const k = e.date;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return m;
  }, [filtered]);

  const grid = useMemo(() => buildMonthGrid(anchor), [anchor]);
  const todayYMD = fmtYMD(new Date());

  const updateEntry = (id: string, patch: Partial<CalendarEntry>) =>
    setEntries((arr) => arr.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  const removeEntry = (id: string) => {
    setEntries((arr) => arr.filter((e) => e.id !== id));
    setSelectedEntry(null);
  };

  const moveEntry = (id: string, patch: { date?: string; channel?: Channel }) => {
    setEntries((arr) => arr.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    setSelectedEntry((cur) => (cur && cur.id === id ? { ...cur, ...patch } : cur));
    if (patch.date && patch.channel) toast.success("Moved to new day & channel");
    else if (patch.date) toast.success("Rescheduled");
    else if (patch.channel) toast.success(`Switched to ${CH_BY_ID[patch.channel].label}`);
  };

  const regenerateEntry = async (id: string) => {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    setRegenIds((s) => new Set(s).add(id));
    try {
      const brandContext =
        (typeof window !== "undefined"
          ? localStorage.getItem(`calendar:prompt:${workspaceId ?? "default"}`)
          : "") ?? "";
      const patch = await aiRegenerateEntry(entry, brandContext);
      updateEntry(id, patch);
      setSelectedEntry((cur) => (cur && cur.id === id ? { ...cur, ...patch } : cur));
      toast.success("Rerolled hook, caption & hashtags");
    } catch (e: any) {
      toast.error(e?.message ?? "Regenerate failed");
    } finally {
      setRegenIds((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  };

  return (
    <AppModalShell
      open={open}
      onOpenChange={setOpen}
      size="xl"
      Icon={CalendarDays}
      title="Content Calendar"
      description={
        entries.length === 0
          ? "Tell Ravi about your brand and get a full posting plan in one click."
          : `${entries.length} ${entries.length === 1 ? "post" : "posts"} planned · drag any post to reschedule.`
      }
      headerAccessory={
        <Button
          size="sm"
          onClick={() => setShowGenerator((v) => !v)}
          className="shrink-0 gap-1.5 bg-gradient-to-r from-[hsl(var(--brand-blue))] to-[hsl(var(--brand-green))] text-white shadow-[0_6px_18px_-6px_hsl(var(--brand-blue)/0.7)] hover:opacity-95 lg:hidden"
        >
          <Wand2 className="h-3.5 w-3.5" />
          {showGenerator ? "Close" : "AI"}
        </Button>
      }
      bodyClassName="flex flex-col"
    >

        <div className="grid flex-1 min-h-0 grid-cols-1 lg:grid-cols-[1fr_300px] overflow-hidden">
          {/* LEFT — Calendar */}
          <div className="relative flex min-w-0 min-h-0 flex-col border-r border-border overflow-hidden">
            <Toolbar
              anchor={anchor}
              onPrev={() => setAnchor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
              onNext={() => setAnchor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
              onToday={() => setAnchor(startOfMonth(new Date()))}
              view={view}
              setView={setView}
              filter={filter}
              setFilter={setFilter}
              isNarrow={isNarrow}
              onNewPost={() => createBlankPost()}
            />
            {draggingId && (
              <ChannelLanes
                dragging
                onDropChannel={(ch) => moveEntry(draggingId, { channel: ch })}
              />
            )}

            {entries.length === 0 ? (
              <EmptyState
                onOpenGenerator={() => setShowGenerator(true)}
                onNewBlank={() => createBlankPost()}
              />
            ) : view === "month" ? (
              <MonthGrid
                grid={grid}
                anchor={anchor}
                byDate={byDate}
                todayYMD={todayYMD}
                onPickDate={(d) => setSelectedDate(d)}
                onPickEntry={(e) => setSelectedEntry(e)}
                draggingId={draggingId}
                onDragStartEntry={setDraggingId}
                onDragEndEntry={() => setDraggingId(null)}
                onDropOnDay={(ymd) => {
                  if (draggingId) moveEntry(draggingId, { date: ymd });
                }}
                onRegenerate={regenerateEntry}
                regenIds={regenIds}
              />
            ) : (
              <ListView
                entries={filtered}
                onPickEntry={(e) => setSelectedEntry(e)}
                onRegenerate={regenerateEntry}
                regenIds={regenIds}
                onDragStartEntry={setDraggingId}
                onDragEndEntry={() => setDraggingId(null)}
              />
            )}

            {/* Mobile generator overlay */}
            <AnimatePresence>
              {showGenerator && (
                <motion.div
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ type: "spring", stiffness: 320, damping: 32 }}
                  className="absolute inset-x-0 bottom-0 top-12 z-30 flex flex-col overflow-y-auto rounded-t-2xl border-t border-border bg-card shadow-2xl lg:hidden"
                >
                  <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/95 px-4 py-2 backdrop-blur">
                    <div className="flex items-center gap-2 text-[12.5px] font-semibold">
                      <Wand2 className="h-3.5 w-3.5 text-primary" /> AI Generator
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => setShowGenerator(false)} className="h-7 w-7" aria-label="Close AI generator">
                      <span aria-hidden className="text-lg leading-none">×</span>
                    </Button>
                  </div>
                  <Generator
                    workspaceId={workspaceId}
                    anchor={anchor}
                    onGenerated={(items) => {
                      setEntries((arr) => [...arr, ...items]);
                      setShowGenerator(false);
                      toast.success(`Added ${items.length} ideas to the calendar`);
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* RIGHT — AI generator + day inspector */}
          <div className="hidden lg:flex min-h-0 flex-col overflow-y-auto bg-muted/20">
            <Generator
              workspaceId={workspaceId}
              anchor={anchor}
              onGenerated={(items) => {
                setEntries((arr) => [...arr, ...items]);
                toast.success(`Added ${items.length} ideas to the calendar`);
              }}
            />

            <DayInspector
              date={selectedDate}
              entries={selectedDate ? byDate.get(selectedDate) ?? [] : []}
              onPickEntry={setSelectedEntry}
              onRegenerate={regenerateEntry}
              regenIds={regenIds}
              onAdd={(date) => {
                const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                const item: CalendarEntry = {
                  id,
                  date,
                  time: "09:00",
                  channel: "instagram",
                  type: "post",
                  title: "Untitled post",
                  status: "idea",
                };
                setEntries((arr) => [...arr, item]);
                setSelectedEntry(item);
              }}
            />
          </div>
        </div>

        {/* Entry editor */}
        <AnimatePresence>
          {selectedEntry && (
            <EntryEditor
              key={selectedEntry.id}
              entry={selectedEntry}
              onClose={() => setSelectedEntry(null)}
              onChange={(patch) => {
                updateEntry(selectedEntry.id, patch);
                setSelectedEntry((e) => (e ? { ...e, ...patch } : e));
              }}
              onDelete={() => removeEntry(selectedEntry.id)}
              onRegenerate={() => regenerateEntry(selectedEntry.id)}
              regenerating={regenIds.has(selectedEntry.id)}
            />
          )}
        </AnimatePresence>
    </AppModalShell>
  );
}

/* ---------------------------------------------------------- */
/* Toolbar                                                    */
/* ---------------------------------------------------------- */

function Toolbar({
  anchor, onPrev, onNext, onToday, view, setView, filter, setFilter, isNarrow, onNewPost,
}: {
  anchor: Date;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  view: "month" | "list";
  setView: (v: "month" | "list") => void;
  filter: Channel | "all";
  setFilter: (c: Channel | "all") => void;
  isNarrow?: boolean;
  onNewPost: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 sm:px-4 sm:py-2.5">
      <div className="flex items-center gap-1">
        <Button size="icon" variant="ghost" onClick={onPrev} className="h-7 w-7" aria-label="Previous month">
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Button>
        <div className="min-w-[110px] text-center text-[12.5px] font-semibold sm:min-w-[140px] sm:text-[13px]" aria-live="polite">
          {monthLabel(anchor)}
        </div>
        <Button size="icon" variant="ghost" onClick={onNext} className="h-7 w-7" aria-label="Next month">
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
        <Button size="sm" variant="outline" onClick={onToday} className="ml-1 h-7 px-2 text-[11px]">
          Today
        </Button>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button
          size="sm"
          onClick={onNewPost}
          className="h-7 gap-1 bg-gradient-to-r from-[hsl(var(--brand-blue))] to-[hsl(var(--brand-green))] px-2.5 text-[11px] text-white shadow-[0_6px_16px_-8px_hsl(var(--brand-blue)/0.7)] hover:opacity-95"
          title="Create a custom post"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">New post</span>
        </Button>
        <ChannelFilter value={filter} onChange={setFilter} />
        {!isNarrow && (
          <Tabs value={view} onValueChange={(v) => setView(v as any)}>
            <TabsList className="h-7">
              <TabsTrigger value="month" className="px-2 text-[11px]">Month</TabsTrigger>
              <TabsTrigger value="list" className="px-2 text-[11px]">List</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>
    </div>
  );
}

function ChannelFilter({ value, onChange }: { value: Channel | "all"; onChange: (v: Channel | "all") => void }) {
  return (
    <div className="flex items-center gap-1 rounded-full border border-border bg-card px-2 py-1">
      <Filter className="h-3 w-3 text-muted-foreground" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as any)}
        className="bg-transparent text-[11px] outline-none"
      >
        <option value="all">All channels</option>
        {CHANNELS.map((c) => (
          <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>
        ))}
      </select>
    </div>
  );
}

/* ---------------------------------------------------------- */
/* Channel lanes — drop targets to switch channel             */
/* ---------------------------------------------------------- */

function ChannelLanes({
  dragging, onDropChannel,
}: { dragging: boolean; onDropChannel: (ch: Channel) => void }) {
  const [overCh, setOverCh] = useState<Channel | null>(null);
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2 transition-colors",
        dragging ? "bg-[hsl(var(--brand-blue))]/5" : "bg-muted/20",
      )}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {dragging ? "Drop on a channel to switch" : "Channels"}
      </span>
      {CHANNELS.map((c) => {
        const isOver = overCh === c.id && dragging;
        return (
          <button
            key={c.id}
            type="button"
            tabIndex={-1}
            onDragOver={(ev) => { if (dragging) { ev.preventDefault(); setOverCh(c.id); } }}
            onDragLeave={() => setOverCh((cur) => (cur === c.id ? null : cur))}
            onDrop={(ev) => {
              if (!dragging) return;
              ev.preventDefault();
              setOverCh(null);
              onDropChannel(c.id);
            }}
            className={cn(
              "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition",
              dragging ? "border-dashed border-foreground/30" : "border-border bg-card text-muted-foreground",
              isOver && "scale-[1.04] border-solid text-white shadow-md",
            )}
            style={isOver ? { background: c.color, borderColor: c.color } : undefined}
          >
            <ChannelIcon ch={c} size={12} brand={!isOver} />
            {c.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------- */
/* Month grid                                                 */
/* ---------------------------------------------------------- */

function MonthGrid({
  grid, anchor, byDate, todayYMD, onPickDate, onPickEntry,
  draggingId, onDragStartEntry, onDragEndEntry, onDropOnDay,
  onRegenerate, regenIds,
}: {
  grid: Date[];
  anchor: Date;
  byDate: Map<string, CalendarEntry[]>;
  todayYMD: string;
  onPickDate: (d: string) => void;
  onPickEntry: (e: CalendarEntry) => void;
  draggingId: string | null;
  onDragStartEntry: (id: string) => void;
  onDragEndEntry: () => void;
  onDropOnDay: (ymd: string) => void;
  onRegenerate: (id: string) => void;
  regenIds: Set<string>;
}) {
  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const [overYmd, setOverYmd] = useState<string | null>(null);
  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <div className="mb-1 grid grid-cols-7 gap-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {DOW.map((d) => <div key={d} className="text-center">{d}</div>)}
      </div>
      <div className="grid flex-1 grid-cols-7 grid-rows-6 gap-1">
        {grid.map((d) => {
          const ymd = fmtYMD(d);
          const isCurMonth = d.getMonth() === anchor.getMonth();
          const isToday = ymd === todayYMD;
          const items = byDate.get(ymd) ?? [];
          const isDropTarget = !!draggingId;
          const isOver = overYmd === ymd && isDropTarget;
          return (
            <button
              key={ymd}
              onClick={() => onPickDate(ymd)}
              onDragOver={(ev) => { if (isDropTarget) { ev.preventDefault(); setOverYmd(ymd); } }}
              onDragLeave={() => setOverYmd((c) => (c === ymd ? null : c))}
              onDrop={(ev) => {
                if (!isDropTarget) return;
                ev.preventDefault();
                setOverYmd(null);
                onDropOnDay(ymd);
              }}
              className={cn(
                "group relative flex min-h-[80px] flex-col gap-1 rounded-xl border p-1.5 text-left transition-all",
                isCurMonth ? "border-border bg-card" : "border-border/40 bg-card/40 text-muted-foreground/60",
                isToday && "border-[hsl(var(--brand-blue))]/60 ring-1 ring-[hsl(var(--brand-blue))]/30",
                "hover:border-foreground/30 hover:shadow-sm",
                isDropTarget && "border-dashed",
                isOver && "border-[hsl(var(--brand-blue))] bg-[hsl(var(--brand-blue))]/10 ring-2 ring-[hsl(var(--brand-blue))]/40",
              )}
            >
              <div className="flex items-center justify-between">
                <span className={cn(
                  "text-[11px] font-semibold tabular-nums",
                  isToday && "grid h-5 w-5 place-items-center rounded-full bg-[hsl(var(--brand-blue))] text-white",
                )}>
                  {d.getDate()}
                </span>
                {items.length > 0 && (
                  <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
                    {items.length}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-0.5 overflow-hidden">
                {items.slice(0, 3).map((e) => {
                  const ch = CH_BY_ID[e.channel];
                  const regenning = regenIds.has(e.id);
                  return (
                    <span
                      key={e.id}
                      draggable
                      onDragStart={(ev) => {
                        ev.stopPropagation();
                        ev.dataTransfer.effectAllowed = "move";
                        ev.dataTransfer.setData("text/plain", e.id);
                        onDragStartEntry(e.id);
                      }}
                      onDragEnd={() => onDragEndEntry()}
                      role="button"
                      onClick={(ev) => { ev.stopPropagation(); onPickEntry(e); }}
                      className={cn(
                        "group/chip flex items-center gap-1 truncate rounded-md px-1 py-0.5 text-[10px] font-medium hover:brightness-110 cursor-grab active:cursor-grabbing",
                        draggingId === e.id && "opacity-50",
                      )}
                      style={{ background: `${ch.color}22`, color: ch.color }}
                    >
                      <span className="h-1 w-1 shrink-0 rounded-full" style={{ background: ch.color }} />
                      <span className="truncate">{e.title}</span>
                      <button
                        type="button"
                        title="Regenerate hook, caption & hashtags"
                        onClick={(ev) => { ev.stopPropagation(); onRegenerate(e.id); }}
                        className="ml-auto hidden h-3.5 w-3.5 shrink-0 place-items-center rounded-sm hover:bg-foreground/10 group-hover/chip:grid"
                      >
                        {regenning ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RefreshCw className="h-2.5 w-2.5" />}
                      </button>
                    </span>
                  );
                })}
                {items.length > 3 && (
                  <span className="px-1 text-[9.5px] text-muted-foreground">+{items.length - 3} more</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- */
/* List view                                                  */
/* ---------------------------------------------------------- */

function ListView({
  entries, onPickEntry, onRegenerate, regenIds, onDragStartEntry, onDragEndEntry,
}: {
  entries: CalendarEntry[];
  onPickEntry: (e: CalendarEntry) => void;
  onRegenerate: (id: string) => void;
  regenIds: Set<string>;
  onDragStartEntry: (id: string) => void;
  onDragEndEntry: () => void;
}) {
  const sorted = [...entries].sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")));
  if (sorted.length === 0) {
    return (
      <div className="grid flex-1 place-items-center p-8 text-center text-[13px] text-muted-foreground">
        Nothing planned yet. Use the AI generator on the right to draft a full calendar.
      </div>
    );
  }
  return (
    <div className="flex-1 space-y-1 overflow-y-auto p-3">
      {sorted.map((e) => {
        const ch = CH_BY_ID[e.channel];
        const regenning = regenIds.has(e.id);
        return (
          <div
            key={e.id}
            draggable
            onDragStart={(ev) => {
              ev.dataTransfer.effectAllowed = "move";
              ev.dataTransfer.setData("text/plain", e.id);
              onDragStartEntry(e.id);
            }}
            onDragEnd={() => onDragEndEntry()}
            onClick={() => onPickEntry(e)}
            className="group flex w-full cursor-grab items-center gap-3 rounded-xl border border-border bg-card p-2.5 text-left hover:border-foreground/30 hover:shadow-sm active:cursor-grabbing"
          >
            <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg" style={{ background: `${ch.color}22`, color: ch.color }}>
              <ChannelIcon ch={ch} size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: ch.color }}>{ch.label}</span>
                <span className="text-[10px] text-muted-foreground">· {e.type}</span>
              </div>
              <div className="truncate text-[13px] font-medium">{e.title}</div>
              {e.hook && <div className="truncate text-[11.5px] text-muted-foreground">{e.hook}</div>}
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10.5px] tabular-nums">
                {e.date}{e.time ? ` · ${e.time}` : ""}
              </span>
              <span className={cn("rounded-full px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide", STATUS_COLORS[e.status])}>{e.status}</span>
            </div>
            <button
              type="button"
              title="Regenerate hook, caption & hashtags"
              onClick={(ev) => { ev.stopPropagation(); onRegenerate(e.id); }}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground hover:border-foreground/30"
            >
              {regenning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------- */
/* AI Generator                                               */
/* ---------------------------------------------------------- */

function Generator({
  workspaceId, anchor, onGenerated,
}: { workspaceId: string | null; anchor: Date; onGenerated: (e: CalendarEntry[]) => void }) {
  const [prompt, setPrompt] = useState("");
  const [channels, setChannels] = useState<Channel[]>(["instagram", "linkedin", "twitter"]);
  const [postsPerWeek, setPostsPerWeek] = useState(5);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Load saved brand-context from localStorage for nicer DX
  useEffect(() => {
    try {
      const last = localStorage.getItem(`calendar:prompt:${workspaceId ?? "default"}`);
      if (last) setPrompt(last);
    } catch {}
  }, [workspaceId]);

  const toggleCh = (c: Channel) =>
    setChannels((arr) => (arr.includes(c) ? arr.filter((x) => x !== c) : [...arr, c]));

  const generate = async () => {
    setLoading(true);
    try {
      try { localStorage.setItem(`calendar:prompt:${workspaceId ?? "default"}`, prompt); } catch {}
      const startDate = fmtYMD(anchor);
      const items = await aiGenerateCalendar({ prompt, channels, startDate, days, postsPerWeek });
      if (items.length === 0) throw new Error("No items returned");
      onGenerated(items);
    } catch (e: any) {
      toast.error(e?.message ?? "Generation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-3 border-b border-border p-4">
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-primary/10 text-primary">
          <Wand2 className="h-3.5 w-3.5" />
        </span>
        <div className="flex-1">
          <h3 className="text-[12.5px] font-semibold">Generate with AI</h3>
          <p className="text-[10.5px] text-muted-foreground">Tell us about your brand. We do the rest.</p>
        </div>
      </div>

      <textarea
        rows={4}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="e.g. We sell organic skincare for busy moms. Mix tips, before/afters and product highlights."
        className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[12.5px] outline-none focus:border-primary"
      />

      <div className="flex items-center justify-between rounded-lg bg-muted/40 px-2.5 py-1.5 text-[11px]">
        <span className="text-muted-foreground">
          <b className="text-foreground tabular-nums">{postsPerWeek}</b> posts/week ·{" "}
          <b className="text-foreground tabular-nums">{days}</b> days ·{" "}
          <b className="text-foreground tabular-nums">{channels.length}</b> channels
        </span>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-[11px] font-medium text-primary hover:underline"
        >
          {showAdvanced ? "Hide" : "Customize"}
        </button>
      </div>

      {showAdvanced && (
        <div className="space-y-2.5 rounded-lg border border-border bg-background/40 p-2.5">
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Channels</div>
            <div className="flex flex-wrap gap-1.5">
              {CHANNELS.map((c) => {
                const on = channels.includes(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => toggleCh(c.id)}
                    className={cn(
                      "flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-medium transition",
                      on ? "border-transparent text-white" : "border-border bg-card text-muted-foreground hover:text-foreground",
                    )}
                    style={on ? { background: c.color } : undefined}
                  >
                    <ChannelIcon ch={c} size={12} brand={!on} />{c.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[10.5px] font-medium text-muted-foreground">
              Posts / week
              <Input
                type="number"
                min={1}
                max={21}
                value={postsPerWeek}
                onChange={(e) => setPostsPerWeek(Math.max(1, Math.min(21, Number(e.target.value) || 1)))}
                className="h-8 text-[12px]"
              />
            </label>
            <label className="flex flex-col gap-1 text-[10.5px] font-medium text-muted-foreground">
              Span (days)
              <Input
                type="number"
                min={7}
                max={90}
                value={days}
                onChange={(e) => setDays(Math.max(7, Math.min(90, Number(e.target.value) || 7)))}
                className="h-8 text-[12px]"
              />
            </label>
          </div>
        </div>
      )}

      <Button
        onClick={generate}
        disabled={loading || channels.length === 0}
        className="w-full bg-gradient-to-r from-[hsl(var(--brand-blue))] to-[hsl(var(--brand-green))] text-white shadow-[0_8px_24px_-8px_hsl(var(--brand-blue)/0.7)] hover:opacity-95"
      >
        {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
        {loading ? "Drafting your plan…" : "Generate my plan"}
      </Button>
    </section>
  );
}

/* ---------------------------------------------------------- */
/* Day inspector                                              */
/* ---------------------------------------------------------- */

function DayInspector({
  date, entries, onPickEntry, onAdd, onRegenerate, regenIds,
}: {
  date: string | null;
  entries: CalendarEntry[];
  onPickEntry: (e: CalendarEntry) => void;
  onAdd: (date: string) => void;
  onRegenerate: (id: string) => void;
  regenIds: Set<string>;
}) {
  if (!date) {
    return (
      <section className="p-4 text-[11.5px] text-muted-foreground">
        Tap any day in the calendar to inspect or add posts.
      </section>
    );
  }
  const d = parseYMD(date);
  return (
    <section className="space-y-2 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Day</div>
          <div className="text-[13px] font-semibold">{d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</div>
        </div>
        <Button size="sm" variant="outline" onClick={() => onAdd(date)} className="h-7 gap-1 text-[11px]">
          <Plus className="h-3 w-3" /> Add
        </Button>
      </div>
      {entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-3 text-center text-[11.5px] text-muted-foreground">
          Nothing planned for this day.
        </p>
      ) : (
        <div className="space-y-1.5">
          {entries.map((e) => {
            const ch = CH_BY_ID[e.channel];
            const regenning = regenIds.has(e.id);
            return (
              <div
                key={e.id}
                onClick={() => onPickEntry(e)}
                className="flex w-full cursor-pointer items-start gap-2 rounded-lg border border-border bg-card p-2 text-left hover:border-foreground/30"
              >
                <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full" style={{ background: ch.color }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium">{e.title}</div>
                  <div className="truncate text-[10.5px] text-muted-foreground">{ch.label} · {e.type} · {e.time ?? "09:00"}</div>
                </div>
                <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide", STATUS_COLORS[e.status])}>{e.status}</span>
                <button
                  type="button"
                  title="Regenerate"
                  onClick={(ev) => { ev.stopPropagation(); onRegenerate(e.id); }}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  {regenning ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------------- */
/* Entry editor (sheet-style overlay)                         */
/* ---------------------------------------------------------- */

const STATUSES: Status[] = ["idea", "draft", "approved", "scheduled", "published"];

function EntryEditor({
  entry, onChange, onDelete, onClose, onRegenerate, regenerating,
}: {
  entry: CalendarEntry;
  onChange: (patch: Partial<CalendarEntry>) => void;
  onDelete: () => void;
  onClose: () => void;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const ch = CH_BY_ID[entry.channel];
  const [imgLoading, setImgLoading] = useState(false);
  const [imgFinal, setImgFinal] = useState(true);
  const [streamingPreview, setStreamingPreview] = useState<string | undefined>(undefined);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const images = entry.images ?? (entry.imageUrl ? [entry.imageUrl] : []);
  const versions = entry.versions ?? [];

  useEffect(() => {
    setStreamingPreview(undefined);
    setImgFinal(true);
  }, [entry.id]);

  /* ---------- version history ---------- */
  function snapshot(label: VersionSnapshot["label"] = "auto") {
    const last = versions[0];
    const same =
      last &&
      last.title === entry.title &&
      (last.hook ?? "") === (entry.hook ?? "") &&
      (last.caption ?? "") === (entry.caption ?? "") &&
      JSON.stringify(last.hashtags ?? []) === JSON.stringify(entry.hashtags ?? []) &&
      JSON.stringify(last.images ?? []) === JSON.stringify(images);
    if (same) return;
    const snap: VersionSnapshot = {
      id: `v-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      at: Date.now(),
      label,
      title: entry.title,
      hook: entry.hook,
      caption: entry.caption,
      hashtags: entry.hashtags,
      images: [...images],
    };
    const next = [snap, ...versions].slice(0, 20);
    onChange({ versions: next });
  }
  function restoreVersion(v: VersionSnapshot) {
    // Snapshot current state first (so restore is itself undoable)
    snapshot("auto");
    const imgs = v.images ?? [];
    onChange({
      title: v.title,
      hook: v.hook,
      caption: v.caption,
      hashtags: v.hashtags,
      images: imgs,
      imageUrl: imgs[0],
    });
    toast.success("Version restored");
    setShowHistory(false);
  }

  /* ---------- image helpers ---------- */
  function setImages(next: string[]) {
    onChange({ images: next, imageUrl: next[0] });
  }
  function addImage(url: string) {
    setImages([...images, url]);
  }
  function removeImage(i: number) {
    const next = images.filter((_, idx) => idx !== i);
    setImages(next);
    snapshot("auto");
  }
  function moveImage(from: number, to: number) {
    if (to < 0 || to >= images.length || from === to) return;
    const next = [...images];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setImages(next);
  }

  async function generateVisual() {
    const basePrompt = [entry.title, entry.hook, entry.caption]
      .filter(Boolean)
      .join(" — ")
      .slice(0, 600);
    if (!basePrompt) {
      toast.error("Add a title or caption first");
      return;
    }
    const prompt = `Create a clean, on-brand ${ch.label} ${entry.type} visual. Subject: ${basePrompt}. Modern, premium, high contrast, no text overlay.`;
    setImgLoading(true);
    setImgFinal(false);
    try {
      await streamImage(prompt, (dataUrl, isFinal) => {
        setStreamingPreview(dataUrl);
        if (isFinal) {
          setImgFinal(true);
          addImage(dataUrl);
          setStreamingPreview(undefined);
          snapshot("auto");
        }
      });
      toast.success("Visual ready");
    } catch (e: any) {
      toast.error(e?.message ?? "Image generation failed");
    } finally {
      setImgLoading(false);
    }
  }

  function onUploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    const valid = list.filter((f) => {
      if (!f.type.startsWith("image/")) {
        toast.error(`${f.name}: not an image`);
        return false;
      }
      if (f.size > 8 * 1024 * 1024) {
        toast.error(`${f.name}: over 8 MB`);
        return false;
      }
      return true;
    });
    if (!valid.length) return;
    Promise.all(
      valid.map(
        (f) =>
          new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result ?? ""));
            r.onerror = () => reject(new Error("Read failed"));
            r.readAsDataURL(f);
          }),
      ),
    )
      .then((urls) => {
        const next = [...images, ...urls.filter(Boolean)];
        setImages(next);
        snapshot("auto");
        toast.success(`${urls.length} image${urls.length > 1 ? "s" : ""} added`);
      })
      .catch(() => toast.error("Couldn't read one or more images"));
  }

  const copyCaption = () => {
    const text = [entry.title, entry.hook, entry.caption, (entry.hashtags ?? []).join(" ")]
      .filter(Boolean).join("\n\n");
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-20 bg-background/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 40, opacity: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }}
        className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => {
          if (e.dataTransfer?.types?.includes("Files")) {
            e.preventDefault();
            setIsDragOver(true);
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setIsDragOver(false);
        }}
        onDrop={(e) => {
          if (e.dataTransfer?.files?.length) {
            e.preventDefault();
            setIsDragOver(false);
            onUploadFiles(e.dataTransfer.files);
          }
        }}
      >
        {isDragOver && (
          <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center bg-primary/10 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-primary bg-card/95 px-6 py-5 shadow-xl">
              <Upload className="h-6 w-6 text-primary" />
              <div className="text-[13px] font-semibold">Drop images to add</div>
              <div className="text-[11px] text-muted-foreground">Up to 8 MB each</div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: `${ch.color}22`, color: ch.color }}><ChannelIcon ch={ch} size={14} /></span>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{ch.label} · {entry.type}</div>
              <div className="text-[12.5px] font-semibold">Edit post</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant={showHistory ? "default" : "ghost"}
              onClick={() => setShowHistory((v) => !v)}
              className="h-7 gap-1 px-2 text-[11.5px]"
              title="Version history"
            >
              <History className="h-3.5 w-3.5" />
              {versions.length > 0 && (
                <span className="rounded-full bg-foreground/10 px-1.5 text-[10px] tabular-nums">{versions.length}</span>
              )}
            </Button>
            <Button size="icon" variant="ghost" onClick={onClose} className="h-7 w-7" aria-label="Close post editor">
              <span aria-hidden className="text-lg leading-none">×</span>
            </Button>
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <Field label="Title">
            <Input
              value={entry.title}
              onChange={(e) => onChange({ title: e.target.value })}
              onBlur={() => snapshot("auto")}
              className="h-8 text-[12.5px]"
            />
          </Field>

          <div className="grid grid-cols-3 gap-2">
            <Field label="Date">
              <Input type="date" value={entry.date} onChange={(e) => onChange({ date: e.target.value })} className="h-8 text-[12px]" />
            </Field>
            <Field label="Time">
              <Input type="time" value={entry.time ?? "09:00"} onChange={(e) => onChange({ time: e.target.value })} className="h-8 text-[12px]" />
            </Field>
            <Field label="Channel">
              <select
                value={entry.channel}
                onChange={(e) => onChange({ channel: e.target.value as Channel })}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-[12px]"
              >
                {CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Hook">
            <Input
              value={entry.hook ?? ""}
              onChange={(e) => onChange({ hook: e.target.value })}
              onBlur={() => snapshot("auto")}
              placeholder="Scroll-stopping first line"
              className="h-8 text-[12.5px]"
            />
          </Field>

          <Field label="Caption">
            <textarea
              value={entry.caption ?? ""}
              onChange={(e) => onChange({ caption: e.target.value })}
              onBlur={() => snapshot("auto")}
              rows={8}
              className="w-full resize-y rounded-md border border-input bg-background p-2 text-[12.5px] leading-relaxed outline-none focus:border-primary"
            />
          </Field>

          <Field label="Hashtags">
            <Input
              value={(entry.hashtags ?? []).join(" ")}
              onChange={(e) => onChange({ hashtags: e.target.value.split(/\s+/).filter(Boolean) })}
              onBlur={() => snapshot("auto")}
              placeholder="#brand #launch"
              className="h-8 text-[12px]"
            />
          </Field>

          <Field label={`Visuals${images.length ? ` · ${images.length}` : ""}`}>
            <div className="space-y-2">
              <ImageGallery
                images={images}
                streaming={streamingPreview}
                streamingFinal={imgFinal}
                onRemove={removeImage}
                onMove={moveImage}
                onUploadFiles={onUploadFiles}
              />
              <div className="grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={generateVisual}
                  disabled={imgLoading}
                  className="justify-center gap-1.5"
                >
                  {imgLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {imgLoading ? "Generating…" : images.length ? "Add AI visual" : "AI visual"}
                </Button>
                <label className="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 text-[12.5px] font-medium hover:bg-secondary">
                  <Upload className="h-3.5 w-3.5" />
                  {images.length ? "Add images" : "Upload"}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) onUploadFiles(e.target.files);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>
            </div>
          </Field>

          <Field label="Status">
            <div className="flex flex-wrap gap-1">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => onChange({ status: s })}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide capitalize transition",
                    entry.status === s ? STATUS_COLORS[s] : "bg-secondary text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border p-3">
          <Button variant="ghost" size="sm" onClick={onDelete} className="text-destructive hover:text-destructive">
            <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { snapshot("manual"); toast.success("Version saved"); }}
              title="Save current version"
            >
              <Save className="mr-1.5 h-3.5 w-3.5" /> Save
            </Button>
            <Button variant="outline" size="sm" onClick={onRegenerate} disabled={regenerating}>
              {regenerating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              Regenerate
            </Button>
            <Button variant="outline" size="sm" onClick={copyCaption}>
              <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy
            </Button>
            <Button size="sm" onClick={() => { onChange({ status: "approved" }); toast.success("Approved"); }}>
              <Check className="mr-1.5 h-3.5 w-3.5" /> Approve
            </Button>
          </div>
        </div>

        <AnimatePresence>
          {showHistory && (
            <HistoryPanel
              versions={versions}
              onClose={() => setShowHistory(false)}
              onRestore={restoreVersion}
              onClear={() => { onChange({ versions: [] }); toast.success("History cleared"); }}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}

/* ---------------------------------------------------------- */
/* Image gallery (multi-image, reorder, delete)               */
/* ---------------------------------------------------------- */

function ImageGallery({
  images,
  streaming,
  streamingFinal,
  onRemove,
  onMove,
  onUploadFiles,
}: {
  images: string[];
  streaming?: string;
  streamingFinal: boolean;
  onRemove: (i: number) => void;
  onMove: (from: number, to: number) => void;
  onUploadFiles: (files: FileList | File[]) => void;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  if (!images.length && !streaming) {
    return (
      <label
        className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border bg-muted/40 py-8 text-center transition hover:border-primary/60 hover:bg-primary/5"
        onDragOver={(e) => {
          if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          if (e.dataTransfer?.files?.length) {
            e.preventDefault();
            onUploadFiles(e.dataTransfer.files);
          }
        }}
      >
        <ImageIcon className="h-5 w-5 text-muted-foreground" />
        <div className="text-[12px] font-medium">Drop images here</div>
        <div className="text-[10.5px] text-muted-foreground">or click to browse · up to 8 MB each</div>
        <input
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) onUploadFiles(e.target.files);
            e.currentTarget.value = "";
          }}
        />
      </label>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {images.map((src, i) => (
        <div
          key={`${i}-${src.slice(-24)}`}
          draggable
          onDragStart={(e) => {
            setDragIdx(i);
            e.dataTransfer.effectAllowed = "move";
            // Prevent file-drop handler from firing on internal reorder
            try { e.dataTransfer.setData("text/x-image-idx", String(i)); } catch {}
          }}
          onDragOver={(e) => {
            if (dragIdx !== null) {
              e.preventDefault();
              setOverIdx(i);
            }
          }}
          onDragLeave={() => setOverIdx((cur) => (cur === i ? null : cur))}
          onDrop={(e) => {
            if (dragIdx !== null) {
              e.preventDefault();
              e.stopPropagation();
              onMove(dragIdx, i);
            }
            setDragIdx(null);
            setOverIdx(null);
          }}
          onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
          className={cn(
            "group relative overflow-hidden rounded-xl border bg-muted transition",
            i === 0 ? "border-primary/60 ring-1 ring-primary/30" : "border-border",
            overIdx === i && dragIdx !== null && dragIdx !== i && "ring-2 ring-primary",
            dragIdx === i && "opacity-50",
          )}
        >
          <img src={src} alt={`Visual ${i + 1}`} className="block aspect-square w-full object-cover" />

          {i === 0 && (
            <div className="absolute left-1.5 top-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary-foreground shadow">
              Cover
            </div>
          )}

          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/70 to-transparent p-1.5 opacity-0 transition group-hover:opacity-100">
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => onMove(i, i - 1)}
                disabled={i === 0}
                className="grid h-6 w-6 place-items-center rounded-md bg-white/90 text-foreground shadow disabled:opacity-30"
                aria-label="Move left"
              >
                <ArrowLeft className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => onMove(i, i + 1)}
                disabled={i === images.length - 1}
                className="grid h-6 w-6 place-items-center rounded-md bg-white/90 text-foreground shadow disabled:opacity-30"
                aria-label="Move right"
              >
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
            <span className="rounded bg-white/90 px-1.5 text-[9.5px] font-semibold tabular-nums text-foreground">
              {i + 1}/{images.length}
            </span>
          </div>

          <button
            type="button"
            onClick={() => onRemove(i)}
            className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-background/90 text-muted-foreground shadow opacity-0 transition group-hover:opacity-100 hover:text-destructive"
            aria-label="Remove image"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>

          <div className="absolute left-1.5 top-1.5 cursor-grab text-white/0 group-hover:text-white/90" aria-hidden>
            <GripVertical className="h-3.5 w-3.5 drop-shadow" />
          </div>
        </div>
      ))}

      {streaming && (
        <div className="relative overflow-hidden rounded-xl border border-dashed border-primary/60 bg-muted">
          <img
            src={streaming}
            alt="Generating"
            className={cn(
              "block aspect-square w-full object-cover transition-[filter] duration-300",
              streamingFinal ? "blur-0" : "blur-2xl scale-105",
            )}
          />
          {!streamingFinal && (
            <div className="absolute inset-0 grid place-items-center bg-background/20">
              <div className="flex items-center gap-1.5 rounded-full bg-background/85 px-2 py-1 text-[10.5px] font-medium backdrop-blur">
                <Loader2 className="h-3 w-3 animate-spin" /> Rendering…
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- */
/* Version history panel                                      */
/* ---------------------------------------------------------- */

function HistoryPanel({
  versions, onClose, onRestore, onClear,
}: {
  versions: VersionSnapshot[];
  onClose: () => void;
  onRestore: (v: VersionSnapshot) => void;
  onClear: () => void;
}) {
  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
      className="absolute inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col border-l border-border bg-card shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          <div>
            <div className="text-[12.5px] font-semibold">Version history</div>
            <div className="text-[10.5px] text-muted-foreground">
              {versions.length === 0 ? "No versions yet" : `${versions.length} saved`}
            </div>
          </div>
        </div>
        <Button size="icon" variant="ghost" onClick={onClose} className="h-7 w-7" aria-label="Close version history">
          <span aria-hidden className="text-lg leading-none">×</span>
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {versions.length === 0 ? (
          <div className="grid h-full place-items-center text-center text-[12px] text-muted-foreground">
            <div>
              <History className="mx-auto mb-2 h-6 w-6 opacity-40" />
              Edits will be snapshotted here.<br />
              Click <span className="font-semibold text-foreground">Save</span> to mark milestones.
            </div>
          </div>
        ) : (
          <ol className="space-y-2">
            {versions.map((v, idx) => (
              <li
                key={v.id}
                className="group rounded-xl border border-border bg-background p-2.5 transition hover:border-primary/50 hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold">
                        {idx === 0 ? "Latest" : `v${versions.length - idx}`}
                      </span>
                      {v.label === "manual" && (
                        <span className="rounded-full bg-primary/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-primary">
                          Saved
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground">{formatAgo(v.at)}</span>
                    </div>
                    <div className="mt-1 truncate text-[12px] font-medium">{v.title || "Untitled"}</div>
                    {v.hook && (
                      <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{v.hook}</div>
                    )}
                  </div>
                  {v.images && v.images[0] && (
                    <img src={v.images[0]} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />
                  )}
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="text-[10px] text-muted-foreground">
                    {(v.images?.length ?? 0)} image{(v.images?.length ?? 0) === 1 ? "" : "s"}
                    {v.hashtags?.length ? ` · ${v.hashtags.length} tags` : ""}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onRestore(v)}
                    className="h-7 gap-1 px-2 text-[11px]"
                  >
                    <RotateCcw className="h-3 w-3" /> Restore
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      {versions.length > 0 && (
        <div className="border-t border-border p-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="w-full text-[11.5px] text-muted-foreground hover:text-destructive"
          >
            Clear history
          </Button>
        </div>
      )}
    </motion.div>
  );
}

function formatAgo(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

/* ---------------------------------------------------------- */
/* Empty state                                                */
/* ---------------------------------------------------------- */

function EmptyState({ onOpenGenerator, onNewBlank }: { onOpenGenerator: () => void; onNewBlank: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[hsl(var(--brand-blue))] to-[hsl(var(--brand-green))] text-white shadow-[0_12px_32px_-12px_hsl(var(--brand-blue)/0.7)]">
          <CalendarDays className="h-7 w-7" />
        </div>
        <h3 className="text-[16px] font-semibold">Your calendar is empty</h3>
        <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-muted-foreground">
          Describe your brand and goals on the right and Ravi will draft a full multi-channel plan with hooks, captions and hashtags — ready to schedule.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button
            size="sm"
            onClick={onOpenGenerator}
            className="gap-1.5 bg-gradient-to-r from-[hsl(var(--brand-blue))] to-[hsl(var(--brand-green))] text-white shadow-[0_8px_24px_-8px_hsl(var(--brand-blue)/0.7)] hover:opacity-95"
          >
            <Sparkles className="h-3.5 w-3.5" /> Generate my plan
          </Button>
          <Button size="sm" variant="outline" onClick={onNewBlank} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Start blank post
          </Button>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-2 text-left">
          {[
            { t: "Multi-channel", d: "IG · LinkedIn · X · TikTok · Email" },
            { t: "Ready captions", d: "Hook + body + hashtags" },
            { t: "Drag to move", d: "Reschedule across days & channels" },
          ].map((f) => (
            <div key={f.t} className="rounded-xl border border-border bg-card p-2.5">
              <div className="text-[11px] font-semibold">{f.t}</div>
              <div className="mt-0.5 text-[10.5px] text-muted-foreground">{f.d}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}