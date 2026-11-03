"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { getTaste, resetTaste, setReaction } from "@/lib/taste.functions";
import type { Reaction, TasteSummary, TasteView } from "@/lib/taste/contracts";

export type ReactTarget = { key: string; contentItemId?: string; assetId?: string };

export type LibraryTaste = {
  /** False while loading, when the flag is off or the read failed: no hearts. */
  available: boolean;
  reactions: Record<string, Reaction>;
  summary: TasteSummary | null;
  react: (target: ReactTarget, next: Reaction | null) => void;
  reset: () => void;
};

/**
 * The brand's hearts for the Library (ADR-0038). A change shows at once and
 * is rolled back if the server refuses it; the server's answer replaces the
 * local copy, so every tile and the taste strip agree.
 */
export function useLibraryTaste(
  workspaceId: string | null,
  fixture?: TasteView & { onChange?: (label: string) => void },
): LibraryTaste {
  const [view, setView] = useState<TasteView | null>(fixture ?? null);
  const version = useRef(0);

  useEffect(() => {
    if (fixture || !workspaceId) return;
    let alive = true;
    setView(null);
    getTaste({ data: { workspaceId } })
      .then((v) => alive && setView(v))
      .catch(() => alive && setView(null));
    return () => {
      alive = false;
    };
    // The fixture is fixed for the life of a lab page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const react = useCallback(
    (target: ReactTarget, next: Reaction | null) => {
      const before = view;
      if (!before) return;
      const prev = before.reactions[target.key] ?? null;
      if (prev === next) return;
      const reactions = { ...before.reactions };
      if (next) reactions[target.key] = next;
      else delete reactions[target.key];
      const step = (r: Reaction) => Number(next === r) - Number(prev === r);
      setView({
        ...before,
        reactions,
        summary: {
          ...before.summary,
          loves: Math.max(0, before.summary.loves + step("love")),
          lesses: Math.max(0, before.summary.lesses + step("less")),
        },
      });
      if (next === "less") toast.success("Got it. Less like this from now on.");
      if (fixture) {
        fixture.onChange?.(`${target.key}:${next ?? "none"}`);
        return;
      }
      if (!workspaceId) return;
      const v = ++version.current;
      setReaction({
        data: {
          workspaceId,
          contentItemId: target.contentItemId,
          assetId: target.assetId,
          reaction: next,
        },
      })
        .then((saved) => {
          if (v === version.current) setView(saved);
        })
        .catch((error: unknown) => {
          if (v === version.current) setView(before);
          toast.error("Couldn't save that", {
            description: error instanceof Error ? error.message : "Try again.",
          });
        });
    },
    [view, fixture, workspaceId],
  );

  const reset = useCallback(() => {
    if (fixture) {
      setView({
        reactions: {},
        summary: { loves: 0, lesses: 0, chips: [], toLearn: 2 },
      });
      fixture.onChange?.("reset");
      return;
    }
    if (!workspaceId) return;
    resetTaste({ data: { workspaceId } })
      .then((saved) => {
        setView(saved);
        toast.success("Mellox forgot your hearts.");
      })
      .catch(() => toast.error("Couldn't start over. Try again."));
  }, [fixture, workspaceId]);

  return {
    available: !!view,
    reactions: view?.reactions ?? {},
    summary: view?.summary ?? null,
    react,
    reset,
  };
}
