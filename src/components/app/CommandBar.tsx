"use client";

import { useEffect, useState } from "react";
import { useNavigate } from "@/lib/navigation";
import { Command } from "cmdk";
import {
  LayoutGrid,
  Search,
  FileText,
  Share2,
  BarChart3,
  Users,
  Power,
  Sparkles,
  ArrowRight,
  MessageSquare,
  Brain,
  CheckSquare,
  Bot,
  Zap,
  CornerDownLeft,
} from "@/components/brand/icons";
import { agentList } from "@/lib/agents";
import { useAgentToggles } from "@/hooks/use-agent-toggles";
import { emit } from "@/lib/activity-bus";
import { STUDIO_TILES } from "@/lib/studio";

const ROUTES = [
  {
    to: "/app",
    label: "Chat",
    icon: LayoutGrid,
    search: undefined as any,
    analyticsTab: undefined as string | undefined,
  },
  {
    to: "/app",
    label: "Analytics · Overview",
    icon: BarChart3,
    search: undefined,
    analyticsTab: "overview",
  },
  {
    to: "/app",
    label: "Analytics · Organic",
    icon: Search,
    search: undefined,
    analyticsTab: "organic",
  },
  {
    to: "/app",
    label: "Analytics · Social",
    icon: Share2,
    search: undefined,
    analyticsTab: "social",
  },
  {
    to: "/app",
    label: "Analytics · Content",
    icon: FileText,
    search: undefined,
    analyticsTab: "content",
  },
  {
    to: "/app",
    label: "Analytics · Automations",
    icon: Bot,
    search: undefined,
    analyticsTab: "automations",
  },
] as const;

const QUICK_PROMPTS = [
  { label: "Audit my SEO + AEO + GEO visibility", icon: Search },
  { label: "Find Reddit threads I should reply to", icon: MessageSquare },
  { label: "Plan this week's content & social posts", icon: FileText },
] as const;

const WORKSPACE_ACTIONS = [
  { id: "brand-dna", label: "Open Brand DNA memory", icon: Brain, event: "open:brand-dna" },
  { id: "tasks", label: "Open Tasks & alerts", icon: CheckSquare, event: "open:tasks" },
  { id: "autopilot", label: "Open 24/7 Autopilot", icon: Bot, event: "open:autopilot" },
] as const;

export function CommandBar() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const navigate = useNavigate();
  const { isOn, set, setAll } = useAgentToggles();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("open:command-bar", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open:command-bar", onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) setValue("");
  }, [open]);

  const askChat = (prompt: string) => {
    setOpen(false);
    window.dispatchEvent(new CustomEvent("chat:prefill", { detail: prompt }));
    window.dispatchEvent(new CustomEvent("chat:focus"));
    emit({ kind: "nav", title: "Asked Raval Ai" });
  };

  const go = (to: string, label: string, search?: any) => {
    setOpen(false);
    navigate({ to: to as any, search });
    emit({ kind: "nav", title: `Opened ${label}` });
  };

  const fireEvent = (name: string) => {
    setOpen(false);
    window.dispatchEvent(new CustomEvent(name));
  };

  const toggle = (id: string, on: boolean) => {
    set(id, on);
    setOpen(false);
  };

  if (!open) return null;
  const trimmed = value.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-foreground/25 backdrop-blur-md p-4 pt-[12vh] animate-fade-in"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl animate-scale-in"
        onClick={(e) => e.stopPropagation()}
        style={{
          boxShadow: "0 30px 80px -20px hsl(217 91% 50% / 0.35), 0 1px 0 0 hsl(var(--border))",
        }}
      >
        <Command label="Command Menu" className="flex flex-col" shouldFilter={true}>
          <div className="flex items-center gap-2 border-b border-border bg-gradient-to-b from-card to-popover px-3.5">
            <Sparkles className="h-4 w-4 text-aura" />
            <Command.Input
              autoFocus
              value={value}
              onValueChange={setValue}
              placeholder="Ask Raval Ai, jump to a module, toggle an agent…"
              className="flex h-12 w-full bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
            />
            <kbd className="hidden sm:inline rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
              ESC
            </kbd>
          </div>
          <Command.List className="max-h-[60vh] overflow-y-auto p-1.5 scrollbar-thin">
            {/* Always-on "Ask Raval Ai" — appears at top whenever user has typed */}
            {trimmed.length > 0 && (
              <Command.Item
                value={`ask ${trimmed}`}
                forceMount
                onSelect={() => askChat(trimmed)}
                className="mb-1 flex cursor-pointer items-center gap-2.5 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-2.5 text-sm data-[selected=true]:bg-primary/10"
              >
                <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-primary to-accent text-primary-foreground">
                  <Zap className="h-3.5 w-3.5" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[10.5px] font-semibold uppercase tracking-wider text-primary">
                    Ask Raval Ai
                  </span>
                  <span className="block truncate text-[13px] font-medium text-foreground">
                    {trimmed}
                  </span>
                </span>
                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <CornerDownLeft className="h-3 w-3" /> send to chat
                </span>
              </Command.Item>
            )}

            <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
              No matches. Press{" "}
              <kbd className="rounded border border-border bg-background px-1 py-0.5 text-[10px]">
                ↵
              </kbd>{" "}
              to send "{trimmed}" to chat.
            </Command.Empty>

            {trimmed.length === 0 && (
              <Command.Group
                heading="Suggested prompts"
                className="px-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {QUICK_PROMPTS.map((p) => (
                  <Command.Item
                    key={p.label}
                    value={`ask ${p.label}`}
                    onSelect={() => askChat(p.label)}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-foreground data-[selected=true]:bg-secondary"
                  >
                    <p.icon className="h-4 w-4 text-aura" />
                    <span className="flex-1">{p.label}</span>
                    <span className="text-[10px] text-muted-foreground">chat</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            <Command.Group
              heading="Navigate"
              className="px-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {ROUTES.map((r) => (
                <Command.Item
                  key={r.label}
                  value={`go ${r.label}`}
                  onSelect={() => {
                    if (r.analyticsTab) {
                      setOpen(false);
                      window.dispatchEvent(
                        new CustomEvent("open:analytics", { detail: { tab: r.analyticsTab } }),
                      );
                      emit({ kind: "nav", title: `Opened ${r.label}` });
                    } else {
                      go(r.to, r.label, r.search);
                    }
                  }}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-foreground data-[selected=true]:bg-secondary"
                >
                  <r.icon className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1">{r.label}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Group
              heading="Studio · create"
              className="px-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {STUDIO_TILES.map((t) => (
                <Command.Item
                  key={t.id}
                  value={`create ${t.label} ${t.sub}`}
                  onSelect={() => {
                    setOpen(false);
                    window.dispatchEvent(
                      new CustomEvent("open:canvas", { detail: { type: t.id } }),
                    );
                    emit({ kind: "nav", title: `Opened ${t.label} canvas` });
                  }}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm data-[selected=true]:bg-secondary"
                >
                  <t.icon className="h-4 w-4 text-aura" />
                  <span className="flex-1">
                    Create {t.label}
                    <span className="ml-1.5 text-xs text-muted-foreground">{t.sub}</span>
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Group
              heading="Workspace"
              className="px-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {WORKSPACE_ACTIONS.map((w) => (
                <Command.Item
                  key={w.id}
                  value={`open ${w.label}`}
                  onSelect={() => fireEvent(w.event)}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm data-[selected=true]:bg-secondary"
                >
                  <w.icon className="h-4 w-4 text-aura" />
                  <span className="flex-1">{w.label}</span>
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Group
              heading="Agents"
              className="px-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {agentList.map((a) => {
                const on = isOn(a.id);
                return (
                  <Command.Item
                    key={a.id}
                    value={`toggle ${a.name} ${a.role}`}
                    onSelect={() => toggle(a.id, !on)}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm data-[selected=true]:bg-secondary"
                  >
                    <Power className={`h-4 w-4 ${on ? "text-success" : "text-muted-foreground"}`} />
                    <span className="flex-1">
                      {on ? "Pause" : "Activate"} <span className="font-medium">{a.name}</span>
                      <span className="ml-1.5 text-xs text-muted-foreground">{a.role}</span>
                    </span>
                  </Command.Item>
                );
              })}
              <Command.Item
                value="all agents on"
                onSelect={() => {
                  setAll(true);
                  setOpen(false);
                }}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm data-[selected=true]:bg-secondary"
              >
                <Power className="h-4 w-4 text-success" />
                <span>Activate all agents</span>
              </Command.Item>
              <Command.Item
                value="all agents off pause"
                onSelect={() => {
                  setAll(false);
                  setOpen(false);
                }}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm data-[selected=true]:bg-secondary"
              >
                <Power className="h-4 w-4 text-muted-foreground" />
                <span>Pause all agents</span>
              </Command.Item>
            </Command.Group>
          </Command.List>
          <div className="flex items-center justify-between border-t border-border bg-card/50 px-3 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-aura" /> Raval Ai · Universal command
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border bg-background px-1 py-0.5">↑↓</kbd> nav
              <kbd className="ml-1 rounded border border-border bg-background px-1 py-0.5">
                ↵
              </kbd>{" "}
              run
              <kbd className="ml-1 rounded border border-border bg-background px-1 py-0.5">
                ⌘K
              </kbd>{" "}
              close
            </span>
          </div>
        </Command>
      </div>
    </div>
  );
}
