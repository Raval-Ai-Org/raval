"use client";

import { useState } from "react";
import { toast } from "@/lib/toast";
import { Check, Story, Video, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { emitAppEvent } from "@/lib/app-events";
import { shareStoryAsReel, shareVideoAsStory } from "@/lib/stories.functions";
import { STORY_FEATURES, STORY_LIFETIME_HOURS, isStoryPlatform } from "@/lib/stories/placement";
import type { StudioType } from "@/lib/studio/formats";
import { openComposer } from "@/lib/studio/session-store";

type Row = { id: string; title?: string | null; meta: Record<string, unknown> | null };

/**
 * What a Story can and can't do when Mellox posts it, in plain words, plus the
 * two re-use shortcuts: a finished video as a Story, and a video Story kept as
 * a Reel. Neither makes anything new; both wait for approval.
 */
export function StoryNotes({
  workspaceId,
  type,
  rows,
  videoReady,
  disabled,
}: {
  workspaceId: string;
  type: StudioType;
  rows: Row[];
  videoReady: boolean;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const first = rows[0];
  const story = (first?.meta?.story ?? null) as { mode?: string } | null;

  const run = async (kind: "story" | "reel") => {
    if (!first || busy) return;
    setBusy(true);
    try {
      if (kind === "story") {
        const platforms = rows
          .map((r) => r.meta?.platform)
          .filter(isStoryPlatform)
          .filter((p, i, all) => all.indexOf(p) === i);
        await shareVideoAsStory({
          data: {
            workspaceId,
            contentItemId: first.id,
            platforms: platforms.length ? platforms : ["instagram"],
          },
        });
      } else {
        await shareStoryAsReel({ data: { workspaceId, contentItemId: first.id } });
      }
      setDone(true);
      emitAppEvent("content:changed");
      toast.success(kind === "story" ? "Story added" : "Reel added", {
        description: "It's waiting for your approval.",
      });
    } catch (e) {
      toast.error("That didn't work", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  if (type !== "video" && type !== "story") {
    const title = (first?.title ?? "").trim();
    return (
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Retell this as a short Story for Instagram and Facebook.
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || !first}
          onClick={() =>
            first &&
            openComposer({
              type: "story",
              brief: title ? `Turn "${title}" into a Story.` : "Turn this post into a Story.",
              sourceContentId: first.id,
            })
          }
        >
          <Story />
          Make a Story from this
        </Button>
      </div>
    );
  }

  if (type === "video") {
    return (
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Post this video as a Story too. It uses the same video, so it costs nothing extra.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void run("story")}
          disabled={disabled || busy || done || !videoReady}
        >
          <Story />
          {done ? "Story added" : "Also share as a Story"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-muted-foreground">
        Stories show for {STORY_LIFETIME_HOURS} hours on Instagram and Facebook, then disappear.
      </p>
      <ul className="space-y-1.5">
        {STORY_FEATURES.map((f) => (
          <li key={f.id} className="flex items-start gap-2 text-xs leading-snug" title={f.how}>
            {f.supported ? (
              <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
            ) : (
              <X className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className={f.supported ? "text-foreground" : "text-muted-foreground"}>
              {f.label}
              {f.supported ? null : <span className="block text-muted-foreground">{f.how}</span>}
            </span>
          </li>
        ))}
      </ul>
      {story?.mode === "video" ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => void run("reel")}
          disabled={disabled || busy || done || !videoReady}
        >
          <Video />
          {done ? "Reel added" : "Keep it as a Reel too"}
        </Button>
      ) : null}
    </div>
  );
}
