"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { addAppEventListener, emitAppEvent, removeAppEventListener } from "@/lib/app-events";
import { readBrandPayload, studioApi } from "@/lib/studio/client";
import { IDEA_SOURCE_LABEL, type StudioIdea } from "@/lib/studio/ideas";

export type StudioSuggestionAccent = "indigo" | "blue" | "green" | "violet" | "rose" | "amber";
export type StudioSuggestion = {
  id: string;
  label: string;
  hint: string;
  accent: StudioSuggestionAccent;
  icon: "Sparkles" | "Brain" | "Calendar" | "Search" | "Wand2" | "Mail" | "Share2" | "FileText";
  run: () => void;
};

type DismissedIdea = { id: string; title: string };
const dismissedKey = (workspaceId: string) => `studio:ideas-dismissed:${workspaceId}`;

function readDismissed(workspaceId: string): DismissedIdea[] {
  try {
    const value = JSON.parse(localStorage.getItem(dismissedKey(workspaceId)) ?? "[]") as unknown;
    return Array.isArray(value)
      ? value.filter(
          (item): item is DismissedIdea =>
            !!item && typeof item.id === "string" && typeof item.title === "string",
        )
      : [];
  } catch {
    return [];
  }
}

const ICON = {
  season: "Calendar",
  trend: "Search",
  competitor: "Wand2",
  gap: "FileText",
  pillar: "Brain",
  momentum: "Sparkles",
  campaign: "Calendar",
} as const;
const ACCENT: Record<StudioIdea["source"], StudioSuggestionAccent> = {
  season: "green",
  trend: "blue",
  competitor: "rose",
  gap: "amber",
  pillar: "violet",
  momentum: "indigo",
  campaign: "green",
};

function toSuggestion(idea: StudioIdea): StudioSuggestion {
  return {
    id: idea.id,
    label: idea.title,
    hint: idea.why
      ? `${IDEA_SOURCE_LABEL[idea.source]} · ${idea.why}`
      : IDEA_SOURCE_LABEL[idea.source],
    accent: ACCENT[idea.source],
    icon: ICON[idea.source],
    run: () =>
      emitAppEvent("open:canvas", {
        type: idea.type,
        brief: idea.brief,
        goal: idea.goal,
        ideaId: idea.id,
        ideaSource: idea.source,
        platforms: idea.platforms,
      }),
  };
}

/**
 * The Studio rail's ideas. Opening the rail only looks at ideas already made
 * (the shared server cache, free); a new model pass happens only when a
 * person presses "Show ideas" or refresh. Nothing reloads by itself after
 * content changes: that used to start a paid model call every time a piece
 * was saved.
 */
export function useStudioSuggestions() {
  const workspaceId = useOptionalWorkspaceId();
  const [ideas, setIdeas] = useState<StudioIdea[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  /** A person asked for ideas (a model pass may have run). */
  const [asked, setAsked] = useState(false);
  const request = useRef(0);
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(
    async (mode: "peek" | "ask" | "refresh") => {
      const id = ++request.current;
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      if (!workspaceId) {
        setIdeas([]);
        setLoading(false);
        return;
      }
      if (mode !== "peek") setAsked(true);
      setLoading(true);
      setError(false);
      try {
        const dismissed = readDismissed(workspaceId);
        const result = await studioApi.ideas(
          {
            workspaceId,
            brand: readBrandPayload(workspaceId),
            dismissed: dismissed.map((item) => item.title).slice(-30),
            limit: 8,
            refresh: mode === "refresh",
            cachedOnly: mode === "peek",
          },
          controller.signal,
        );
        if (id !== request.current) return;
        const hidden = new Set(dismissed.map((item) => item.id));
        setIdeas(result.ideas.filter((idea) => !hidden.has(idea.id)));
      } catch {
        if (id === request.current && !controller.signal.aborted && mode !== "peek") setError(true);
      } finally {
        if (id === request.current) {
          setLoading(false);
          inFlight.current = null;
        }
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    setIdeas([]);
    setAsked(false);
    void load("peek");
    // New Brand DNA makes the old ideas stale: clear them and wait for a click.
    const onBrandChange = () => {
      inFlight.current?.abort();
      setIdeas([]);
      setAsked(false);
    };
    addAppEventListener("brand-dna:saved", onBrandChange);
    return () => {
      removeAppEventListener("brand-dna:saved", onBrandChange);
      inFlight.current?.abort();
    };
  }, [load]);

  const dismiss = useCallback(
    (id: string) => {
      if (!workspaceId) return;
      const idea = ideas.find((item) => item.id === id);
      if (!idea) return;
      const dismissed = [...readDismissed(workspaceId), { id, title: idea.title }].slice(-40);
      try {
        localStorage.setItem(dismissedKey(workspaceId), JSON.stringify(dismissed));
      } catch {
        // Dismissal still applies to this session when storage is unavailable.
      }
      setIdeas((current) => current.filter((item) => item.id !== id));
    },
    [ideas, workspaceId],
  );

  return {
    items: ideas.map(toSuggestion),
    loading,
    error,
    asked,
    ask: () => load("ask"),
    refresh: () => load("refresh"),
    dismiss,
  };
}
