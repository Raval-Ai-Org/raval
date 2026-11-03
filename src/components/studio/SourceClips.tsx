"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Globe,
  Image as ImageIcon,
  Sparkles,
  Spinner,
  Video,
  type LucideIcon,
} from "@/components/icons";
import { OptionCards, SwitchRow } from "./studio-ui";
import type { StudioControls } from "@/lib/studio/jobs";
import { MAX_CLIPS, VIDEO_MODES } from "@/lib/studio/clip-edit";
import { siteCaptures, type SiteCapture } from "@/lib/studio/site-reel";
import { getVisualTaste } from "@/lib/brand-visuals.functions";
import { emitAppEvent } from "@/lib/app-events";

type VideoMode = NonNullable<StudioControls["videoMode"]>;
const MODE_ICON: Record<VideoMode, LucideIcon> = {
  generate: Sparkles,
  brand: Video,
  recap: ImageIcon,
  site: Globe,
};

/**
 * How the video is made: new footage, the brand's own clips, a recap of its
 * photos or its website. Clips and photos are added in the description box
 * (`PromptMedia`); this card only says what each choice needs.
 */
export function SourceClips({
  workspaceId,
  controls: c,
  set,
  disabled,
}: {
  workspaceId: string;
  controls: StudioControls;
  set: (patch: Partial<StudioControls>) => void;
  disabled?: boolean;
}) {
  const mode = c.videoMode ?? "generate";
  const value = c.sourceVideoAssetIds ?? [];
  const photoCount = c.referenceAssetIds?.length ?? 0;
  // Website captures are read (free) only once a person picks "My website".
  const [captures, setCaptures] = useState<SiteCapture[] | null>(null);
  useEffect(() => {
    if (mode !== "site" || captures) return;
    let cancelled = false;
    getVisualTaste({ data: { workspaceId } })
      .then((view) => {
        if (!cancelled) setCaptures(siteCaptures(view?.sources ?? []));
      })
      .catch(() => {
        if (!cancelled) setCaptures([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, captures, workspaceId]);
  const picked = c.referenceAssetIds?.[0];

  return (
    <div data-no-rhythm className="space-y-3 rounded-xl border border-border bg-surface-3 p-3.5">
      <p className="text-sm font-medium text-foreground">Make the video from</p>
      <OptionCards
        label="Make the video from"
        value={mode}
        onChange={(videoMode) =>
          // The website reel uses one capture; other modes start without it.
          set(
            videoMode === "site" || mode === "site"
              ? { videoMode, referenceAssetIds: [] }
              : { videoMode },
          )
        }
        options={VIDEO_MODES.map((option) => ({ ...option, icon: MODE_ICON[option.value] }))}
      />

      {mode === "brand" && (
        <div className="space-y-3 border-t border-border pt-3">
          <p className="text-[11px] text-muted-foreground">
            {value.length
              ? `${value.length} of ${MAX_CLIPS} clips added in the box above.`
              : `Add up to ${MAX_CLIPS} clips in the box above, one minute in all.`}{" "}
            Mellox picks the best part of each and adds your design.
          </p>
          <SwitchRow
            label="Captions"
            hint="What's said, on screen"
            checked={c.clipCaptions !== false}
            disabled={disabled}
            onCheckedChange={(on) => set({ clipCaptions: on })}
          />
        </div>
      )}

      {mode === "recap" && (
        <div className="space-y-3 border-t border-border pt-3">
          <p className="text-[11px] text-muted-foreground">
            {photoCount
              ? `${photoCount} of 6 photos added in the box above, in play order.`
              : "Add 2 to 6 photos in the box above, in play order."}
          </p>
          <SwitchRow
            label="Bring photos to life"
            hint={
              c.recapMotion === "ai"
                ? "AI motion · people may change · Economy and Standard use credits"
                : "Off: slow camera moves, photos stay exact"
            }
            checked={c.recapMotion === "ai"}
            disabled={disabled}
            onCheckedChange={(on) => set({ recapMotion: on ? "ai" : "camera" })}
          />
        </div>
      )}

      {mode === "site" && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-[11px] text-muted-foreground">
            Pick a page. It scrolls on a phone or laptop in your colours, about 10 seconds.
          </p>
          {captures === null ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner className="size-3.5 animate-spin" />
              Looking for your website pictures…
            </p>
          ) : captures.length ? (
            <ul className="grid grid-cols-2 gap-2 min-[420px]:grid-cols-3">
              {captures.slice(0, 9).map((capture) => (
                <li key={capture.assetId}>
                  <button
                    type="button"
                    aria-pressed={picked === capture.assetId}
                    disabled={disabled}
                    onClick={() => set({ referenceAssetIds: [capture.assetId] })}
                    className={cn(
                      "w-full overflow-hidden rounded-lg border text-left text-[11px] transition-colors",
                      picked === capture.assetId
                        ? "border-primary-border ring-2 ring-primary/40"
                        : "border-border hover:border-border-strong",
                    )}
                  >
                    {capture.thumb ? (
                      <img
                        src={capture.thumb}
                        alt=""
                        className="h-20 w-full bg-surface-2 object-cover object-top"
                      />
                    ) : (
                      <span className="block h-20 bg-surface-2" />
                    )}
                    <span className="block truncate px-2 py-1">
                      {capture.mobile ? "Phone · " : ""}
                      {capture.label}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              No pictures of your website yet.{" "}
              <button
                type="button"
                className="font-medium text-foreground underline"
                onClick={() => emitAppEvent("open:inspo", { section: "media" })}
              >
                Add them in Inspo
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
