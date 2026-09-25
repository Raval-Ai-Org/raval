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
} as const;
const ACCENT: Record<StudioIdea["source"], StudioSuggestionAccent> = {
  season: "green",
  trend: "blue",
  competitor: "rose",
  gap: "amber",
  pillar: "violet",
  momentum: "indigo",
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

export function useStudioSuggestions() {
  const workspaceId = useOptionalWorkspaceId();
  const [ideas, setIdeas] = useState<StudioIdea[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const request = useRef(0);

  const load = useCallback(
    async (refresh = false) => {
      const id = ++request.current;
      if (!workspaceId) {
        setIdeas([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(false);
      try {
        const dismissed = readDismissed(workspaceId);
        const result = await studioApi.ideas({
          workspaceId,
          brand: readBrandPayload(workspaceId),
          dismissed: dismissed.map((item) => item.title).slice(-30),
          limit: 8,
          refresh,
        });
        if (id !== request.current) return;
        const hidden = new Set(dismissed.map((item) => item.id));
        setIdeas(result.ideas.filter((idea) => !hidden.has(idea.id)));
      } catch {
        if (id === request.current) setError(true);
      } finally {
        if (id === request.current) setLoading(false);
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    setIdeas([]);
    void load();
    const onChange = () => void load();
    const onBrandChange = () => void load(true);
    addAppEventListener("brand-dna:saved", onBrandChange);
    addAppEventListener("content:changed", onChange);
    addAppEventListener("geo:audit-complete", onChange);
    return () => {
      removeAppEventListener("brand-dna:saved", onBrandChange);
      removeAppEventListener("content:changed", onChange);
      removeAppEventListener("geo:audit-complete", onChange);
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

  return { items: ideas.map(toSuggestion), loading, error, refresh: () => load(true), dismiss };
}
