"use client";

import { openComposer, type StudioSession } from "@/lib/studio/session-store";
import { repurposeOpen, repurposeTargets } from "@/lib/studio/repurpose";
import type { MediaOutput } from "@/lib/studio/jobs";
import { cn } from "@/lib/utils";
import { TypeGlyph } from "./studio-ui";

/**
 * "Make more from this" under a finished piece: the same facts in another
 * format. A click opens a new composer that starts from this piece; nothing
 * is made or charged until the person presses Generate there, with the price
 * on the button.
 */
export function MakeMoreFrom({
  session,
  contentItemId,
  title,
  media,
  disabled,
}: {
  session: StudioSession;
  contentItemId: string;
  title?: string | null;
  media?: Pick<MediaOutput, "assetId" | "ratio" | "kind"> | null;
  disabled: boolean;
}) {
  const picture = media?.kind === "image" && media.assetId ? media : null;
  const targets = repurposeTargets(session.type, !!picture);
  if (!targets.length) return null;
  return (
    <div className="space-y-2.5" data-tour="make-more">
      <ul className="grid grid-cols-2 gap-2">
        {targets.map((target) => (
          <li key={target.type}>
            <button
              type="button"
              disabled={disabled}
              title={target.hint}
              aria-label={`${target.label}: ${target.hint}`}
              onClick={() =>
                openComposer(
                  repurposeOpen({
                    from: session.type,
                    target,
                    contentItemId,
                    title,
                    platforms: session.controls.platforms,
                    picture,
                  }),
                )
              }
              className={cn(
                "group flex h-full w-full items-center gap-2.5 rounded-xl border border-border bg-background px-2.5 py-2 text-left transition-colors",
                "hover:border-primary-border hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              <TypeGlyph type={target.type} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{target.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Opens a new draft with the same facts. You see the price before anything is made.
      </p>
    </div>
  );
}
