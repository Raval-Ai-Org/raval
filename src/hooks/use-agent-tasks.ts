import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/authed-fetch";

export interface AgentTask {
  id: string;
  title: string;
  note?: string;
  due?: string; // ISO date string
  done: boolean;
  createdAt: number;
}

const seeds: Record<string, Omit<AgentTask, "id" | "createdAt" | "done">[]> = {
  echo: [
    { title: "Schedule LinkedIn post", note: "Product launch teaser", due: "Today 4:00 PM" },
    { title: "Reply to mentions", note: "12 unread on X" },
    { title: "Plan Instagram reel", note: "Behind-the-scenes clip" },
  ],
  scout: [
    { title: "Review weekly SERP shifts", note: "5 keywords slipped" },
    { title: "Add 3 new tracked queries", note: "Competitor terms" },
  ],
  spark: [
    { title: "Approve blog draft", note: "1200-word launch post" },
    { title: "Write FAQ block", note: "10 AEO-optimized answers" },
  ],
};

export function useAgentTasks(agentId: string) {
  const key = `agent-tasks:${agentId}`;
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        setTasks(JSON.parse(raw));
        return;
      }
    } catch {}
    const seed = (seeds[agentId] ?? []).map((s) => ({
      ...s,
      id: crypto.randomUUID(),
      done: false,
      createdAt: Date.now(),
    }));
    setTasks(seed);
  }, [agentId, key]);

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(tasks));
    } catch {}
  }, [key, tasks]);

  const add = (title: string, note?: string, due?: string) => {
    if (!title.trim()) return;
    setTasks((t) => [
      {
        id: crypto.randomUUID(),
        title: title.trim(),
        note: note?.trim() || undefined,
        due: due?.trim() || undefined,
        done: false,
        createdAt: Date.now(),
      },
      ...t,
    ]);
  };
  const toggle = (id: string) =>
    setTasks((t) => t.map((x) => (x.id === id ? { ...x, done: !x.done } : x)));
  const remove = (id: string) => setTasks((t) => t.filter((x) => x.id !== id));

  const generate = async (payload: {
    agentName: string;
    agentRole: string;
    missions: { label: string; description: string }[];
  }) => {
    setGenerating(true);
    try {
      const existing = tasks.filter((t) => !t.done).map((t) => t.title);
      const res = await authedFetch("/api/agent-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, existing }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as {
        tasks: { title: string; note?: string; due?: string }[];
      };
      const fresh: AgentTask[] = (data.tasks ?? []).map((t) => ({
        id: crypto.randomUUID(),
        title: t.title,
        note: t.note,
        due: t.due,
        done: false,
        createdAt: Date.now(),
      }));
      setTasks((prev) => [...fresh, ...prev]);
    } finally {
      setGenerating(false);
    }
  };

  return { tasks, add, toggle, remove, generate, generating };
}
