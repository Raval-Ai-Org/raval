"use client";

import { useEffect, useState, useCallback } from "react";
import { agentList } from "@/lib/agents";
import { emit } from "@/lib/activity-bus";

const STORAGE_KEY = "agent-toggles:v1";

type Toggles = Record<string, boolean>;

const defaultToggles: Toggles = Object.fromEntries(agentList.map((a) => [a.id, true]));

function read(): Toggles {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultToggles, ...JSON.parse(raw) };
  } catch {}
  return defaultToggles;
}

const subscribers = new Set<(t: Toggles) => void>();
let memo: Toggles | null = null;

function getState() {
  if (typeof window === "undefined") return defaultToggles;
  if (memo) return memo;
  memo = read();
  return memo;
}

function setState(updater: (prev: Toggles) => Toggles) {
  const next = updater(getState());
  memo = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
  subscribers.forEach((cb) => cb(next));
}

export function useAgentToggles() {
  // Always start from defaults so SSR and first client render match.
  const [toggles, setLocal] = useState<Toggles>(defaultToggles);

  useEffect(() => {
    // After mount, sync from localStorage (the source of truth on client).
    setLocal(getState());
    const cb = (t: Toggles) => setLocal(t);
    subscribers.add(cb);
    return () => {
      subscribers.delete(cb);
    };
  }, []);

  const set = useCallback((id: string, on: boolean) => {
    setState((prev) => ({ ...prev, [id]: on }));
    const a = agentList.find((x) => x.id === id);
    if (a)
      emit({
        kind: "agent.toggle",
        agentSlug: a.slug,
        title: `${a.name} ${on ? "activated" : "paused"}`,
        detail: on ? `${a.role} is back online.` : `${a.role} stays silent until re-enabled.`,
        toast: true,
      });
  }, []);

  const setAll = useCallback((on: boolean) => {
    setState(() => Object.fromEntries(agentList.map((a) => [a.id, on])));
    emit({
      kind: "agent.toggle",
      title: on ? "All agents activated" : "All agents paused",
      toast: true,
    });
  }, []);

  const isOn = useCallback((id: string) => toggles[id] !== false, [toggles]);

  const activeCount = Object.values(toggles).filter((v) => v !== false).length;

  return { toggles, set, setAll, isOn, activeCount, total: agentList.length };
}

// ----- Prompt → agent router ----------------------------------------

const KEYWORDS: { slug: string; words: string[] }[] = [
  {
    slug: "seo",
    words: ["seo", "aeo", "geo", "search", "ranking", "serp", "citation", "backlink"],
  },
  {
    slug: "content",
    words: ["blog", "article", "draft", "copy", "content", "newsletter", "email", "write"],
  },
  {
    slug: "social",
    words: [
      "social",
      "linkedin",
      "twitter",
      "x post",
      "instagram",
      "reel",
      "tweet",
      "post",
      "schedule",
      "reddit",
      "subreddit",
      "quora",
      "community",
      "thread",
      "ama",
      "answer",
    ],
  },
];

export function routePromptToAgent(prompt: string): string | null {
  const p = prompt.toLowerCase();
  let best: { slug: string; score: number } | null = null;
  for (const k of KEYWORDS) {
    const score = k.words.reduce((s, w) => s + (p.includes(w) ? w.length : 0), 0);
    if (score > 0 && (!best || score > best.score)) best = { slug: k.slug, score };
  }
  return best?.slug ?? null;
}
