"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Bot,
  Plus,
  Trash2,
  Search,
  FileText,
  Share2,
  Pause,
  Play,
  Mail,
  Calendar,
  Repeat,
  Check,
  Wand2,
} from "@/components/brand/icons";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAgentToggles } from "@/hooks/use-agent-toggles";
import { agentList } from "@/lib/agents";
import { useServerFn } from "@/lib/use-server-fn";
import {
  listScheduledJobs,
  createScheduledJob,
  updateScheduledJob,
  deleteScheduledJob,
  runScheduledJobNow,
  type ScheduledJob,
} from "@/lib/schedules.functions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const PILL =
  "group relative inline-flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-card/70 px-2.5 sm:px-3 text-[12px] font-medium text-foreground/80 backdrop-blur-md transition-[transform,box-shadow,background-color,border-color,color] duration-200 ease-out hover:-translate-y-px hover:border-foreground/20 hover:bg-card hover:text-foreground hover:shadow-[0_4px_12px_-6px_rgba(0,0,0,0.12)] active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

// Segment style — borderless inner button used inside the unified Status Cluster.
const SEG =
  "group relative inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11.5px] font-medium text-muted-foreground transition-colors duration-150 hover:bg-secondary/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function useOpenOnEvent(eventName: string, setOpen: (v: boolean) => void) {
  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener(eventName, h);
    return () => window.removeEventListener(eventName, h);
  }, [eventName, setOpen]);
}

/* ───────────────────────── BRAND DNA ───────────────────────── */

import { BrandDnaButton } from "./BrandDnaPanel";
export { BrandDnaButton };

/* ───────────────────────── SCHEDULE ───────────────────────── */

const AGENT_ICONS: Record<string, any> = { seo: Search, content: FileText, social: Share2 };

type Cadence = "once" | "hourly" | "daily" | "weekly";
type TaskType = "social-post" | "content-gen" | "seo-audit" | "crm-message" | "custom";

type Preset = {
  label: string;
  taskType: TaskType;
  channel: string;
  agent: "scout" | "spark" | "echo";
  cadence: Cadence;
  hour: number;
  minute: number;
  weekday?: number; // 0=Sun..6=Sat (for weekly)
  icon: any;
  prompt: string;
};

const PRESETS: Preset[] = [
  {
    label: "Daily Instagram post",
    taskType: "social-post",
    channel: "instagram",
    agent: "echo",
    cadence: "daily",
    hour: 9,
    minute: 0,
    icon: Share2,
    prompt: "Write today's Instagram post for the brand.",
  },
  {
    label: "Daily LinkedIn post",
    taskType: "social-post",
    channel: "linkedin",
    agent: "echo",
    cadence: "daily",
    hour: 10,
    minute: 0,
    icon: Share2,
    prompt: "Write today's LinkedIn post for the brand.",
  },
  {
    label: "Weekly newsletter",
    taskType: "crm-message",
    channel: "email",
    agent: "spark",
    cadence: "weekly",
    hour: 7,
    minute: 0,
    weekday: 1,
    icon: Mail,
    prompt: "Draft this week's customer newsletter.",
  },
  {
    label: "Weekly SEO brief",
    taskType: "seo-audit",
    channel: "blog",
    agent: "scout",
    cadence: "weekly",
    hour: 10,
    minute: 0,
    weekday: 2,
    icon: FileText,
    prompt: "Produce one on-page SEO brief targeting a relevant query for the brand.",
  },
];

function isoLocal(d: Date) {
  const tz = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

function computeNextRunFromPreset(p: Preset): Date {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setHours(p.hour, p.minute, 0, 0);
  if (p.cadence === "weekly" && typeof p.weekday === "number") {
    const diff = (p.weekday - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + diff);
  }
  if (d.getTime() <= Date.now()) {
    if (p.cadence === "hourly") d.setHours(d.getHours() + 1);
    else if (p.cadence === "daily") d.setDate(d.getDate() + 1);
    else if (p.cadence === "weekly") d.setDate(d.getDate() + 7);
    else d.setMinutes(d.getMinutes() + 5);
  }
  return d;
}

function cadenceLabel(j: Pick<ScheduledJob, "cadence" | "next_run_at">) {
  const when = new Date(j.next_run_at).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const c =
    j.cadence === "once"
      ? "Once"
      : j.cadence === "hourly"
        ? "Hourly"
        : j.cadence === "daily"
          ? "Daily"
          : "Weekly";
  return `${c} · next ${when}`;
}

const TASK_ICON: Record<string, any> = {
  "social-post": Share2,
  "content-gen": FileText,
  "seo-audit": Search,
  "crm-message": Mail,
  custom: Wand2,
};

export function ScheduleButton({ workspaceId }: { workspaceId: string | null }) {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [cadence, setCadence] = useState<Cadence>("once");
  const [taskType, setTaskType] = useState<TaskType>("social-post");
  const [channel, setChannel] = useState("instagram");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  const [open, setOpen] = useState(false);
  useOpenOnEvent("open:tasks", setOpen);
  useOpenOnEvent("open:schedule", setOpen);

  const list = useServerFn(listScheduledJobs);
  const create = useServerFn(createScheduledJob);
  const update = useServerFn(updateScheduledJob);
  const remove = useServerFn(deleteScheduledJob);
  const runNow = useServerFn(runScheduledJobNow);

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setJobs([]);
      return;
    }
    setLoading(true);
    try {
      const rows = await list({ data: { workspaceId } });
      setJobs(rows);
    } catch (e) {
      console.warn("scheduled jobs load failed", e);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, list]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const submit = async () => {
    if (!workspaceId || !title.trim() || !due) return;
    setBusy(true);
    try {
      const iso = new Date(due).toISOString();
      await create({
        data: {
          workspaceId,
          title: title.trim(),
          nextRunAt: iso,
          cadence,
          taskType,
          channel,
          agent: taskType === "seo-audit" ? "scout" : taskType === "crm-message" ? "spark" : "echo",
          prompt: prompt.trim() || null,
        },
      });
      setTitle("");
      setDue("");
      setPrompt("");
      toast.success("Scheduled", { description: new Date(iso).toLocaleString() });
      refresh();
    } catch (e) {
      toast.error("Could not schedule", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const addPreset = async (p: Preset) => {
    if (!workspaceId) return;
    const next = computeNextRunFromPreset(p);
    try {
      await create({
        data: {
          workspaceId,
          title: p.label,
          nextRunAt: next.toISOString(),
          cadence: p.cadence,
          taskType: p.taskType,
          channel: p.channel,
          agent: p.agent,
          prompt: p.prompt,
        },
      });
      toast.success("Added to schedule", { description: next.toLocaleString() });
      refresh();
    } catch (e) {
      toast.error("Could not add", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const quickWhen = (mins: number) => {
    const d = new Date(Date.now() + mins * 60_000);
    setDue(isoLocal(d));
  };

  const togglePause = async (j: ScheduledJob) => {
    try {
      await update({ data: { id: j.id, patch: { active: !j.active } } });
      refresh();
    } catch (e) {
      toast.error("Update failed");
    }
  };
  const del = async (id: string) => {
    await remove({ data: { id } });
    refresh();
  };
  const fireNow = async (id: string) => {
    try {
      await runNow({ data: { id } });
      toast.success("Running now", { description: "Draft will appear in approvals." });
      window.dispatchEvent(new CustomEvent("content:changed"));
      refresh();
    } catch (e) {
      toast.error("Could not run", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className={SEG}
          title="Schedule recurring posts, emails & campaigns"
          aria-label="Open schedule"
        >
          <Calendar
            className="h-3.5 w-3.5 transition-colors group-hover:text-[hsl(var(--brand-blue))]"
            strokeWidth={2}
            aria-hidden
          />
          <span className="hidden md:inline">Schedule</span>
          {jobs.filter((j) => j.active).length > 0 && (
            <motion.span
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 380, damping: 22 }}
              className="grid h-4 min-w-[16px] place-items-center rounded-full bg-[hsl(var(--brand-blue))] px-1 text-[9.5px] font-semibold tabular-nums text-background"
              aria-label={`${jobs.filter((j) => j.active).length} active schedules`}
            >
              {jobs.filter((j) => j.active).length}
            </motion.span>
          )}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-aura" /> Schedule
          </DialogTitle>
          <DialogDescription>
            Plan recurring or one-off drafts. The scheduler runs every minute — when a job is due,
            agents generate it grounded in your Brand DNA and add it to approvals.
          </DialogDescription>
        </DialogHeader>

        {/* Presets */}
        <div className="mb-3">
          <div className="mb-1.5 px-0.5 ui-eyebrow">Quick add</div>
          <div className="grid grid-cols-2 gap-1.5">
            {PRESETS.map((p) => {
              const Icon = p.icon;
              return (
                <button
                  key={p.label}
                  onClick={() => addPreset(p)}
                  disabled={!workspaceId}
                  className="group flex items-center gap-2 rounded-lg border border-border bg-card/60 p-2 text-left transition hover:-translate-y-px hover:border-foreground/30 hover:bg-card"
                >
                  <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-secondary text-foreground/80">
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium">{p.label}</div>
                    <div className="truncate text-[10.5px] text-muted-foreground">
                      {p.cadence === "daily"
                        ? `Daily · ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`
                        : `Weekly · ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][p.weekday ?? 1]} ${p.hour}:${String(p.minute).padStart(2, "0")}`}
                    </div>
                  </div>
                  <Plus className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom */}
        <div className="mb-3 space-y-2 rounded-xl border border-border bg-card px-2.5 py-2">
          <div className="flex items-center gap-2">
            <Repeat className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Title — e.g. Launch teaser post"
              className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/70"
            />
            <Button
              size="sm"
              onClick={submit}
              disabled={!title.trim() || !due || busy || !workspaceId}
            >
              {busy ? "…" : "Schedule"}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pl-5">
            <select
              value={taskType}
              onChange={(e) => setTaskType(e.target.value as TaskType)}
              className="h-7 rounded-md border border-border bg-background px-1.5 text-[11.5px] outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="social-post">Social post</option>
              <option value="content-gen">Blog / article</option>
              <option value="seo-audit">SEO brief</option>
              <option value="crm-message">Email</option>
              <option value="custom">Custom prompt</option>
            </select>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="h-7 rounded-md border border-border bg-background px-1.5 text-[11.5px] outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="instagram">Instagram</option>
              <option value="x">X</option>
              <option value="linkedin">LinkedIn</option>
              <option value="tiktok">TikTok</option>
              <option value="blog">Blog</option>
              <option value="email">Email</option>
              <option value="web">Web</option>
            </select>
            <select
              value={cadence}
              onChange={(e) => setCadence(e.target.value as Cadence)}
              className="h-7 rounded-md border border-border bg-background px-1.5 text-[11.5px] outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="once">Once</option>
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pl-5">
            <input
              type="datetime-local"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="h-7 rounded-md border border-border bg-background px-2 text-[11.5px] outline-none focus:ring-1 focus:ring-ring"
            />
            {[
              { l: "In 1h", m: 60 },
              { l: "Tomorrow 9am", m: 24 * 60 },
              { l: "Next Mon", m: 7 * 24 * 60 },
            ].map((q) => (
              <button
                key={q.l}
                onClick={() => quickWhen(q.m)}
                className="rounded-full border border-border bg-background px-2 py-0.5 text-[10.5px] text-muted-foreground hover:border-foreground/30 hover:text-foreground"
              >
                {q.l}
              </button>
            ))}
          </div>
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Optional prompt — what should the agent focus on?"
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-[12px] outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Upcoming */}
        <div className="mb-1 flex items-center justify-between px-0.5">
          <span className="ui-eyebrow">Upcoming</span>
          {loading && <span className="text-[10.5px] text-muted-foreground">Loading…</span>}
        </div>
        <div className="max-h-[40vh] space-y-1.5 overflow-auto pr-1">
          {jobs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-background/40 py-8 text-center">
              <p className="ui-empty-title">Nothing scheduled yet</p>
              <p className="ui-empty-body">Add a recurring post above, or use a quick preset.</p>
            </div>
          ) : (
            jobs.map((t) => {
              const Icon = TASK_ICON[t.task_type] ?? Calendar;
              return (
                <motion.div
                  key={t.id}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "group flex items-center gap-2.5 rounded-xl border border-border bg-card/60 p-2.5",
                    !t.active && "opacity-60",
                  )}
                >
                  <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{t.title}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {cadenceLabel(t)}
                      {t.channel ? ` · ${t.channel}` : ""}
                      {t.last_run_status === "error"
                        ? ` · last run failed`
                        : t.run_count > 0
                          ? ` · ran ${t.run_count}×`
                          : ""}
                    </div>
                  </div>
                  <button
                    onClick={() => fireNow(t.id)}
                    aria-label={`Run "${t.title}" now`}
                    className="rounded-md px-1.5 py-1 text-[10.5px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                    title="Run now"
                  >
                    <Play className="h-3 w-3" aria-hidden />
                  </button>
                  <button
                    onClick={() => togglePause(t)}
                    aria-label={t.active ? `Pause "${t.title}"` : `Resume "${t.title}"`}
                    aria-pressed={!t.active}
                    className="rounded-md px-1.5 py-1 text-[10.5px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                    title={t.active ? "Pause" : "Resume"}
                  >
                    {t.active ? (
                      <Pause className="h-3 w-3" aria-hidden />
                    ) : (
                      <Play className="h-3 w-3" aria-hidden />
                    )}
                  </button>
                  <button
                    onClick={() => del(t.id)}
                    className="opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label={`Remove "${t.title}"`}
                  >
                    <Trash2
                      className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive"
                      aria-hidden
                    />
                  </button>
                </motion.div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────── 24/7 AUTOPILOT ───────────────────────── */

export function AutopilotButton() {
  const { activeCount, total, set, setAll, isOn } = useAgentToggles();
  const allOn = activeCount === total;
  const anyOn = activeCount > 0;
  const [open, setOpen] = useState(false);
  useOpenOnEvent("open:autopilot", setOpen);

  const [cadence, setCadence] = useState<Record<string, string>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem("agent-cadence");
      if (raw) setCadence(JSON.parse(raw));
    } catch {}
  }, []);
  const updateCadence = (id: string, v: string) => {
    setCadence((c) => {
      const next = { ...c, [id]: v };
      try {
        localStorage.setItem("agent-cadence", JSON.stringify(next));
      } catch {}
      return next;
    });
  };
  const CADENCES = ["Live", "Hourly", "Daily 9am", "Weekly Mon"];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className={cn(PILL, anyOn && "border-emerald-500/40")}
          title="24/7 agents running for you"
          aria-label={`Autopilot — ${activeCount} of ${total} agents active`}
        >
          <span className="relative flex h-2 w-2" aria-hidden>
            {anyOn && (
              <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500 opacity-75" />
            )}
            <span
              className={cn(
                "relative h-2 w-2 rounded-full",
                anyOn ? "bg-emerald-500" : "bg-muted-foreground",
              )}
            />
          </span>
          <Bot className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline tabular-nums">
            {activeCount}/{total} <span className="text-muted-foreground">24/7</span>
          </span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-aura" /> 24/7 Agents
          </DialogTitle>
          <DialogDescription>
            Always-on agents that watch, react and ship while you sleep. Pick a cadence for each.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between rounded-xl border border-border bg-card p-3">
          <div>
            <div className="text-[13px] font-semibold">Master autopilot</div>
            <div className="text-[11.5px] text-muted-foreground">
              {anyOn ? "Running — pause everything." : "Paused — wake the team."}
            </div>
          </div>
          <Button
            size="sm"
            variant={allOn ? "outline" : "default"}
            onClick={() => setAll(!allOn)}
            className="gap-1.5"
          >
            {allOn ? (
              <>
                <Pause className="h-3.5 w-3.5" /> Pause all
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" /> Run all
              </>
            )}
          </Button>
        </div>
        <div className="mt-2 space-y-1.5 max-h-[50vh] overflow-auto pr-1">
          {agentList.map((a) => {
            const on = isOn(a.id);
            const c = cadence[a.id] ?? "Live";
            return (
              <div key={a.id} className="rounded-lg border border-border bg-card/60 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium">{a.role}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {a.missions[0]?.label ?? ""}
                    </div>
                  </div>
                  <Switch checked={on} onCheckedChange={(v) => set(a.id, v)} />
                </div>
                {on && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {CADENCES.map((label) => (
                      <button
                        key={label}
                        onClick={() => updateCadence(a.id, label)}
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[10.5px] transition",
                          c === label
                            ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────── BAR ───────────────────────── */

export function TopBarActions({ workspaceId }: { workspaceId: string | null }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="flex h-8 items-center rounded-lg border border-border/60 bg-card/50 px-0.5 backdrop-blur-md shadow-[0_1px_0_hsl(0_0%_100%/0.04)_inset]"
    >
      <BrandDnaButton workspaceId={workspaceId} />
      <span className="mx-0.5 h-3.5 w-px bg-border/60" />
      <ScheduleButton workspaceId={workspaceId} />
      <span className="mx-0.5 h-3.5 w-px bg-border/60" />
      <AutopilotButton />
    </motion.div>
  );
}
