"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Bell,
  CalendarClock,
  Plus,
  Trash2,
  Sparkles,
  Loader2,
  Activity,
  Rocket,
  Settings2,
  Zap,
  CheckCircle2,
  Clock,
} from "@/components/ui/gemini-icons";
import { StarAgent } from "@/components/StarAgent";
import type { Agent } from "@/lib/agents";
import { useAgentTasks } from "@/hooks/use-agent-tasks";
import { useAgentRuntime } from "@/hooks/use-agent-runtime";
import { useAgentToggles } from "@/hooks/use-agent-toggles";
import { deriveMood } from "@/lib/agent-mood";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const CADENCES = ["Live", "Hourly", "Daily", "Weekly"] as const;
const CADENCE_HINTS: Record<string, string> = {
  Live: "Runs continuously in the background",
  Hourly: "Checks in every hour",
  Daily: "One focused run each morning",
  Weekly: "A summary run every Monday",
};

interface Props {
  agent: Agent;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function AgentManageDialog({ agent, open, onOpenChange }: Props) {
  const accent = `hsl(${agent.accentHue} 75% 55%)`;
  const accentSoft = `hsl(${agent.accentHue} 75% 55% / 0.12)`;
  const { isOn, set } = useAgentToggles();
  const on = isOn(agent.id);

  // Cadence (persisted)
  const [cadence, setCadence] = useState<string>("Live");
  useEffect(() => {
    try {
      const raw = localStorage.getItem("agent-cadence");
      if (raw) setCadence(JSON.parse(raw)?.[agent.id] ?? "Live");
    } catch {}
  }, [agent.id, open]);
  const saveCadence = (v: string) => {
    setCadence(v);
    try {
      const raw = localStorage.getItem("agent-cadence");
      const map = raw ? JSON.parse(raw) : {};
      map[agent.id] = v;
      localStorage.setItem("agent-cadence", JSON.stringify(map));
    } catch {}
  };

  // Tasks
  const { tasks, add, toggle, remove, generate, generating } = useAgentTasks(agent.id);
  const [title, setTitle] = useState("");
  const openTasks = tasks.filter((t) => !t.done);
  const doneTasks = tasks.filter((t) => t.done);

  // Runtime (live progress)
  const runtime = useAgentRuntime(agent);
  const mood = useMemo(
    () =>
      deriveMood(agent, {
        active: runtime.active,
        progress: runtime.current?.progress ?? null,
        hasCurrent: !!runtime.current,
        recentlyCompleted: false,
        justDeployed: false,
      }),
    [agent, runtime.active, runtime.current],
  );

  const aiSuggest = async () => {
    try {
      await generate({
        agentName: agent.name,
        agentRole: agent.role,
        missions: agent.missions.map((m) => ({ label: m.label, description: m.description })),
      });
      toast.success(`${agent.name} added new tasks`);
    } catch {
      toast.error("Couldn't reach the AI. Try again.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-hidden p-0 gap-0">
        {/* Header */}
        <div
          className="relative border-b border-border/60 p-6"
          style={{
            background: `radial-gradient(120% 100% at 0% 0%, ${accentSoft}, transparent 60%)`,
          }}
        >
          <div className="flex items-start gap-4">
            <div
              className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl ring-1"
              style={{
                background: accentSoft,
                boxShadow: `0 0 0 1px ${accentSoft}, 0 8px 32px -8px ${accent}`,
              }}
            >
              <StarAgent mood={mood.mood} size={52} animate={on} hue={agent.accentHue} />
            </div>
            <div className="min-w-0 flex-1">
              <DialogHeader className="space-y-1.5 text-left">
                <div className="flex items-center gap-2">
                  <DialogTitle className="text-lg leading-none">{agent.name}</DialogTitle>
                  <Badge
                    variant="outline"
                    className="border-0 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
                    style={{ background: accentSoft, color: accent }}
                  >
                    {agent.role}
                  </Badge>
                </div>
                <DialogDescription className="line-clamp-2 text-sm leading-relaxed">
                  {agent.description}
                </DialogDescription>
              </DialogHeader>
            </div>
            <button
              onClick={() => set(agent.id, !on)}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                on
                  ? "border-transparent text-white"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
              style={on ? { background: accent } : undefined}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  on ? "bg-white" : "bg-muted-foreground/60",
                )}
              />
              {on ? "Active" : "Paused"}
            </button>
          </div>

          {/* Live status strip */}
          {runtime.current && (
            <div className="mt-4 rounded-xl border border-border/60 bg-card/70 p-3 backdrop-blur">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 font-medium">
                  <span className="relative flex h-1.5 w-1.5">
                    <span
                      className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                      style={{ background: accent }}
                    />
                    <span
                      className="relative inline-flex h-1.5 w-1.5 rounded-full"
                      style={{ background: accent }}
                    />
                  </span>
                  Working on: {runtime.current.mission.label}
                </span>
                <span className="text-muted-foreground">
                  {Math.round(runtime.current.progress)}%
                </span>
              </div>
              <Progress value={runtime.current.progress} className="h-1.5" />
            </div>
          )}
        </div>

        {/* Tabs */}
        <Tabs defaultValue="tasks" className="flex flex-col overflow-hidden">
          <TabsList className="mx-6 mt-4 grid w-[calc(100%-3rem)] grid-cols-4 bg-muted/40 p-1">
            <TabsTrigger value="tasks" className="gap-1.5 text-xs data-[state=active]:shadow-sm">
              <Bell className="h-3.5 w-3.5" /> To-do
            </TabsTrigger>
            <TabsTrigger value="missions" className="gap-1.5 text-xs">
              <Rocket className="h-3.5 w-3.5" /> Run now
            </TabsTrigger>
            <TabsTrigger value="activity" className="gap-1.5 text-xs">
              <Activity className="h-3.5 w-3.5" /> Activity
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5 text-xs">
              <Settings2 className="h-3.5 w-3.5" /> Settings
            </TabsTrigger>
          </TabsList>

          <div className="overflow-y-auto px-6 py-5" style={{ maxHeight: "55vh" }}>
            {/* TASKS */}
            <TabsContent value="tasks" className="mt-0 space-y-5">
              <p className="text-xs text-muted-foreground">
                Things {agent.name} is working through. Add your own, or let it suggest more.
              </p>

              <Button
                onClick={aiSuggest}
                disabled={generating || !on}
                className="h-10 w-full gap-2 text-white shadow-sm"
                style={{
                  background: `linear-gradient(90deg, ${accent}, hsl(${agent.accentHue} 85% 65%))`,
                }}
              >
                {generating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {generating ? `${agent.name} is thinking…` : `Suggest tasks for me`}
              </Button>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  add(title);
                  setTitle("");
                }}
                className="flex gap-2"
              >
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Or type your own task…"
                  className="h-10 text-sm"
                />
                <Button
                  type="submit"
                  size="sm"
                  className="h-10 gap-1 px-3"
                  disabled={!title.trim()}
                >
                  <Plus className="h-4 w-4" /> Add
                </Button>
              </form>

              <section>
                <h4 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  To do · {openTasks.length}
                </h4>
                {openTasks.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-center">
                    <CheckCircle2 className="mx-auto mb-2 h-5 w-5 text-muted-foreground/60" />
                    <p className="text-sm font-medium">All caught up</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Tap "Suggest tasks for me" when you want more.
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {openTasks.map((t) => (
                      <li
                        key={t.id}
                        className="group flex items-start gap-3 rounded-xl border border-border bg-card p-3 transition hover:border-border/80"
                      >
                        <input
                          type="checkbox"
                          checked={t.done}
                          onChange={() => toggle(t.id)}
                          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-current"
                          style={{ color: accent }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm leading-snug">{t.title}</div>
                          {(t.note || t.due) && (
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
                              {t.note && <span className="truncate">{t.note}</span>}
                              {t.due && (
                                <span className="flex items-center gap-1">
                                  <CalendarClock className="h-3 w-3" />
                                  {t.due}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => remove(t.id)}
                          className="opacity-0 transition group-hover:opacity-60 hover:!opacity-100"
                          aria-label="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {doneTasks.length > 0 && (
                <section>
                  <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Done · {doneTasks.length}
                  </h4>
                  <ul className="space-y-1">
                    {doneTasks.map((t) => (
                      <li
                        key={t.id}
                        className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground"
                      >
                        <input
                          type="checkbox"
                          checked
                          onChange={() => toggle(t.id)}
                          className="h-3.5 w-3.5 cursor-pointer"
                        />
                        <span className="flex-1 truncate line-through">{t.title}</span>
                        <button onClick={() => remove(t.id)} aria-label="Delete">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </TabsContent>

            {/* MISSIONS */}
            <TabsContent value="missions" className="mt-0 space-y-3">
              <p className="text-xs text-muted-foreground">
                One-off jobs you can hand to {agent.name} right now. Pick one and it runs in the
                background.
              </p>
              <ul className="space-y-2.5">
                {agent.missions.map((m) => {
                  const running = runtime.current?.mission.id === m.id;
                  const queued = runtime.queue.some((q) => q.id === m.id);
                  return (
                    <li
                      key={m.id}
                      className="flex items-start gap-3 rounded-xl border border-border bg-card p-3.5 transition hover:border-border/80"
                    >
                      <div
                        className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg"
                        style={{ background: accentSoft, color: accent }}
                      >
                        <Zap className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium leading-snug">{m.label}</div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {m.description}
                        </div>
                        <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground/80">
                          <Clock className="h-3 w-3" /> ~{m.durationSec}s
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant={running || queued ? "secondary" : "default"}
                        disabled={!on || running}
                        onClick={() => {
                          runtime.deploy(m);
                          toast.success(`${agent.name} deployed: ${m.label}`);
                        }}
                        className="h-9 shrink-0 text-xs"
                        style={
                          !running && !queued && on
                            ? { background: accent, color: "white" }
                            : undefined
                        }
                      >
                        {running ? "Running…" : queued ? "Queued" : "Run"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </TabsContent>

            {/* ACTIVITY */}
            <TabsContent value="activity" className="mt-0 space-y-4">
              <div className="grid grid-cols-3 gap-2.5">
                <Stat
                  label="Today"
                  value={String(runtime.tasksToday)}
                  icon={<CheckCircle2 className="h-3 w-3" />}
                  accent={accent}
                />
                <Stat
                  label="Queue"
                  value={String(runtime.queue.length)}
                  icon={<Clock className="h-3 w-3" />}
                  accent={accent}
                />
                <Stat
                  label="Cadence"
                  value={cadence}
                  icon={<Activity className="h-3 w-3" />}
                  accent={accent}
                />
              </div>

              <div>
                <h4 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Recent activity
                </h4>
                {runtime.events.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-4 py-8 text-center">
                    <Activity className="mx-auto mb-2 h-5 w-5 text-muted-foreground/60" />
                    <p className="text-sm font-medium">Nothing here yet</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Run a job from "Run now" to see {agent.name} in action.
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-1.5">
                    {runtime.events.slice(0, 20).map((e) => (
                      <li
                        key={e.id}
                        className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-card/60 px-3 py-2 text-xs"
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            e.type === "complete" ? "bg-success" : "bg-muted-foreground/60",
                          )}
                          style={e.type === "deploy" ? { background: accent } : undefined}
                        />
                        <span className="flex-1 truncate">{e.message}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(e.timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </TabsContent>

            {/* SETTINGS */}
            <TabsContent value="settings" className="mt-0 space-y-5">
              <div>
                <h4 className="text-sm font-medium">How often should {agent.name} run?</h4>
                <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
                  {CADENCE_HINTS[cadence]}
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {CADENCES.map((c) => (
                    <button
                      key={c}
                      onClick={() => saveCadence(c)}
                      className={cn(
                        "rounded-lg border px-2 py-2.5 text-xs font-medium transition",
                        cadence === c
                          ? "border-transparent text-white shadow-sm"
                          : "border-border bg-card text-muted-foreground hover:text-foreground",
                      )}
                      style={cadence === c ? { background: accent } : undefined}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">Pause {agent.name}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      Stops automatic runs. Your tasks stay saved.
                    </div>
                  </div>
                  <Switch checked={on} onCheckedChange={(v) => set(agent.id, v)} />
                </div>
              </div>

              <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  About {agent.name}
                </div>
                <p className="text-sm leading-relaxed text-foreground/80">{agent.description}</p>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function Stat({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <span style={{ color: accent }}>{icon}</span>
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
